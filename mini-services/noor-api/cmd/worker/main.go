// worker — claim کارها از صف و اجرا (import/نمایه‌سازی)؛ وضعیت از طریق API داخلی ثبت می‌شود.
package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"time"

	"noor/internal/catalog"
	"noor/internal/config"
	"noor/internal/index"
	"noor/internal/norm"
	"noor/internal/overlay"
	"noor/internal/search"
)

// apiClient کلاینت با تایم‌اوت — apiClient بدون تایم‌اوت بود و اگر API
// هنگ می‌کرد worker برای همیشه قفل می‌شد.
var apiClient = &http.Client{Timeout: 30 * time.Second}

func main() {
	cfg := config.FromEnv()
	// نشانی API داخلی: در تولید (compose) worker در کانتینر جداست → NOOR_API_INTERNAL_URL=http://api:8080؛
	// در توسعهٔ تک‌میزبان (run-local.sh) پیش‌فرض 127.0.0.1:8080 بدون تغییر کار می‌کند.
	api := envOr("NOOR_API_INTERNAL_URL", "http://127.0.0.1:"+cfg.HTTPPort)
	log.Println("worker polling", api)
	for {
		job := claim(api)
		if job == nil {
			time.Sleep(2 * time.Second)
			continue
		}
		log.Println("job claimed:", job["uid"])
		runJobSafe(cfg, api, job)
	}
}

// runJobSafe اجرای یک کار با recover: panic یک کار (دادهٔ خراب) worker را نمی‌اندازد و
// کار صادقانه failed می‌شود تا lease آن بی‌دلیل منتظر انقضا نماند.
func runJobSafe(cfg *config.Config, api string, job map[string]any) {
	uid := fmt.Sprint(job["uid"])
	defer func() {
		if p := recover(); p != nil {
			log.Printf("worker: panic in job %s: %v", uid, p)
			fail(api, uid, fmt.Sprintf("خطای داخلی worker: %v", p))
		}
	}()
	switch fmt.Sprint(job["kind"]) {
	case "index_rebuild":
		runIndexRebuild(cfg, api, job)
	default:
		fail(api, uid, "نوع کار شناخته نشده است")
	}
}

// ftsShardCount شمار شاردهای FTS5 (NOOR_FTS_SHARDS، پیش‌فرض ۴).
func ftsShardCount() int {
	n := 4
	if v := os.Getenv("NOOR_FTS_SHARDS"); v != "" {
		if _, err := fmt.Sscan(v, &n); err != nil || n < 1 || n > 64 {
			n = 4
		}
	}
	return n
}

// envOr خواندن متغیر محیطی با مقدار پیش‌فرض (هم‌سبک config.env).
func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func claim(api string) map[string]any {
	req, _ := http.NewRequest("POST", api+"/api/v1/internal/jobs/claim", nil)
	req.Header.Set("X-Noor-Service", os.Getenv("NOOR_SERVICE_TOKEN"))
	resp, err := apiClient.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	var out struct {
		Job map[string]any `json:"job"`
	}
	if json.NewDecoder(resp.Body).Decode(&out) == nil {
		return out.Job
	}
	return nil
}

