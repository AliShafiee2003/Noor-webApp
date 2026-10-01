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
	defer func() {
		for _, db := range dbs {
			if db != nil {
				_ = db.Close()
			}
		}
	}()

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
