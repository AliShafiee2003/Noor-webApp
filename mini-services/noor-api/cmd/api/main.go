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
	eng := search.NewLocal(idxPath, []byte(secret), httpapi.MetaAdapter(cat))

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
		Secret: []byte(secret),
	}
	httpapi.PassagesCounter = func() int { return countPassages(idxPath) }

	addr := ":" + cfg.HTTPPort
	log.Println("noor-api listening on", addr, "| engine:", cfg.Engine, "| works:", len(cat.Works()))
	if err := http.ListenAndServe(addr, srv.Router()); err != nil {
		log.Fatal(err)
	}
}
