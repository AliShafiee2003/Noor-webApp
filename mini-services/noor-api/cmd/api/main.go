// API سرور Go — نویسندهٔ app.sqlite و مرجع مجوز (§۲۰/§۳۹).
package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"sync"
	"syscall"
	"time"

	"noor/internal/auth"
	"noor/internal/catalog"
	"noor/internal/config"
	"noor/internal/httpapi"
	"noor/internal/index"
	"noor/internal/jobs"
	"noor/internal/overlay"
	"noor/internal/research"
	"noor/internal/search"
	"noor/internal/store"
)

var passagesCache struct {
	sync.Mutex
	val int
	at  time.Time
}

// countPassages شمار passages را با کش ۵ثانیه‌ای برمی‌گرداند — هر /status دیگر
// اتصال و COUNT کامل باز نمی‌کند (ممیزی: countPassages در هر فراخوانی).
func countPassages(path string) int {
	passagesCache.Lock()
	defer passagesCache.Unlock()
	if time.Since(passagesCache.at) < 5*time.Second {
		return passagesCache.val
	}
	db, err := sql.Open("sqlite", "file:"+path+"?mode=ro&immutable=1")
	if err != nil {
		return passagesCache.val
	}
	defer db.Close()
	var n int
	_ = db.QueryRow("SELECT COUNT(*) FROM passages").Scan(&n)
	passagesCache.val = n
	passagesCache.at = time.Now()
	return n
}

