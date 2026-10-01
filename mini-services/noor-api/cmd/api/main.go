// API سرور Go — نویسندهٔ app.sqlite و مرجع مجوز (§۲۰/§۳۹).
package main

import (
	"crypto/rand"
	"database/sql"
	"log"
	"net/http"
	"os"
	"path/filepath"

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

func countPassages(path string) int {
	db, err := sql.Open("sqlite", "file:"+path+"?mode=ro")
	if err != nil {
		return 0
	}
	defer db.Close()
	var n int
	_ = db.QueryRow("SELECT COUNT(*) FROM passages").Scan(&n)
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

	// secret برای امضای cursor (پایدار بین restartها در kv)
	secret, ok := db.KV("cursor_secret")
	if !ok {
		b := make([]byte, 32)
		_, _ = rand.Read(b)
		secret = string(b)
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
	case "opensearch":
		osEng, err := search.NewOpenSearch(cfg.OpenSearchURL, cfg.OpenSearchUser, cfg.OpenSearchPass, os.Getenv("NOOR_OS_INDEX"), base)
		if err != nil {
			log.Fatalf("NOOR_ENGINE=opensearch است اما موتور OpenSearch آماده نیست: %v (سرویس opensearch را بالا بیاورید یا NOOR_ENGINE=local بگذارید)", err)
		}
		if err := osEng.EnsureIndex(); err != nil {
			log.Fatalf("ساخت نمایهٔ OpenSearch ناموفق بود: %v", err)
		}
		engineName = "opensearch"
		eng = osEng
	default:
		log.Fatalf("NOOR_ENGINE=%q شناخته شده نیست؛ مقادیر مجاز: local، opensearch", cfg.Engine)
	}

	// نمایهٔ خالی → خودکار نمایه‌سازی اولیه در صف (قابل اجرا توسط worker)
	if countPassages(idxPath) == 0 {
		if _, err := jobs.New(db).Enqueue("index_rebuild", []byte(`{"reason":"bootstrap"}`), "system"); err != nil {
			log.Println("enqueue bootstrap index:", err)
		} else {
			log.Println("نمایه خالی است؛ نمایه‌سازی اولیه در صف قرار گرفت")
		}
	}

	srv := &httpapi.Server{
		Cfg: cfg, DB: db, Auth: am, Catalog: cat,
		Engine: eng, Research: research.New(db), Overlay: overlay.New(db), Jobs: jobs.New(db),
		Secret: []byte(secret), EngineName: engineName,
	}
	httpapi.PassagesCounter = func() int { return countPassages(idxPath) }

	addr := ":" + cfg.HTTPPort
	log.Println("noor-api listening on", addr, "| engine:", engineName, "| max_results:", cfg.MaxResults, "| session_ttl:", cfg.SearchSessionTTL, "| works:", len(cat.Works()))
	if err := http.ListenAndServe(addr, srv.Router()); err != nil {
		log.Fatal(err)
	}
}
