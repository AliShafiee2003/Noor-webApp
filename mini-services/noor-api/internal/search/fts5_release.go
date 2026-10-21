package search

// نگهداری یک نسل FTS5 باز (پایگاه اصلی + شاردها) با شمارش ارجاع، تا تعویض نسل در حین
// پرس‌وجو هیچ اتصالی را زیر پای درخواست در جریان نبندد (§۲۴/§۲۶).

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"noor/internal/norm"
	"path/filepath"
	"runtime"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"noor/internal/index"
)

// ftsDoc فرادادهٔ سبک هر سند نسل (در حافظه؛ چند هزار ردیف).
type ftsDoc struct {
	Ord        int64
	UID        string
	WorkUID    string
	Collection string
	Language   string
	Shard      int
	SeqLo      int64
	SeqHi      int64
	StreamLen  int
}

type ftsRelease struct {
	uid      string
	dir      string
	main     *sql.DB
	shards   []*sql.DB
	manifest *index.FTSManifest
	// normMismatch نسخهٔ قواعد نمایه وقتی با norm.Version فرق دارد (خالی = هم‌خوان)
	normMismatch string
	docs         []ftsDoc // اندیس = ord-1
	docByUID     map[string]*ftsDoc
	passages     int
	topTerms     []string
	refs         atomic.Int64
	retired      atomic.Bool
	closeOnce    sync.Once

	dfMu sync.RWMutex
	df   map[string]int // کش df سطح N2 (کران‌دار)
}

const dfCacheMax = 400000

func ftsDSN(path string) string {
	// immutable=1: نسل منتشرشده هرگز تغییر نمی‌کند؛ SQLite قفل و بررسی تغییر را کنار می‌گذارد.
	return "file:" + path + "?mode=ro&immutable=1&_pragma=query_only(1)&_pragma=mmap_size(1073741824)&_pragma=cache_size(-65536)"
}

// openFTSRelease نسل را از پوشه باز و با manifest اعتبارسنجی می‌کند.
func openFTSRelease(dir, rel string) (*ftsRelease, error) {
	shardPaths, err := index.VerifyFTSRelease(dir, rel, false)
	if err != nil {
		return nil, err
	}
	mainPath := filepath.Join(dir, index.FTSMainFile(rel))
	mainDB, err := sql.Open("sqlite", ftsDSN(mainPath))
	if err != nil {
		return nil, fmt.Errorf("fts5 engine: باز کردن پایگاه اصلی %s: %w", mainPath, err)
	}
	conns := runtime.NumCPU() * 2
	if conns < 4 {
		conns = 4
	}
	mainDB.SetMaxOpenConns(conns)
	r := &ftsRelease{uid: rel, dir: dir, main: mainDB, docByUID: map[string]*ftsDoc{}, df: map[string]int{}}
	fail := func(e error) (*ftsRelease, error) {
		r.close()
		return nil, e
	}
	if r.manifest, err = index.ReadFTSManifest(mainDB); err != nil {
		return fail(fmt.Errorf("fts5 engine: %w", err))
	}
	for i, sp := range shardPaths {
		sdb, err := sql.Open("sqlite", ftsDSN(sp))
		if err != nil {
			return fail(fmt.Errorf("fts5 engine: باز کردن شارد %d: %w", i, err))
		}
		sdb.SetMaxOpenConns(conns)
		// باز شدن واقعی و وجود جدول
		var n int
		if err := sdb.QueryRow(`SELECT count(*) FROM sqlite_master WHERE name='fts_phrase'`).Scan(&n); err != nil || n != 1 {
			sdb.Close()
			return fail(fmt.Errorf("fts5 engine: شارد %d جدول fts_phrase ندارد یا خوانا نیست: %v", i, err))
		}
		r.shards = append(r.shards, sdb)
	}
	rows, err := mainDB.Query(`SELECT doc_ord, document_uid, COALESCE(work_uid,''), COALESCE(collection_uid,''), COALESCE(language,''), shard_id, seq_lo, seq_hi, stream_len FROM docs ORDER BY doc_ord`)
	if err != nil {
		return fail(fmt.Errorf("fts5 engine: خواندن docs: %w", err))
	}
	for rows.Next() {
		var d ftsDoc
		if err := rows.Scan(&d.Ord, &d.UID, &d.WorkUID, &d.Collection, &d.Language, &d.Shard, &d.SeqLo, &d.SeqHi, &d.StreamLen); err != nil {
			rows.Close()
			return fail(fmt.Errorf("fts5 engine: خواندن docs: %w", err))
		}
		if d.Ord != int64(len(r.docs)+1) || d.Shard < 0 || d.Shard >= len(r.shards) {
			rows.Close()
			return fail(fmt.Errorf("fts5 engine: جدول docs ناسازگار است (ord=%d shard=%d)", d.Ord, d.Shard))
		}
		r.docs = append(r.docs, d)
	}
	rows.Close()
	for i := range r.docs {
		r.docByUID[r.docs[i].UID] = &r.docs[i]
	}
	r.passages, _ = strconv.Atoi(r.manifest.Values["passages"])
	if r.passages <= 0 {
		r.passages = 1
	}
	_ = json.Unmarshal([]byte(r.manifest.Values["top_terms"]), &r.topTerms)
	if v := r.manifest.Values["norm_version"]; v != norm.Version {
		// نمایهٔ ساخته‌شده با قواعد دیگر با پرسشِ نرمال‌شده با قواعد فعلی هم‌خوان نیست؛
		// سرویس قطع نمی‌شود ولی هر پاسخ این ناسازگاری را صریح اعلام می‌کند.
		r.normMismatch = v
		log.Printf("fts5: هشدار — نسل %s با قواعد %q ساخته شده و قواعد فعلی %q است؛ بازسازی نمایه لازم است", rel, v, norm.Version)
	}
	return r, nil
}