// progress پیشرفت را ثبت و وضعیت فعلی کار را برمی‌گرداند (برای توقف همیارِ «cancelled»).
// «cancelled» فقط زمانی برمی‌گردد که ادمین کار را لغو کرده باشد؛ worker باید پیش از
// هر مرحلهٔ انتشار (bulk OpenSearch / جابه‌جایی نسل / publish) آن را ببیند و بدون
// انتشار خارج شود — لغو دیگر بی‌اثر نیست.
func progress(api, uid string, p int, note string) string {
	b, _ := json.Marshal(map[string]any{"progress": p, "note": note})
	req, _ := http.NewRequest("POST", api+"/api/v1/internal/jobs/"+uid+"/progress", bytes.NewReader(b))
	req.Header.Set("X-Noor-Service", os.Getenv("NOOR_SERVICE_TOKEN"))
	resp, err := apiClient.Do(req)
	if err == nil {
		var out struct {
			Status string `json:"status"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&out)
		resp.Body.Close()
		return out.Status
	}
	return ""
}

func complete(api, uid string, result map[string]any) {
	b, _ := json.Marshal(map[string]any{"result": result})
	req, _ := http.NewRequest("POST", api+"/api/v1/internal/jobs/"+uid+"/complete", bytes.NewReader(b))
	req.Header.Set("X-Noor-Service", os.Getenv("NOOR_SERVICE_TOKEN"))
	resp, err := apiClient.Do(req)
	if err == nil {
		resp.Body.Close()
	}
}

func fail(api, uid, msg string) {
	b, _ := json.Marshal(map[string]any{"error": msg})
	req, _ := http.NewRequest("POST", api+"/api/v1/internal/jobs/"+uid+"/fail", bytes.NewReader(b))
	req.Header.Set("X-Noor-Service", os.Getenv("NOOR_SERVICE_TOKEN"))
	resp, err := apiClient.Do(req)
	if err == nil {
		resp.Body.Close()
	}
}

// runIndexRebuild ساخت نسل جدید نمایه؛ شکست → failed (هرگز نیم‌بنا منتشر نمی‌شود).
func runIndexRebuild(cfg *config.Config, api string, job map[string]any) {
	uid := fmt.Sprint(job["uid"])
	var payload struct {
		Reason     string `json:"reason"`
		OverlayUID string `json:"overlay_uid"`
	}
	raw, _ := json.Marshal(job["payload"])
	_ = json.Unmarshal(raw, &payload)

	// شکستِ کار در مسیر اصلاح محتوایی → وضعیت اصلاح هم failed می‌شود (دور ۱۴)
	if err := runIndexRebuildBody(cfg, api, uid, payload, func(msg string) {
		fail(api, uid, msg)
		if payload.OverlayUID != "" {
			markOverlayStatus(api, payload.OverlayUID, "failed", "")
		}
	}); err != nil {
		log.Println("index rebuild error:", err)
	}
}

func runIndexRebuildBody(cfg *config.Config, api, uid string, payload struct {
	Reason     string `json:"reason"`
	OverlayUID string `json:"overlay_uid"`
}, failJob func(string)) error {
	cat, err := catalog.Load(cfg.SourcesDir)
	if err != nil {
		failJob("کاتالوگ خوانده نشد: " + err.Error())
		return err
	}
	releaseUID := "rel-" + fmt.Sprint(time.Now().UnixNano())
	// نسل جدید در فایل موقت ساخته می‌شود؛ پس از موفقیت جابه‌جا (نسل immutable)
	// نام یکتا: با دو worker موازی (یا enqueue هم‌زمان) فایل ساختنِ همدیگر پاک نمی‌شود
	tmp := filepath.Join(cfg.DataDir, "index.building-"+releaseUID+".sqlite")
	_ = os.Remove(tmp)
	idxDB, err := index.OpenWrite(tmp)
	if err != nil {
		failJob("نمایهٔ جدید باز نشد: " + err.Error())
		return err
	}
	w := &index.IndexWriter{DB: idxDB}
	// DB-01 (حافظهٔ کران‌دار): مدل اسناد دیگر یک‌جا انباشته نمی‌شود؛ فقط فهرست سبک
	// مراجع (فرادادهٔ کوچک) ساخته می‌شود و هر مدل در لحظهٔ نوشتن decode و بلافاصله
	// رها می‌شود — peak حافظه به شمار اسناد کورپوس وابسته نمی‌ماند.
	type docRef struct {
		workUID, docUID, language string
	}
	var refs []docRef
	var titles []index.TitleRow
	seenTitles := map[string]bool{}
	for _, wk := range cat.Works() {
		for _, d := range wk.Documents {
			refs = append(refs, docRef{workUID: wk.UID, docUID: d.UID, language: d.Language})
			if !seenTitles[wk.UID] {
				seenTitles[wk.UID] = true
				pub := ""
				if wk.Publisher != nil {
					pub = *wk.Publisher
				}
				titles = append(titles, index.TitleRow{WorkUID: wk.UID, Title: wk.Title, ShortTitle: wk.ShortTitle, Author: wk.Author, Publisher: pub, Language: wk.Language, Topics: wk.Topics})
			}
		}
	}
	pos := 0
	skipped := 0
	parseErrDocs := 0
	cancelled := false
	// اصلاحات آمادهٔ اعمال: همهٔ readyها + اصلاح ارجاع‌شدهٔ همین کار
	overlaysByDoc, _ := fetchActiveOverlays(api, payload.OverlayUID)
	overlaysApplied := 0
	// ویژگی‌های واقعی هر اثر از مدل اسناد (منبع حقیقت پوشش در /works)
	workFeats := map[string]map[string]bool{}
	overlayAppliedUIDs := map[string]bool{}
	overlayRequested := map[string]bool{}
	for _, reps := range overlaysByDoc {
		for _, rep := range reps {
			overlayRequested[rep.UID] = true
		}
	}

	// موتور FTS5 (§۲۴): نسل FTS در همان حلقه، با همان releaseUID و همان ترتیب کاتالوگ ساخته
	// می‌شود تا دو نمایه هرگز از دو برداشت متفاوت کاتالوگ نباشند. ساخت در fts/<rel>.building،
	// commit (بررسی checksum) پیش از جابه‌سازی index.sqlite و انتشار ACTIVE پس از آن.
	var ftsW *index.FTSIndexWriter
	abortFTS := func() {
		if ftsW != nil {
			ftsW.Close()
			ftsW = nil
		}
		if cfg.Engine == "fts5" {
			index.AbortFTSBuild(cfg.DataDir, releaseUID)
		}
	}
	if cfg.Engine == "fts5" {
		index.AbortFTSBuild(cfg.DataDir, releaseUID)
		ftsW, err = index.NewFTSIndexWriter(index.FTSShardOptions{
			ReleaseUID: releaseUID,
			OutputDir:  index.FTSBuildingDir(cfg.DataDir, releaseUID),
			NumShards:  ftsShardCount(),
		})
		if err != nil {
			idxDB.Close()
			_ = os.Remove(tmp)
			failJob("نمایهٔ FTS5 باز نشد: " + err.Error())
			return err
		}
	}
	ftsPublished := false
	defer func() {
		// مسیرهای خطا/لغو: نسل نیم‌ساخت یا commit‌شده‌ولی‌منتشرنشدهٔ FTS حذف می‌شود
		if cfg.Engine == "fts5" && !ftsPublished {
			abortFTS()
			_ = os.RemoveAll(index.FTSReleaseDir(cfg.DataDir, releaseUID))
		}
	}()
	next := func() (*index.DocInput, error) {
		for {
			if pos >= len(refs) {
				return nil, io.EOF
			}
			r := refs[pos]
			pos++
			if len(refs) > 0 {
				if st := progress(api, uid, (pos-1)*100/len(refs), "در حال نمایه‌سازی "+r.docUID); st == "cancelled" {
					cancelled = true // لغو ادمین: جریان ساخت بدون انتشار پایان می‌یابد
					return nil, io.EOF
				}
			}
			// ModelUncached (بدون LRU): مدل پس از نوشتنِ همین سند رها می‌شود (DB-01)
			m, err := cat.ModelUncached(r.docUID)
			if err != nil {
				skipped++
				if ftsW != nil {
					ftsW.RecordFailure(r.docUID, err)
				}
				log.Println("skip doc (reported):", r.docUID, err)
				continue // سند ردشده صادقانه شمرده می‌شود؛ جریان ادامه می‌یابد
			}
			// اعمال اصلاحات محتوایی پیش از نمایه‌سازی — متنِ نمایه‌شده = متنِ نمایشی
			if reps, ok := overlaysByDoc[r.docUID]; ok {
				for _, rep := range reps {
					if ch := overlay.ApplyToModel(m, []overlay.Replacement{rep}); ch > 0 {
						overlaysApplied += ch
						overlayAppliedUIDs[rep.UID] = true
					}
				}
			}
			// جمع‌ویژگی‌های واقعی اثر (DATA-08) — از همان مدلی که نمایه می‌شود
			feats := workFeats[r.workUID]
			if feats == nil {
				feats = map[string]bool{}
				workFeats[r.workUID] = feats
			}
			if len(m.Blocks) > 0 {
				feats["searchable"] = true
			}
			if len(m.Hadiths) > 0 {
				feats["hadith"] = true
			}
			if len(m.Citations) > 0 {
				feats["quran"] = true
			}
			if len(m.Footnotes) > 0 {
				feats["footnotes"] = true
			}
			if len(m.Pages) > 0 {
				feats["pages"] = true
			}
			if len(m.Sections) > 0 {
				feats["toc"] = true
			}
			for bi := range m.Blocks {
				if len(m.Blocks[bi].Links) > 0 {
					feats["links"] = true
					break
				}
			}
			// DB-03: سند ناقص (خطای parse/decode) به‌جای سکوت، شمرده و گزارش می‌شود
			if len(m.ParseErrors) > 0 {
				parseErrDocs++
				log.Printf("doc %s ناقص نمایه شد: %d خطای parse/decode", r.docUID, len(m.ParseErrors))
			}
			if ftsW != nil {
				if _, err := ftsW.WriteDocument(releaseUID, "col-fixture", r.workUID, r.docUID, r.language, m); err != nil {
					return nil, fmt.Errorf("نمایهٔ FTS5 سند %s: %w", r.docUID, err)
				}
			}
			return &index.DocInput{
				CollectionUID: "col-fixture", WorkUID: r.workUID, DocumentUID: r.docUID, Language: r.language, Model: m,
			}, nil
		}
	}
	n, err := w.RebuildStream(releaseUID, titles, next)
	if err != nil {
		failJob("ساخت نمایه ناموفق: " + err.Error())
		return err
	}
	idxDB.Close()
	if cancelled {
		// لغو در حین ساخت (ممیزی: لغو job بی‌اثر نباید بماند): نمایهٔ نیم‌ساخت حذف و
		// بدون انتشار/انتشار-نسل خارج می‌شویم؛ وضعیت «cancelled» دست‌نخورده می‌ماند.
		_ = os.Remove(tmp)
		log.Println("index rebuild cancelled by admin; nothing published:", uid)
		return nil
	}
	if skipped > 0 || parseErrDocs > 0 {
		log.Printf("جمع‌بندی پوشش نسل: %d سند سالم، %d سند ردشده، %d سند ناقص (خطاها در ParseErrors سند ثبت شده است)", len(refs)-skipped, skipped, parseErrDocs)
	}

	// نمایه‌سازی OpenSearch (الف-۱): وقتی NOOR_ENGINE=opensearch است، سندها با bulk
	// کنترل‌نرخ‌شده به OpenSearch نیز منتقل می‌شوند؛ شکست = شکست کار (نسل نیم‌بنا منتشر نمی‌شود).
	// لغو پیش از مرحلهٔ سنگین bulk (ممیزی: لغو باید پیش از هر انتشار دیده شود)
	if progress(api, uid, 35, "پیش از نمایه‌سازی OpenSearch") == "cancelled" {
		_ = os.Remove(tmp)
		log.Println("index rebuild cancelled by admin; nothing published:", uid)
		return nil
	}
	if ftsW != nil {
		if progress(api, uid, 40, "نهایی‌سازی نمایهٔ FTS5 (optimize، integrity-check، checksum)") == "cancelled" {
			_ = os.Remove(tmp)
			log.Println("index rebuild cancelled by admin; nothing published:", uid)
			return nil
		}
		if err := ftsW.Finalize(titles); err != nil {
			_ = os.Remove(tmp)
			failJob("نهایی‌سازی نمایهٔ FTS5 ناموفق بود: " + err.Error())
			return err
		}
		ftsW.Close()
		ftsW = nil
		if err := index.CommitFTSBuild(cfg.DataDir, releaseUID); err != nil {
			index.AbortFTSBuild(cfg.DataDir, releaseUID)
			_ = os.Remove(tmp)
			failJob("بررسی نسل FTS5 ناموفق بود: " + err.Error())
			return err
		}
	}
	if cfg.Engine == "opensearch" {
		if err := bulkIndexOpenSearch(cfg, tmp, releaseUID, titles, func(p int, note string) { progress(api, uid, p, note) }); err != nil {
			failJob("نمایه‌سازی OpenSearch ناموفق بود: " + err.Error())
			return err
		}
	}

	// لغو پیش از انتشار: هیچ نسل نیم‌کارِ لغوشده منتشر نمی‌شود
	if progress(api, uid, 70, "پیش از انتشار نسل") == "cancelled" {
		_ = os.Remove(tmp)
		log.Println("index rebuild cancelled by admin; nothing published:", uid)
		return nil
	}
	active, _ := indexFile(cfg.DataDir)
	prevPath := filepath.Join(cfg.DataDir, "index.previous.sqlite")
	prevOSRelease := releaseOfIndex(active) // برای پاک‌سازی OpenSearch: نسل قبلی حفظ می‌شود
	prevFTS, _ := index.ActiveFTSRelease(cfg.DataDir)
	// جابه‌سازی اتمیک
	hadActive := false
	if active != "" {
		if err := os.Rename(active, prevPath); err != nil {
			_ = os.Remove(tmp)
			failJob("جابه‌سازی نمایهٔ قبلی ناموفق: " + err.Error())
			return err
		}
		hadActive = true
	}
	if err := os.Rename(tmp, active2(cfg.DataDir)); err != nil {
		if hadActive {
			_ = os.Rename(prevPath, active2(cfg.DataDir))
		}
		failJob("جابه‌سازی نمایه ناموفق: " + err.Error())
		return err
	}
	index.SyncDir(cfg.DataDir)
	// restore بازگردانی کامل به نسل پیشین اگر هر مرحلهٔ انتشارِ بعدی شکست بخورد —
	// بدون آن index.sqlite/fts/ACTIVE روی نسل جدید و pointer app.sqlite روی نسل قدیم
	// می‌ماند (split-brain).
	restore := func() {
		if hadActive {
			if err := os.Rename(prevPath, active2(cfg.DataDir)); err != nil {
				log.Println("rollback index.sqlite failed:", err)
			}
		}
		if ftsPublished {
			if err := index.RevertFTSPublish(cfg.DataDir, releaseUID, prevFTS); err != nil {
				log.Println("rollback fts ACTIVE failed:", err)
			}
			ftsPublished = false // defer پوشهٔ نسل شکست‌خورده را پاک می‌کند
		}
		index.SyncDir(cfg.DataDir)
	}
	// انتشار نسل FTS5 هم‌زمان با index.sqlite: fts/ACTIVE به‌صورت اتمیک؛ API در ≤۲ ثانیه
	// نسل تازه را باز می‌کند و نشست‌های قدیمی روی نسل خودشان می‌مانند.
	if cfg.Engine == "fts5" {
		if err := index.PublishFTSRelease(cfg.DataDir, releaseUID, 2); err != nil {
			restore()
			failJob("انتشار نسل FTS5 ناموفق بود: " + err.Error())
			return err
		}
		ftsPublished = true
	}
	// انتشار نسل: pointer اتمیک در app.sqlite از طریق API داخلی
	b, _ := json.Marshal(map[string]any{"release_uid": releaseUID, "manifest": map[string]any{"passages": n, "docs": len(refs) - skipped, "docs_skipped": skipped, "docs_with_parse_errors": parseErrDocs, "overlay_blocks_changed": overlaysApplied}})
	req, _ := http.NewRequest("POST", api+"/api/v1/internal/releases/publish", bytes.NewReader(b))
	req.Header.Set("X-Noor-Service", os.Getenv("NOOR_SERVICE_TOKEN"))
	resp, err := apiClient.Do(req)
	if err == nil {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<16))
		resp.Body.Close()
		if resp.StatusCode >= 300 {
			err = fmt.Errorf("HTTP %d", resp.StatusCode)
		}
	}
	if err != nil {
		// پاسخ غیر-2xx هم شکست است (قبلاً فقط خطای شبکه دیده می‌شد)
		restore()
		failJob("انتشار نسل ممکن نشد: " + err.Error())
		return err
	}
	if cfg.Engine == "opensearch" {
		pruneOpenSearchReleases(cfg, releaseUID, prevOSRelease)
	}
	postFeatures(api, workFeats)
	// اصلاح محتوایی: همهٔ اصلاحات واقعاً اعمال‌شده منتشر می‌شوند؛ اصلاح درخواستی
	// که در متن پیدا نشد صادقانه failed می‌شود (نه publishedِ جعلی).
	for uid := range overlayAppliedUIDs {
		markOverlayStatus(api, uid, "published", releaseUID)
	}
	if payload.OverlayUID != "" && !overlayAppliedUIDs[payload.OverlayUID] && overlayRequested[payload.OverlayUID] {
		markOverlayStatus(api, payload.OverlayUID, "failed", "")
		log.Println("overlay old_value not found in document:", payload.OverlayUID)
	}
	complete(api, uid, map[string]any{"passages": n, "release_uid": releaseUID, "docs": len(refs) - skipped, "docs_skipped": skipped, "docs_with_parse_errors": parseErrDocs, "opensearch_indexed": cfg.Engine == "opensearch", "overlay_blocks_changed": overlaysApplied})
	log.Println("index rebuilt & published:", n, "passages, release", releaseUID)
	return nil
}

// markOverlayStatus ثبت وضعیت اصلاح از طریق endpoint داخلی (best-effort).
func markOverlayStatus(api, overlayUID, status, releaseUID string) {
	b, _ := json.Marshal(map[string]any{"status": status, "release_uid": releaseUID})
	req, _ := http.NewRequest("POST", api+"/api/v1/internal/overlays/"+overlayUID+"/status", bytes.NewReader(b))
	req.Header.Set("X-Noor-Service", os.Getenv("NOOR_SERVICE_TOKEN"))
	if resp, err := apiClient.Do(req); err == nil {
		resp.Body.Close()
	}
}

func indexFile(dataDir string) (string, error) {
	p := filepath.Join(dataDir, "index.sqlite")
	if _, err := os.Stat(p); err != nil {
		return "", err
	}
	return p, nil
}

func active2(dataDir string) string {
	return filepath.Join(dataDir, "index.sqlite")
}

// bulkIndexOpenSearch خواندن passages/titles از نمایهٔ تازه‌ساخته و ارسال bulk به OpenSearch
// (اندازهٔ دسته و مکث ثابت برای نرخ کنترل‌شده؛ _source سمت OpenSearch حداقلی نگه داشته می‌شود).
func bulkIndexOpenSearch(cfg *config.Config, idxPath, releaseUID string, titles []index.TitleRow, progress func(int, string)) error {
	db, err := sql.Open("sqlite", "file:"+idxPath+"?mode=ro")
	if err != nil {
		return err
	}
	defer db.Close()
	client := newOSWorkerClient(cfg)
	ctx := context.Background()
	indexName := os.Getenv("NOOR_OS_INDEX")
	if indexName == "" {
		indexName = "noor-passages"
	}
	if err := client.ensureMapping(ctx, indexName); err != nil {
		return err
	}
	rows, err := db.Query(`SELECT passage_uid, release_uid, collection_uid, work_uid, document_uid, section_uid, page_uid, page_label, language, local_hadith_uid, revayat_index, text_original, text_n1, n1_map, source_start, source_end, role_ranges, citations, fingerprint, block_start, block_end FROM passages WHERE release_uid=?`, releaseUID)
	if err != nil {
		return err
	}
	defer rows.Close()
	var items []map[string]any
	var ids []string
	sent := 0
	flush := func() error {
		if len(items) == 0 {
			return nil
		}
		if err := client.bulk(ctx, indexName, items, ids); err != nil {
			return err
		}
		sent += len(ids)
		progress(40, fmt.Sprintf("نمایه‌سازی OpenSearch: %d موضع ارسال شد", sent))
		items = items[:0]
		ids = ids[:0]
		time.Sleep(100 * time.Millisecond) // نرخ کنترل‌شده
		return nil
	}
	for rows.Next() {
		var passageUID, relUID, collectionUID, workUID, documentUID, sectionUID, pageUID, pageLabel, language, localHadith, revayatIdx, textOriginal, textN1, n1Map, roleRanges, citations, fingerprint string
		var sourceStart, sourceEnd, blockStart, blockEnd int
		if err := rows.Scan(&passageUID, &relUID, &collectionUID, &workUID, &documentUID, &sectionUID, &pageUID, &pageLabel, &language, &localHadith, &revayatIdx, &textOriginal, &textN1, &n1Map, &sourceStart, &sourceEnd, &roleRanges, &citations, &fingerprint, &blockStart, &blockEnd); err != nil {
			return err
		}
		items = append(items, map[string]any{
			"kind": "passage", "passage_uid": passageUID, "release_uid": relUID,
			"collection_uid": collectionUID, "work_uid": workUID, "document_uid": documentUID,
			"section_uid": sectionUID, "page_uid": pageUID, "page_label": pageLabel,
			"language": language, "local_hadith_uid": localHadith, "revayat_index": revayatIdx,
			"text_original": textOriginal, "text_n1": textN1, "n1_map": n1Map,
			"source_start": sourceStart, "source_end": sourceEnd,
			"role_ranges": roleRanges, "citations": citations, "citation_keys": search.CitationKeys(citations), "fingerprint": fingerprint,
			"block_start": blockStart, "block_end": blockEnd,
		})
		ids = append(ids, passageUID)
		if len(items) >= 500 {
			if err := flush(); err != nil {
				return err
			}
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if err := flush(); err != nil {
		return err
	}
	// عنوان‌ها (kind=title) — جست‌وجوی نام کتاب روی OpenSearch
	var tItems []map[string]any
	var tIDs []string
	for _, t := range titles {
		tn := norm.Fold(t.Title)
		sn := norm.Fold(t.ShortTitle)
		tItems = append(tItems, map[string]any{
			"kind": "title", "work_uid": t.WorkUID, "title": t.Title, "short_title": t.ShortTitle,
			"author": t.Author, "title_search": tn + " " + sn,
		})
		tIDs = append(tIDs, "title-"+t.WorkUID)
	}
	if len(tItems) > 0 {
		if err := client.bulk(ctx, indexName, tItems, tIDs); err != nil {
			return err
		}
	}
	progress(60, "نمایه‌سازی OpenSearch کامل شد")
	return nil
}

// osWorkerClient کلاینت حداقلی worker برای OpenSearch (PUT index + bulk).
type osWorkerClient struct {
	base string
	user string
	pass string
	http *http.Client
}

func newOSWorkerClient(cfg *config.Config) *osWorkerClient {
	// DEP-01: همان TLS پیکربندی api (CA سفارشی/INSECURE صریح) — سازگار با compose مبتنی بر HTTPS
	return &osWorkerClient{base: cfg.OpenSearchURL, user: cfg.OpenSearchUser, pass: cfg.OpenSearchPass, http: cfg.OSHTTPClient(60 * time.Second)}
}

func (c *osWorkerClient) do(ctx context.Context, method, path string, body []byte) ([]byte, int, error) {
	rdr := bytes.NewReader(body)
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, rdr)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.user != "" {
		req.SetBasicAuth(c.user, c.pass)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
	return raw, resp.StatusCode, nil
}

func (c *osWorkerClient) ensureMapping(ctx context.Context, index string) error {
	_, code, err := c.do(ctx, "HEAD", "/"+index, nil)
	if err == nil && code == 200 {
		return nil
	}
	// mapping هم‌ارز آداپتور (internal/search/opensearch.go) — بدون stemming/stopword، tokenizer واژه‌محور
	body := `{"settings":{"number_of_shards":1,"number_of_replicas":0,"index.max_ngram_diff":22,"analysis":{"char_filter":{"noor_strip":{"type":"mapping","mappings":["\\u0610 => ","\\u0611 => ","\\u0612 => ","\\u064B => ","\\u064C => ","\\u064E => ","\\u064F => ","\\u0650 => ","\\u0651 => ","\\u0652 => ","\\u0653 => ","\\u0654 => ","\\u0655 => ","\\u0656 => ","\\u0670 => ","\\u0674 => ","\\u06D6 => ","\\u06D7 => ","\\u06D8 => ","\\u06D9 => ","\\u06DA => ","\\u06DB => ","\\u06DC => ","\\u06DF => ","\\u06E0 => ","\\u06E1 => ","\\u06E2 => ","\\u06E3 => ","\\u06E4 => ","\\u06E7 => ","\\u06E8 => ","\\u06EA => ","\\u06EB => ","\\u06EC => ","\\u06ED => ","\\u0640 => "]},"noor_fold":{"type":"mapping","mappings":["أ => ا","إ => ا","آ => ا","ٱ => ا","ؤ => و","ئ => ی","ة => ه","ى => ی","ي => ی","ك => ک"]}},"tokenizer":{"noor_tok":{"type":"pattern","pattern":"([\\p{L}\\p{Nd}\\-\\u200C]+)","group":1}},"filter":{"title_ngram":{"type":"ngram","min_gram":2,"max_gram":24}},"analyzer":{"noor_n1":{"type":"custom","char_filter":["noor_strip"],"tokenizer":"noor_tok","filter":["lowercase"]},"noor_title":{"type":"custom","char_filter":["noor_fold"],"tokenizer":"noor_tok","filter":["lowercase","title_ngram"]},"noor_title_q":{"type":"custom","char_filter":["noor_fold"],"tokenizer":"noor_tok","filter":["lowercase"]}}}},"mappings":{"_source":{"excludes":["text_original","text_n1","n1_map","role_ranges","citations","citation_keys"]},"properties":{"kind":{"type":"keyword"},"passage_uid":{"type":"keyword"},"release_uid":{"type":"keyword"},"collection_uid":{"type":"keyword"},"work_uid":{"type":"keyword"},"document_uid":{"type":"keyword"},"section_uid":{"type":"keyword"},"page_uid":{"type":"keyword"},"page_label":{"type":"keyword"},"language":{"type":"keyword"},"local_hadith_uid":{"type":"keyword"},"revayat_index":{"type":"keyword"},"fingerprint":{"type":"keyword"},"citation_keys":{"type":"keyword"},"source_start":{"type":"integer"},"source_end":{"type":"integer"},"block_start":{"type":"integer"},"block_end":{"type":"integer"},"text_original":{"type":"text","analyzer":"noor_n1"},"text_n1":{"type":"text","analyzer":"noor_n1","fields":{"raw":{"type":"keyword"}}},"title":{"type":"keyword"},"short_title":{"type":"keyword"},"author":{"type":"keyword"},"title_search":{"type":"text","analyzer":"noor_title"}}}}`
	raw, code, err := c.do(ctx, "PUT", "/"+index, []byte(body))
	if err != nil {
		return err
	}
	if code >= 300 {
		return fmt.Errorf("ساخت index OpenSearch ناموفق (HTTP %d): %s", code, truncateStr(string(raw), 300))
	}
	return nil
}

func (c *osWorkerClient) bulk(ctx context.Context, index string, items []map[string]any, ids []string) error {
	var buf bytes.Buffer
	for i := range items {
		meta, _ := json.Marshal(map[string]any{"index": map[string]any{"_index": index, "_id": ids[i]}})
		buf.Write(meta)
		buf.WriteByte('\n')
		doc, err := json.Marshal(items[i])
		if err != nil {
			return err
		}
		buf.Write(doc)
		buf.WriteByte('\n')
	}
	raw, code, err := c.do(ctx, "POST", "/_bulk", buf.Bytes())
	if err != nil {
		return err
	}
	if code >= 300 {
		return fmt.Errorf("bulk ناموفق (HTTP %d): %s", code, truncateStr(string(raw), 300))
	}
	var out struct {
		Errors bool `json:"errors"`
	}
	if json.Unmarshal(raw, &out) == nil && out.Errors {
		return fmt.Errorf("bulk با خطای آیتمی مواجه شد: %s", truncateStr(string(raw), 300))
	}
	return nil
}

func truncateStr(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		return string(r[:n]) + "…"
	}
	return s
}

// releaseOfIndex شناسهٔ نسلِ یک index.sqlite (خالی اگر فایل/ردیفی نباشد).
func releaseOfIndex(path string) string {
	if path == "" {
		return ""
	}
	db, err := sql.Open("sqlite", "file:"+path+"?mode=ro")
	if err != nil {
		return ""
	}
	defer db.Close()
	var rel string
	_ = db.QueryRow(`SELECT release_uid FROM passages LIMIT 1`).Scan(&rel)
	return rel
}

// pruneOpenSearchReleases اسناد نسل‌های قدیمی‌تر از «جدید + قبلی» را از OpenSearch برمی‌دارد.
// نسل قبلی حفظ می‌شود چون نشست‌های بازِ جست‌وجو تا پایان TTL روی آن می‌مانند. ناهمگام
// (wait_for_completion=false) و best-effort: شکست فقط لاگ می‌شود و انتشار را برنمی‌گرداند.
func pruneOpenSearchReleases(cfg *config.Config, keep ...string) {
	var ks []string
	for _, k := range keep {
		if k != "" {
			ks = append(ks, k)
		}
	}
	if len(ks) == 0 {
		return
	}
	indexName := os.Getenv("NOOR_OS_INDEX")
	if indexName == "" {
		indexName = "noor-passages"
	}
	body, _ := json.Marshal(map[string]any{"query": map[string]any{"bool": map[string]any{
		"must_not": []any{map[string]any{"terms": map[string]any{"release_uid": ks}}},
		"filter":   []any{map[string]any{"exists": map[string]any{"field": "release_uid"}}},
	}}})
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	raw, code, err := newOSWorkerClient(cfg).do(ctx, "POST", "/"+indexName+"/_delete_by_query?conflicts=proceed&wait_for_completion=false", body)
	if err != nil || code >= 300 {
		log.Printf("opensearch prune of old releases failed (code=%d err=%v): %s", code, err, truncateStr(string(raw), 300))
	}
}

// overlayFetchItem شکل ردیف‌های /internal/overlays/active.
type overlayFetchItem struct {
	UID         string `json:"uid"`
	DocumentUID string `json:"document_uid"`
	ChangeType  string `json:"change_type"`
	OldValue    string `json:"old_value"`
	NewValue    string `json:"new_value"`
}

// fetchActiveOverlays فهرست اصلاحات قابل اعمال را از API داخلی می‌گیرد و بر سند
// گروه می‌کند. خطا هرگز بی‌صدا نیست: شکستِ واکشی اصلاحات یعنی ساختِ نسل بدون
// اصلاح — return nil تا کار با خطای صریح fail شود.
func fetchActiveOverlays(api, includeUID string) (map[string][]overlay.Replacement, []string) {
	u := api + "/api/v1/internal/overlays/active"
	if includeUID != "" {
		u += "?include=" + url.QueryEscape(includeUID)
	}
	req, _ := http.NewRequest("GET", u, nil)
	req.Header.Set("X-Noor-Service", os.Getenv("NOOR_SERVICE_TOKEN"))
	resp, err := apiClient.Do(req)
	if err != nil {
		log.Println("overlay fetch error:", err)
		return nil, nil
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		log.Println("overlay fetch HTTP:", resp.StatusCode)
		return nil, nil
	}
	var out struct {
		Items []overlayFetchItem `json:"items"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		log.Println("overlay fetch decode:", err)
		return nil, nil
	}
	byDoc := map[string][]overlay.Replacement{}
	var uids []string
	seen := map[string]bool{}
	for _, it := range out.Items {
		if it.ChangeType != "text_replace" || it.OldValue == "" || it.NewValue == "" || seen[it.UID] {
			continue
		}
		seen[it.UID] = true
		byDoc[it.DocumentUID] = append(byDoc[it.DocumentUID], overlay.Replacement{
			UID: it.UID, ChangeType: it.ChangeType, OldValue: it.OldValue, NewValue: it.NewValue,
		})
		uids = append(uids, it.UID)
	}
	return byDoc, uids
}

// postFeatures ارسال ویژگی‌های واقعی به API داخلی (best-effort با لاگ خطا).
func postFeatures(api string, feats map[string]map[string]bool) {
	if len(feats) == 0 {
		return
	}
	b, err := json.Marshal(map[string]any{"features": feats})
	if err != nil {
		log.Println("features marshal:", err)
		return
	}
	req, _ := http.NewRequest("POST", api+"/api/v1/internal/features", bytes.NewReader(b))
	req.Header.Set("X-Noor-Service", os.Getenv("NOOR_SERVICE_TOKEN"))
	req.Header.Set("Content-Type", "application/json")
	resp, err := apiClient.Do(req)
	if err != nil {
		log.Println("features post:", err)
		return
	}
	defer resp.Body.Close()
	_, _ = io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 300 {
		log.Println("features post HTTP:", resp.StatusCode)
	}
}
