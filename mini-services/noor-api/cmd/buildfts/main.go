// Package main — سازندهٔ نسل FTS5 (پایگاه اصلی + شاردها) بر اساس §۲۰/§۲۱/§۲۲/§۲۴.
//
// دو منبع ورودی:
//
//   - -sources <dir>: کاتالوگ رسمی (catalog.json) و همان استخراج worker (catalog.ModelUncached:
//     صفحه‌بندی، پاورقی، بخش‌ها). مسیر توصیه‌شده برای نسل تولید.
//   - -corpus <file.json>: فهرست پایلوت (فایل‌های sqlite نور). استخراج سبک فقط StoryId=1
//     (متن اصلی) است و نشانی صفحه/پاورقی را مانند worker بازسازی نمی‌کند — فقط برای آزمایش.
//
// اسناد به‌صورت موازی decode می‌شوند اما دقیقاً به ترتیب ورودی (canonical) نوشته می‌شوند تا
// seq/rowid و مرتب‌سازی «منبع» در همهٔ ساخت‌ها یکسان باشد. هیچ خطایی بی‌صدا رد نمی‌شود:
// سند یا آیتمِ decode‌نشده در manifest (failures) ثبت و در پایان گزارش می‌شود و برنامه با کد
// غیرصفر خارج می‌شود مگر -allow-failures داده شود.
//
// خروجی: <data>/fts/<release>.building → Finalize → Commit (بررسی checksum) → <data>/fts/<release>؛
// با -publish نسل فعال (fts/ACTIVE) هم به‌صورت اتمیک عوض می‌شود.
package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"runtime"
	"sync"
	"time"

	_ "modernc.org/sqlite"
	"noor/internal/catalog"
	"noor/internal/index"
	"noor/internal/noordb"
	"noor/internal/xmlparse"
)

type CorpusDoc struct {
	CollectionUID string `json:"collection_uid"`
	WorkUID       string `json:"work_uid"`
	WorkTitle     string `json:"work_title"`
	WorkAuthor    string `json:"work_author"`
	DocumentUID   string `json:"document_uid"`
	DocumentLabel string `json:"document_label"`
	Language      string `json:"language"`
	File          string `json:"file"`
	Disk          string `json:"disk"`
}

type docResult struct {
	idx         int
	doc         CorpusDoc
	model       *xmlparse.DocModel
	itemsFailed int
	err         error
}

// extractPilot استخراج سبک پایلوت: StoryId=1، به ترتیب ItemNo. آیتم خراب شمرده می‌شود.
func extractPilot(c CorpusDoc) (*xmlparse.DocModel, int, error) {
	db, err := sql.Open("sqlite", fmt.Sprintf("file:%s?mode=ro", c.File))
	if err != nil {
		return nil, 0, fmt.Errorf("باز کردن دیتابیس %s: %w", c.File, err)
	}
	defer db.Close()
	dict, err := noordb.LoadDictionary(db)
	if err != nil {
		return nil, 0, fmt.Errorf("لود دیکشنری %s: %w", c.File, err)
	}
	rows, err := db.Query(`SELECT Id, Context FROM DocItem WHERE StoryId = 1 ORDER BY ItemNo, Id`)
	if err != nil {
		return nil, 0, fmt.Errorf("استعلام DocItem: %w", err)
	}
	defer rows.Close()
	var items []xmlparse.ItemInput
	failed := 0
	for rows.Next() {
		var id int64
		var blob []byte
		if err := rows.Scan(&id, &blob); err != nil {
			return nil, failed, fmt.Errorf("خواندن DocItem: %w", err)
		}
		if len(blob) == 0 {
			continue
		}
		decoded, err := noordb.DecodeLZW(blob, dict)
		if err != nil {
			failed++
			continue
		}
		items = append(items, xmlparse.ItemInput{ID: id, XML: decoded})
	}
	if err := rows.Err(); err != nil {
		return nil, failed, err
	}
	if len(items) == 0 {
		return nil, failed, fmt.Errorf("سند %s آیتم متنی ندارد", c.DocumentUID)
	}
	m, err := xmlparse.ParseItems(c.DocumentUID, items)
	return m, failed, err
}