// warmUp صفحات داغ نمایه را پیش‌خوانی می‌کند (§۲۴) — بهترین‌تلاش، بدون اثر بر صحت.
func (r *ftsRelease) warmUp(ctx context.Context) {
	r.refs.Add(1)
	defer r.releaseRef()
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	var wg sync.WaitGroup
	for _, s := range r.shards {
		wg.Add(1)
		go func(db *sql.DB) {
			defer wg.Done()
			for _, t := range r.topTerms {
				var n int
				_ = db.QueryRowContext(ctx, `SELECT count(*) FROM fts_phrase WHERE fts_phrase MATCH ?`, "n1 : "+norm.FTSPhrase([]string{t})).Scan(&n)
			}
		}(s)
	}
	wg.Wait()
}

func (r *ftsRelease) releaseRef() {
	if r.refs.Add(-1) == 0 && r.retired.Load() {
		r.close()
	}
}

// retire نسل را از چرخه خارج می‌کند؛ با پایان آخرین درخواست بسته می‌شود.
func (r *ftsRelease) retire() {
	r.retired.Store(true)
	if r.refs.Load() == 0 {
		r.close()
	}
}

func (r *ftsRelease) close() {
	r.closeOnce.Do(func() {
		for _, s := range r.shards {
			if s != nil {
				_ = s.Close()
			}
		}
		if r.main != nil {
			_ = r.main.Close()
		}
	})
}

// dfOf df سطح N2 از کش؛ ok=false یعنی هنوز واکشی نشده.
func (r *ftsRelease) dfOf(n2 string) (int, bool) {
	r.dfMu.RLock()
	v, ok := r.df[n2]
	r.dfMu.RUnlock()
	return v, ok
}

// prefetchDF df واژه‌های ناموجود در کش را دسته‌ای از vocab_n2 می‌خواند (واژهٔ ناموجود = df ۰).
func (r *ftsRelease) prefetchDF(ctx context.Context, words []string) error {
	var missing []string
	seen := map[string]bool{}
	r.dfMu.RLock()
	for _, w := range words {
		if _, ok := r.df[w]; !ok && !seen[w] {
			seen[w] = true
			missing = append(missing, w)
		}
	}
	r.dfMu.RUnlock()
	for start := 0; start < len(missing); start += 400 {
		end := start + 400
		if end > len(missing) {
			end = len(missing)
		}
		chunk := missing[start:end]
		args := make([]any, len(chunk))
		for i, w := range chunk {
			args[i] = w
		}
		rows, err := r.main.QueryContext(ctx, `SELECT n2, df FROM vocab_n2 WHERE n2 IN (`+placeholders(len(chunk))+`)`, args...)
		if err != nil {
			return fmt.Errorf("fts5 engine: vocab_n2: %w", err)
		}
		got := map[string]int{}
		for rows.Next() {
			var w string
			var df int
			if err := rows.Scan(&w, &df); err == nil {
				got[w] = df
			}
		}
		rows.Close()
		r.dfMu.Lock()
		if len(r.df) > dfCacheMax {
			r.df = map[string]int{}
		}
		for _, w := range chunk {
			r.df[w] = got[w]
		}
		r.dfMu.Unlock()
	}
	return nil
}

// weightFn تابع وزن سراسری واژه برای aligner (پس از prefetchDF).
func (r *ftsRelease) weightFn() func(string) float64 {
	return func(n2 string) float64 {
		df, _ := r.dfOf(n2)
		return TokenWeight(df, r.passages)
	}
}

// existsN1 کدام واژه‌های N1 در واژگان نسل هستند (پاسبان گونه‌های فارسی و L5).
func (r *ftsRelease) existsN1(ctx context.Context, words []string) (map[string]bool, error) {
	out := map[string]bool{}
	uniq := dedupStrings(words)
	for start := 0; start < len(uniq); start += 400 {
		end := start + 400
		if end > len(uniq) {
			end = len(uniq)
		}
		chunk := uniq[start:end]
		rows, err := r.main.QueryContext(ctx, `SELECT n1 FROM vocabulary WHERE n1 IN (`+placeholders(len(chunk))+`)`, toStrs(chunk)...)
		if err != nil {
			return nil, fmt.Errorf("fts5 engine: vocabulary: %w", err)
		}
		for rows.Next() {
			var w string
			if rows.Scan(&w) == nil {
				out[w] = true
			}
		}
		rows.Close()
	}
	return out, nil
}