func main() {
	cfg := config.FromEnv()
	_ = os.MkdirAll(cfg.DataDir, 0o755)

	db, err := store.Open(filepath.Join(cfg.DataDir, "app.sqlite"))
	if err != nil {
		log.Fatal("app.sqlite:", err)
	}
	cat, err := catalog.Load(cfg.SourcesDir)
	if err != nil {
		log.Fatal("catalog:", err)
	}
	// ویژگی‌های واقعی ثبت‌شده از نسل قبل — تا /works از ابتدا صادق باشد
	if raw, ok := db.KV("work_features"); ok {
		var feats map[string]map[string]bool
		if err := json.Unmarshal([]byte(raw), &feats); err == nil && len(feats) > 0 {
			cat.SetKnownFeatures(feats)
		}
	}

	// secret برای امضای cursor (پایدار بین restartها در kv)
	secret, ok := db.KV("cursor_secret")
	if !ok {
		b := make([]byte, 32)
		if _, err := rand.Read(b); err != nil {
			log.Fatal("rand:", err)
		}
		secret = hex.EncodeToString(b) // hex تا بایت‌های خام در ستون TEXT خراب نشوند
		_ = db.SetKV("cursor_secret", secret)
	}

	// نمایهٔ فعال — فقط‌خواندنی؛ اگر نسل هنوز ساخته نشده، با نمایهٔ خالی بالا می‌آید
	// و /status وضعیت «نمایه آماده نیست» را صادقانه اعلام می‌کند (SEARCH-21)
	idxPath := filepath.Join(cfg.DataDir, "index.sqlite")
	if _, err := os.Stat(idxPath); err != nil {
		w, err := index.OpenWrite(idxPath)
		if err != nil {
			log.Fatal("index.sqlite:", err)
		}
		if _, err := (&index.IndexWriter{DB: w}).Rebuild("rel-empty", nil, nil, nil); err != nil {
			log.Fatal("empty index:", err)
		}
		w.Close()
	}
	idxDB, err := index.OpenRead(idxPath)
	if err != nil {
		log.Fatal("index.sqlite:", err)
	}

	am := auth.NewManager(db, cfg.SessionMaxAge, cfg.SessionIdle)
	// محدودساز ورود از config (پیش‌فرض تولید ۵/دقیقه؛ توسعه/E2E با NOOR_LOGIN_RATE_MAX)
	am.SetLoginLimiter(cfg.LoginRateMax, cfg.LoginRateWindow)
	idxDB.Close()

	// انتخاب صریح موتور (الف-۲): NOOR_ENGINE=local فقط با ثبت صریح؛
	// NOOR_ENGINE=opensearch بدون سرویس در دسترس → استارت با خطای فهمیدنی شکست می‌خورد.
	base := search.NewLocal(idxPath, []byte(secret), httpapi.MetaAdapter(cat),
		search.WithLimits(cfg.MaxResults, cfg.SearchSessionTTL),
		search.WithSessionStore(db))
	var engineName string
	var eng search.Engine
	switch cfg.Engine {
	case "", "local":
		engineName = "local"
		eng = base
	case "fts5":
		ftsEng, err := search.OpenFTS5FromDir(base, cfg.DataDir)
		if err != nil {
			log.Fatalf("NOOR_ENGINE=fts5 است اما بارگذاری شاردهای FTS5 ناموفق بود: %v", err)
		}
		engineName = "fts5"
		eng = ftsEng
	case "opensearch":
		osEng, err := search.NewOpenSearch(cfg.OpenSearchURL, cfg.OpenSearchUser, cfg.OpenSearchPass, os.Getenv("NOOR_OS_INDEX"), base, search.WithHTTPClient(cfg.OSHTTPClient(30*time.Second)))
		if err != nil {
			log.Fatalf("NOOR_ENGINE=opensearch است اما موتور OpenSearch آماده نیست: %v (سرویس opensearch را بالا بیاورید یا NOOR_ENGINE=local بگذارید)", err)
		}
		if err := osEng.EnsureIndex(); err != nil {
			log.Fatalf("ساخت نمایهٔ OpenSearch ناموفق بود: %v", err)
		}
		engineName = "opensearch"
		eng = osEng
	default:
		log.Fatalf("NOOR_ENGINE=%q شناخته شده نیست؛ مقادیر مجاز: local، fts5، opensearch", cfg.Engine)
	}

	// نمایهٔ خالی → خودکار نمایه‌سازی اولیه در صف (قابل اجرا توسط worker)
	if countPassages(idxPath) == 0 {
		if _, err := jobs.New(db).Enqueue("index_rebuild", []byte(`{"reason":"bootstrap"}`), "system"); err != nil {
			log.Println("enqueue bootstrap index:", err)
		} else {
			log.Println("نمایه خالی است؛ نمایه‌سازی اولیه در صف قرار گرفت")
		}
	}

	// بودجهٔ L4 زیر تایم‌اوت HTTP می‌ماند — وگرنه L4 سنگین هرگز به بودجهٔ خودش نمی‌رسد
	if fe, ok := eng.(*search.FTS5Engine); ok {
		b := cfg.SearchTimeout - 2*time.Second
		if b < 5*time.Second {
			b = 5 * time.Second
		}
		if b > 30*time.Second {
			b = 30 * time.Second
		}
		fe.SetL4Budget(b)
		log.Println("L4 budget:", b)
	}

	srv := &httpapi.Server{
		Cfg: cfg, DB: db, Auth: am, Catalog: cat,
		Engine: eng, Research: research.New(db), Overlay: overlay.New(db), Jobs: jobs.New(db),
		Secret: []byte(secret), EngineName: engineName,
	}
	if fe, ok := eng.(*search.FTS5Engine); ok {
		httpapi.PassagesCounter = func() int { return fe.PassagesCount() }
	} else {
		httpapi.PassagesCounter = func() int { return countPassages(idxPath) }
	}

	addr := ":" + cfg.HTTPPort
	log.Println("noor-api listening on", addr, "| engine:", engineName, "| max_results:", cfg.MaxResults, "| session_ttl:", cfg.SearchSessionTTL, "| works:", len(cat.Works()))

	// سرور سخت‌گیر: تایم‌اوت هدر (ضد Slowloris)، تایم‌اوت خواندن/بیکاری، و
	// خاموشی لطیف روی SIGINT/SIGTERM (درخواست‌های در حال اجرا فرصت پایان دارند).
	httpSrv := &http.Server{
		Addr:              addr,
		Handler:           srv.Router(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	errCh := make(chan error, 1)
	go func() {
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
			return
		}
		errCh <- nil
	}()
	select {
	case err := <-errCh:
		if err != nil {
			log.Fatal(err)
		}
		log.Println("server closed")
	case <-ctx.Done():
		log.Println("shutdown signal received; draining…")
		shCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		_ = httpSrv.Shutdown(shCtx)
	}
}