func main() {
	sourcesDir := flag.String("sources", "", "پوشهٔ کاتالوگ رسمی (catalog.json)؛ در صورت تعیین، -corpus نادیده گرفته می‌شود")
	corpusPath := flag.String("corpus", "data/pilot_100_corpus.json", "فهرست پایلوت کتب (JSON)")
	dataDir := flag.String("data", "data", "پوشهٔ داده؛ نسل در <data>/fts/<release> ساخته می‌شود")
	releaseUID := flag.String("release", "", "شناسهٔ نسل (پیش‌فرض rel-fts-<unix>)")
	numShards := flag.Int("shards", 4, "تعداد شاردهای FTS5")
	limit := flag.Int("limit", -1, "حداکثر تعداد جلدها (-1 = همه)")
	numWorkers := flag.Int("workers", runtime.NumCPU(), "تعداد کارگران موازی decode")
	publish := flag.Bool("publish", false, "پس از ساخت موفق، نسل را فعال کن (fts/ACTIVE)")
	allowFailures := flag.Bool("allow-failures", false, "با وجود سند/آیتم ناموفق هم نسل را commit کن (خطاها در manifest می‌مانند)")
	flag.Parse()
	if *numWorkers <= 0 {
		*numWorkers = 1
	}
	if *releaseUID == "" {
		*releaseUID = fmt.Sprintf("rel-fts-%d", time.Now().Unix())
	}
	t0 := time.Now()

	// ۱. فهرست اسناد به ترتیب canonical
	var corpus []CorpusDoc
	var cat *catalog.Service
	if *sourcesDir != "" {
		var err error
		cat, err = catalog.Load(*sourcesDir)
		if err != nil {
			log.Fatalf("کاتالوگ خوانده نشد: %v", err)
		}
		for _, wk := range cat.Works() {
			for _, d := range wk.Documents {
				corpus = append(corpus, CorpusDoc{CollectionUID: "col-fixture", WorkUID: wk.UID, WorkTitle: wk.Title, WorkAuthor: wk.Author, DocumentUID: d.UID, Language: d.Language})
			}
		}
	} else {
		data, err := os.ReadFile(*corpusPath)
		if err != nil {
			log.Fatalf("خطا در خواندن فایل پیکره: %v", err)
		}
		if err := json.Unmarshal(data, &corpus); err != nil {
			log.Fatalf("خطا در پارس JSON پیکره: %v", err)
		}
		log.Printf("هشدار: حالت پایلوت (-corpus) فقط متن اصلی (StoryId=1) را بدون نشانی صفحهٔ worker استخراج می‌کند؛ برای نسل تولید از -sources استفاده کنید.")
	}
	if *limit > 0 && *limit < len(corpus) {
		corpus = corpus[:*limit]
	}
	extract := func(c CorpusDoc) (*xmlparse.DocModel, int, error) {
		if cat != nil {
			m, err := cat.ModelUncached(c.DocumentUID)
			if err != nil {
				return nil, 0, err
			}
			return m, len(m.ParseErrors), nil
		}
		return extractPilot(c)
	}

	buildDir := index.FTSBuildingDir(*dataDir, *releaseUID)
	if _, err := os.Stat(index.FTSReleaseDir(*dataDir, *releaseUID)); err == nil {
		log.Fatalf("نسل %s از پیش وجود دارد؛ نسل‌ها immutable‌اند", *releaseUID)
	}
	index.AbortFTSBuild(*dataDir, *releaseUID)
	writer, err := index.NewFTSIndexWriter(index.FTSShardOptions{ReleaseUID: *releaseUID, OutputDir: buildDir, NumShards: *numShards})
	if err != nil {
		log.Fatalf("خطا در ایجاد FTSIndexWriter: %v", err)
	}
	ok := false
	defer func() {
		writer.Close()
		if !ok {
			index.AbortFTSBuild(*dataDir, *releaseUID)
		}
	}()
	log.Printf("ساخت نسل %s: %d جلد، %d شارد، %d کارگر", *releaseUID, len(corpus), *numShards, *numWorkers)

	// ۲. decode موازی با پنجرهٔ کران‌دار؛ نوشتن به ترتیب ورودی (reorder buffer)
	window := *numWorkers * 4
	tokens := make(chan struct{}, window)
	jobs := make(chan int, window)
	results := make(chan docResult, window)
	var wg sync.WaitGroup
	for w := 0; w < *numWorkers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range jobs {
				m, failed, err := extract(corpus[i])
				results <- docResult{idx: i, doc: corpus[i], model: m, itemsFailed: failed, err: err}
			}
		}()
	}
	go func() {
		for i := range corpus {
			tokens <- struct{}{} // بیش از window سند در حافظه منتظر نوشتن نمی‌ماند
			jobs <- i
		}
		close(jobs)
		wg.Wait()
		close(results)
	}()

	var titles []index.TitleRow
	seenWorks := map[string]bool{}
	pending := map[int]docResult{}
	nextIdx, indexedDocs, totalPassages, failedDocs, partialDocs, failedItems := 0, 0, 0, 0, 0, 0
	write := func(res docResult) error {
		defer func() { <-tokens }()
		label := fmt.Sprintf("[%d/%d] %s", res.idx+1, len(corpus), res.doc.DocumentUID)
		if res.err != nil {
			failedDocs++
			writer.RecordFailure(res.doc.DocumentUID, res.err)
			log.Printf("%s: سند نمایه نشد: %v", label, res.err)
			return nil
		}
		if res.itemsFailed > 0 {
			partialDocs++
			failedItems += res.itemsFailed
			writer.RecordFailure(res.doc.DocumentUID, fmt.Errorf("نمایهٔ ناقص: %d آیتم decode/parse نشد", res.itemsFailed))
		}
		col := res.doc.CollectionUID
		if col == "" {
			col = "col-pilot"
		}
		n, err := writer.WriteDocument(*releaseUID, col, res.doc.WorkUID, res.doc.DocumentUID, res.doc.Language, res.model)
		if err != nil {
			return fmt.Errorf("%s: نوشتن در نمایه: %w", label, err) // خطای پایگاه = توقف ساخت
		}
		indexedDocs++
		totalPassages += n
		if !seenWorks[res.doc.WorkUID] {
			seenWorks[res.doc.WorkUID] = true
			titles = append(titles, index.TitleRow{WorkUID: res.doc.WorkUID, Title: res.doc.WorkTitle, ShortTitle: res.doc.WorkTitle, Author: res.doc.WorkAuthor, Language: res.doc.Language})
		}
		if indexedDocs%20 == 0 {
			log.Printf("%d سند / %d قطعه نوشته شد (%v)", indexedDocs, totalPassages, time.Since(t0).Round(time.Second))
		}
		return nil
	}
	for res := range results {
		pending[res.idx] = res
		for {
			r, okp := pending[nextIdx]
			if !okp {
				break
			}
			delete(pending, nextIdx)
			nextIdx++
			if err := write(r); err != nil {
				writer.Close()
				index.AbortFTSBuild(*dataDir, *releaseUID)
				log.Fatalf("%v", err)
			}
		}
	}
	if nextIdx != len(corpus) {
		log.Fatalf("ناسازگاری داخلی: %d از %d سند پردازش شد", nextIdx, len(corpus))
	}

	// ۳. نهایی‌سازی، commit و انتشار
	log.Printf("نهایی‌سازی (واژگان، optimize، integrity-check، checksum)...")
	if err := writer.Finalize(titles); err != nil {
		log.Fatalf("خطا در Finalize: %v", err)
	}
	writer.Close()
	if (failedDocs > 0 || partialDocs > 0) && !*allowFailures {
		log.Printf("ساخت متوقف شد: %d سند ناموفق، %d سند ناقص (%d آیتم). برای پذیرش آگاهانه -allow-failures بدهید.", failedDocs, partialDocs, failedItems)
		index.AbortFTSBuild(*dataDir, *releaseUID)
		os.Exit(2) // defer با os.Exit اجرا نمی‌شود → پاک‌سازی دستی بالا
	}
	if err := index.CommitFTSBuild(*dataDir, *releaseUID); err != nil {
		log.Fatalf("commit نسل: %v", err)
	}
	ok = true
	if *publish {
		if err := index.PublishFTSRelease(*dataDir, *releaseUID, 2); err != nil {
			log.Fatalf("انتشار نسل: %v", err)
		}
		log.Printf("نسل %s فعال شد (fts/ACTIVE)", *releaseUID)
	}
	log.Printf("نسل %s ساخته شد در %v — اسناد: %d، قطعه‌ها: %d، عناوین: %d، ناموفق: %d، ناقص: %d",
		*releaseUID, time.Since(t0).Round(time.Millisecond), indexedDocs, totalPassages, len(titles), failedDocs, partialDocs)
	if failedDocs > 0 || partialDocs > 0 {
		fmt.Fprintln(os.Stderr, errors.New("هشدار: نسل با خطاهای ثبت‌شده در manifest ساخته شد (-allow-failures)"))
	}
}
