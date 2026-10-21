package store

// store_test.go — DB-04: مهاجرت باید با boot هم‌زمان api و worker (چند اتصال
// مستقل روی یک فایل) سالم بماند؛ مهاجرت دوم crash نکند و نسخه دوبار درج نشود.

import (
	"path/filepath"
	"sync"
	"testing"
)

func TestMigrateConcurrentOpen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "app.sqlite")

	const racers = 8
	var wg sync.WaitGroup
	errs := make([]error, racers)
	dbs := make([]*DB, racers)
	t.Cleanup(func() {
		for _, db := range dbs {
			if db != nil {
				_ = db.Close()
			}
		}
	})
	for i := 0; i < racers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			// همان فایل — شبیه‌سازی boot هم‌زمان دو سرویس روی app.sqlite
			db, err := Open(path)
			dbs[i], errs[i] = db, err
		}(i)
	}
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			t.Fatalf("Open هم‌زمان #%d شکست خورد: %v", i, err)
		}
	}

	var cnt int
	if err := dbs[0].QueryRow(`SELECT COUNT(*) FROM schema_migrations`).Scan(&cnt); err != nil {
		t.Fatalf("schema_migrations خوانده نشد: %v", err)
	}
	if cnt != 1 {
		t.Fatalf("schema_migrations باید دقیقاً یک ردیف داشته باشد؛ got %d", cnt)
	}

	// راند دوم: فایل از-قبل-مهاجرت‌شده هم باید برای همه سالم باز شود
	for i := 0; i < racers; i++ {
		db, err := Open(path)
		if err != nil {
			t.Fatalf("Open دوم #%d: %v", i, err)
		}
		_ = db.Close()
	}
}

func TestWorkPublications(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "app.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })

	// پیش‌فرض: اثر منتشر است
	if !db.IsWorkPublished("w-1") {
		t.Fatal("اثر جدید باید پیش‌فرض منتشر باشد")
	}

	// خروج از دسترسی
	if err := db.SetWorkPublished("w-1", false, "admin"); err != nil {
		t.Fatal(err)
	}
	if db.IsWorkPublished("w-1") {
		t.Fatal("اثر باید غیرفعال شده باشد")
	}
	unpub, err := db.UnpublishedWorkUIDs()
	if err != nil {
		t.Fatal(err)
	}
	if !unpub["w-1"] {
		t.Fatal("w-1 باید در لیست غیرفعال‌ها باشد")
	}

	// انتشار مجدد
	if err := db.SetWorkPublished("w-1", true, "admin"); err != nil {
		t.Fatal(err)
	}
	if !db.IsWorkPublished("w-1") {
		t.Fatal("اثر باید مجدداً منتشر شده باشد")
	}
	unpub, _ = db.UnpublishedWorkUIDs()
	if unpub["w-1"] {
		t.Fatal("w-1 نباید در لیست غیرفعال‌ها باشد")
	}
}
