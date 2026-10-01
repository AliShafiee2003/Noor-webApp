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
	"os"
	"path/filepath"
	"time"

	"noor/internal/catalog"
	"noor/internal/config"
	"noor/internal/index"
	"noor/internal/norm"
	"noor/internal/search"
)

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
		switch fmt.Sprint(job["kind"]) {
		case "index_rebuild":
			runIndexRebuild(cfg, api, job)
		default:
			fail(api, fmt.Sprint(job["uid"]), "نوع کار شناخته نشده است")
		}
	}
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
	resp, err := http.DefaultClient.Do(req)
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
	resp, err := http.DefaultClient.Do(req)
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
	resp, err := http.DefaultClient.Do(req)
	if err == nil {
		resp.Body.Close()
	}
}

func fail(api, uid, msg string) {
	b, _ := json.Marshal(map[string]any{"error": msg})
	req, _ := http.NewRequest("POST", api+"/api/v1/internal/jobs/"+uid+"/fail", bytes.NewReader(b))
	req.Header.Set("X-Noor-Service", os.Getenv("NOOR_SERVICE_TOKEN"))
	resp, err := http.DefaultClient.Do(req)
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
	// نسل جدید در فایل موقت ساخته می‌شود؛ پس از موفقیت جابه‌جا (نسل immutable)
	tmp := filepath.Join(cfg.DataDir, "index.building.sqlite")
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
				log.Println("skip doc (reported):", r.docUID, err)
				continue // سند ردشده صادقانه شمرده می‌شود؛ جریان ادامه می‌یابد
			}
			// DB-03: سند ناقص (خطای parse/decode) به‌جای سکوت، شمرده و گزارش می‌شود
			if len(m.ParseErrors) > 0 {
				parseErrDocs++
				log.Printf("doc %s ناقص نمایه شد: %d خطای parse/decode", r.docUID, len(m.ParseErrors))
			}
			return &index.DocInput{
				CollectionUID: "col-fixture", WorkUID: r.workUID, DocumentUID: r.docUID, Language: r.language, Model: m,
			}, nil
		}
	}
	releaseUID := "rel-" + fmt.Sprint(time.Now().Unix())
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
	// جابه‌سازی اتمیک
	if active != "" {
		_ = os.Rename(active, filepath.Join(cfg.DataDir, "index.previous.sqlite"))
	}
	if err := os.Rename(tmp, active2(cfg.DataDir)); err != nil {
		failJob("جابه‌سازی نمایه ناموفق: " + err.Error())
		return err
	}
	// انتشار نسل: pointer اتمیک در app.sqlite از طریق API داخلی
	b, _ := json.Marshal(map[string]any{"release_uid": releaseUID, "manifest": map[string]any{"passages": n, "docs": len(refs) - skipped, "docs_skipped": skipped, "docs_with_parse_errors": parseErrDocs}})
	req, _ := http.NewRequest("POST", api+"/api/v1/internal/releases/publish", bytes.NewReader(b))
	req.Header.Set("X-Noor-Service", os.Getenv("NOOR_SERVICE_TOKEN"))
	if resp, err := http.DefaultClient.Do(req); err != nil {
		failJob("انتشار نسل ممکن نشد: " + err.Error())
		return err
	} else {
		resp.Body.Close()
	}
	// اصلاح محتوایی: پیوند نسل و وضعیت ready (دور ۱۴)
	if payload.OverlayUID != "" {
		markOverlayStatus(api, payload.OverlayUID, "published", releaseUID)
	}
	complete(api, uid, map[string]any{"passages": n, "release_uid": releaseUID, "docs": len(refs) - skipped, "docs_skipped": skipped, "docs_with_parse_errors": parseErrDocs, "opensearch_indexed": cfg.Engine == "opensearch"})
	log.Println("index rebuilt & published:", n, "passages, release", releaseUID)
	return nil
}

// markOverlayStatus ثبت وضعیت اصلاح از طریق endpoint داخلی (best-effort).
func markOverlayStatus(api, overlayUID, status, releaseUID string) {
	b, _ := json.Marshal(map[string]any{"status": status, "release_uid": releaseUID})
	req, _ := http.NewRequest("POST", api+"/api/v1/internal/overlays/"+overlayUID+"/status", bytes.NewReader(b))
	req.Header.Set("X-Noor-Service", os.Getenv("NOOR_SERVICE_TOKEN"))
	if resp, err := http.DefaultClient.Do(req); err == nil {
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
