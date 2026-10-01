// Package search — آداپتور OpenSearch (§۴۶).
//
// معماری: بازیابی «کاندید» با OpenSearch (mapping بدون stemming/stopword،
// فیلد خام برای عبارت دقیق، _source حداقلی، bulk با نرخ کنترل‌شده،
// PIT + search_after برای پیمایش پایدار) و تأیید نهایی هر تطبیق روی
// «متن مؤثر همان نسخه» با همان verifier موتور محلی — قرارداد خروجی
// (modes، scope، فیلتر نقش روی محل تطبیق، شمارش‌های تأییدشده، cursor
// امضاشده، highlight map) دقیقاً همان LocalEngine است.
//
// درستی: پرس‌وجوی OpenSearch عمداً recall-محور است (ابرکاندید مجاز؛
// verifier حقیقت است) به‌طوری که هیچ تطبیق تأییدشدنی از دست نرود.
package search

import (
        "bytes"
        "context"
        "encoding/json"
        "errors"
        "fmt"
        "io"
        "net/http"
        "net/url"
        "sort"
        "strings"
        "time"

        "noor/internal/norm"
)

// OpenSearchEngine موتور جست‌وجوی OpenSearch؛ دسترسی به متن و verifier را از
// LocalEngine همان نمایه می‌گیرد (منبع متن یکسان است — §۴۴: verifier روی متن مؤثر).
type OpenSearchEngine struct {
        base   *LocalEngine // متن + verifier + نشست + شمارش
        client *osClient
        index  string
}

// NewOpenSearch ساخت آداپتور؛ با ping سرویس — در نبود سرویس خطای فهمیدنی می‌دهد (الف-۲).
func NewOpenSearch(baseURL, user, pass, indexName string, base *LocalEngine) (*OpenSearchEngine, error) {
        if strings.TrimSpace(baseURL) == "" {
                return nil, errors.New("آدرس OpenSearch خالی است؛ NOOR_OPENSEARCH_URL را تنظیم کنید")
        }
        c := &osClient{baseURL: strings.TrimRight(baseURL, "/"), user: user, pass: pass, http: &http.Client{Timeout: 30 * time.Second}}
        if err := c.ping(); err != nil {
                return nil, fmt.Errorf("سرویس OpenSearch در %s پاسخ نمی‌دهد: %w", baseURL, err)
        }
        if indexName == "" {
                indexName = "noor-passages"
        }
        return &OpenSearchEngine{base: base, client: c, index: indexName}, nil
}

// EnsureIndex ساخت index با mapping مصوب در نبود آن (بدون stemming/stopword).
func (e *OpenSearchEngine) EnsureIndex() error {
        return e.client.ensureIndex(e.index)
}

// EngineName نام موتور برای /status و لاگ.
func (e *OpenSearchEngine) EngineName() string { return "opensearch" }

// ---- اجرای جست‌وجو ----

func (e *OpenSearchEngine) Search(ctx context.Context, req *Request, releaseUID string) (*Response, error) {
        if err := validateRequest(req); err != nil {
                return nil, err
        }
        if req.Scope.Target == "titles" {
                hits, err := e.SearchTitles(ctx, req.Query, req.PageSize)
                if err != nil {
                        return nil, err
                }
                resp := &Response{ReleaseUID: releaseUID, CompletionState: "complete", CountRelation: "exact", Results: []Result{}}
                for _, h := range hits {
                        resp.Results = append(resp.Results, Result{
                                PassageUID: "title-" + h.WorkUID, MatchType: "exact",
                                Work: Ref{UID: h.WorkUID, Title: h.Title, Label: h.ShortTitle},
                                Page: Ref{Label: "نام کتاب"},
                        })
                }
                resp.VerifiedBooks = len(hits)
                resp.VerifiedOccurrences = len(hits)
                return resp, nil
        }
        verified, capped, err := e.runVerified(ctx, req, releaseUID)
        if err != nil {
                return nil, err
        }
        sid := newID("s")
        if err := e.base.saveSession(sid, releaseUID, req); err != nil {
                return nil, err
        }
        return e.base.buildResponse(sid, releaseUID, req, verified, 0, capped), nil
}

func (e *OpenSearchEngine) Continue(ctx context.Context, sessionUID, cursor, releaseUID string) (*Response, error) {
        if !verifyCursor(cursor, e.base.Secret) {
                return nil, &GoneError{Message: "نشانهٔ ادامهٔ جست‌وجو معتبر نیست؛ دوباره اجرا کنید."}
        }
        payload, ok := parseCursorPayload(cursor)
        if !ok || payload.S != sessionUID {
                return nil, &GoneError{Message: "نشانهٔ ادامهٔ جست‌وجو معتبر نیست؛ دوباره اجرا کنید."}
        }
        release, req, err := e.base.loadSession(sessionUID)
        if err != nil {
                return nil, &GoneError{Message: "مهلت این جست‌وجو پایان یافته است؛ دوباره اجرا کنید."}
        }
        verified, capped, err := e.runVerified(ctx, req, release)
        if err != nil {
                return nil, err
        }
        _ = releaseUID
        return e.base.buildResponse(sessionUID, release, req, verified, payload.O, capped), nil
}

func (e *OpenSearchEngine) BooksGrouped(ctx context.Context, sessionUID string) ([]BookGroup, error) {
        release, req, err := e.base.loadSession(sessionUID)
        if err != nil {
                return nil, &GoneError{Message: "مهلت این جست‌وجو پایان یافته است؛ دوباره اجرا کنید."}
        }
        verified, _, err := e.runVerified(ctx, req, release)
        if err != nil {
                return nil, err
        }
        return groupVerified(e.base.catalog, verified), nil
}

// runVerified کاندید از OpenSearch → ترتیب قطعی → تأیید روی متن نمایه.
func (e *OpenSearchEngine) runVerified(ctx context.Context, req *Request, releaseUID string) ([]Result, bool, error) {
        qN, _ := norm.Normalize(req.Query)
        toks := norm.Tokenize(qN)
        citationOnly := req.Scope.Quran != nil && len(toks) == 0
        if len(toks) == 0 && !citationOnly {
                return nil, true, nil
        }
        db, err := e.base.dbHandle()
        if err != nil {
                return nil, false, err
        }
        db, err = e.base.ensureRelease(db, releaseUID)
        if err != nil {
                return nil, false, err
        }
        // ۱) کاندیدها از OpenSearch (پیمایش پایدار با PIT + search_after؛ _source حداقلی)
        hits, err := e.collectCandidates(ctx, req, toks, citationOnly)
        if err != nil {
                return nil, false, err
        }
        // ۲) ترتیب قطعی همان LocalEngine: work_uid, document_uid, block_start (+passage_uid برای قطعیت)
        sort.SliceStable(hits, func(i, j int) bool {
                a, b := hits[i].Source, hits[j].Source
                if str(a["work_uid"]) != str(b["work_uid"]) {
                        return str(a["work_uid"]) < str(b["work_uid"])
                }
                if str(a["document_uid"]) != str(b["document_uid"]) {
                        return str(a["document_uid"]) < str(b["document_uid"])
                }
                if num(a["block_start"]) != num(b["block_start"]) {
                        return num(a["block_start"]) < num(b["block_start"])
                }
                return str(a["passage_uid"]) < str(b["passage_uid"])
        })
        // ۳) متن کامل از نمایهٔ محلی (منبع واحد حقیقت) + همان verifier
        var out []Result
        cap := e.base.maxResults
        if cap <= 0 {
                cap = defaultMaxResults
        }
        seen := map[string]bool{}
        const batch = 200
        for start := 0; start < len(hits); start += batch {
                if ctx.Err() != nil {
                        return out, false, ctx.Err()
                }
                end := start + batch
                if end > len(hits) {
                        end = len(hits)
                }
                rows, err := fetchCandRows(db, releaseUID, hits[start:end])
                if err != nil {
                        return nil, false, err
                }
                for i := range rows {
                        r := &rows[i]
                        if !scopeAllows(req, r) {
                                continue
                        }
                        if !citationAllows(req, r) {
                                continue // استناد باید واقعاً در همین passage باشد
                        }
                        hitsV, matchType := verifyInText(req, r)
                        if req.Scope.Quran != nil && len([]rune(req.Query)) == 0 && len(hitsV) == 0 {
                                n1r := []rune(r.TextOriginal)
                                hi := clampInt(160, 0, len(n1r))
                                hitsV = []hit{{Range: [2]int{0, hi}}}
                                matchType = "exact"
                        }
                        for _, h := range hitsV {
                                key := r.DocumentUID + ":" + fmt.Sprint(r.SourceStart+h.Range[0]) + ":" + fmt.Sprint(r.SourceStart+h.Range[1])
                                if seen[key] {
                                        continue
                                }
                                seen[key] = true
                                if len(req.Scope.Roles) > 0 && !matchInsideRoles(r.RoleRanges, h.Range) {
                                        continue
                                }
                                out = append(out, e.base.toResult(r, h, matchType))
                                if len(out) >= cap {
                                        return out, true, nil
                                }
                        }
                }
        }
        return out, false, nil
}

// collectCandidates پرس‌وجوی recall-محور per-mode با فیلتر scope؛ همهٔ کاندیدها
// در ترتیب قطعی PIT + search_after جمع می‌شوند.
func (e *OpenSearchEngine) collectCandidates(ctx context.Context, req *Request, toks []string, citationOnly bool) ([]osHit, error) {
        // پرس‌وجو باید دقیقاً همان‌طور که verifier می‌بیند نرمال شود (پاریتی با LocalEngine):
        // همهٔ حالت‌ها روی text_n1 با شکل نرمال عبارت؛ زبانی با Fold (هم‌سان با verifier).
        qN, _ := norm.Normalize(req.Query)
        osQuery := qN
        if req.Mode == Linguistic {
                osQuery = norm.Fold(req.Query)
        }
        var query map[string]any
        switch {
        case citationOnly:
                // مورد ۳ دور ممیزی: پرس‌وجوی استناد صرف دیگر match_all نیست؛
                // با کلیدهای ایندکس‌شدهٔ citation_keys محدود می‌شود (recall فقط باید superset باشد —
                // دقت نهایی همان citationAllows روی متن نمایهٔ SQLite است).
                keys := QuranScopeKeys(req.Scope.Quran)
                if len(keys) == 0 {
                        query = map[string]any{"match_all": map[string]any{}}
                } else {
                        query = map[string]any{"terms": map[string]any{"citation_keys": keys}}
                }
        case req.Mode == StrictPhrase:
                // ابرکاندید: عبارت نرمال روی text_n1 — تطبیق خامِ متن اصلی در verifier تأیید می‌شود
                query = map[string]any{"match_phrase": map[string]any{"text_n1": osQuery}}
        case req.Mode == NormalizedPhrase, req.Mode == LongQuote:
                query = map[string]any{"match_phrase": map[string]any{"text_n1": osQuery}}
        case req.Mode == AllWords:
                query = map[string]any{"match": map[string]any{"text_n1": map[string]any{"query": osQuery, "operator": "and"}}}
        case req.Mode == Near:
                // ابرکاندید «همهٔ واژه‌ها»؛ شرط فاصله/ترتیب در verifier اعمال می‌شود
                query = map[string]any{"match": map[string]any{"text_n1": map[string]any{"query": osQuery, "operator": "and"}}}
        case req.Mode == AnyWords:
                query = map[string]any{"match": map[string]any{"text_n1": map[string]any{"query": osQuery, "operator": "or"}}}
        case req.Mode == Linguistic:
                // OR واژه‌ها؛ دقت زبانی در verifier (Fold) اعمال می‌شود
                query = map[string]any{"match": map[string]any{"text_n1": map[string]any{"query": osQuery, "operator": "or"}}}
        default:
                return nil, errors.New("حالت جست‌وجو معتبر نیست")
        }
        // فیلتر scope روی فیلدهای keyword + kind
        filter := []any{map[string]any{"term": map[string]any{"kind": "passage"}}}
        if req.Scope.Target == "work" && req.Scope.WorkUID != nil {
                filter = append(filter, map[string]any{"term": map[string]any{"work_uid": *req.Scope.WorkUID}})
        }
        if req.Scope.Target == "document" || req.Scope.Target == "section" {
                if len(req.Scope.DocumentUIDs) > 0 {
                        filter = append(filter, map[string]any{"terms": map[string]any{"document_uid": req.Scope.DocumentUIDs}})
                } else {
                        return nil, nil // دامنهٔ خالی → هیچ کاندید
                }
        }
        if req.Scope.Target == "collection" && len(req.Scope.CollectionUIDs) > 0 {
                filter = append(filter, map[string]any{"terms": map[string]any{"collection_uid": req.Scope.CollectionUIDs}})
        }
        if req.Scope.Language != nil && *req.Scope.Language != "" {
                filter = append(filter, map[string]any{"term": map[string]any{"language": *req.Scope.Language}})
        }
        body := map[string]any{"query": map[string]any{"bool": map[string]any{"must": query, "filter": filter}}}
        sortKeys := []any{map[string]any{"work_uid": "asc"}, map[string]any{"document_uid": "asc"},
                map[string]any{"block_start": "asc"}, map[string]any{"passage_uid": "asc"}}
        maxCand := e.base.maxResults * 3
        if maxCand < 20000 {
                maxCand = 20000
        }
        return e.client.searchAll(e.index, body, sortKeys, maxCand)
}

// SearchTitles جست‌وجوی نام کتاب روی نمایهٔ عنوان‌ها (kind=title) —
// تطبیق زیررشته با Fold در موتور محلی با n-gram بازتاب داده شده است.
func (e *OpenSearchEngine) SearchTitles(ctx context.Context, q string, pageSize int) ([]TitleHit, error) {
        body := map[string]any{
                "size":  pageSize,
                "query": map[string]any{"bool": map[string]any{"must": map[string]any{"match_phrase": map[string]any{"title_search": map[string]any{"query": q, "analyzer": "noor_title_q"}}}, "filter": map[string]any{"term": map[string]any{"kind": "title"}}}},
        }
        var out struct {
                Hits struct {
                        Hits []struct {
                                Source map[string]any `json:"_source"`
                        } `json:"hits"`
                } `json:"hits"`
        }
        if err := e.client.searchOnce(e.index, body, &out); err != nil {
                return nil, err
        }
        res := []TitleHit{}
        for _, h := range out.Hits.Hits {
                res = append(res, TitleHit{
                        WorkUID:    str(h.Source["work_uid"]),
                        Title:      str(h.Source["title"]),
                        ShortTitle: str(h.Source["short_title"]),
                        Author:     str(h.Source["author"]),
                })
        }
        return res, nil
}

// ---- کلاینت HTTP OpenSearch (بدون وابستگی بیرونی) ----
type osClient struct {
        baseURL string
        user    string
        pass    string
        http    *http.Client
}

func (c *osClient) do(ctx context.Context, method, path string, body any, out any) error {
        var rdr io.Reader
        if body != nil {
                b, err := json.Marshal(body)
                if err != nil {
                        return err
                }
                rdr = bytes.NewReader(b)
        }
        req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, rdr)
        if err != nil {
                return err
        }
        req.Header.Set("Content-Type", "application/json")
        if c.user != "" {
                req.SetBasicAuth(c.user, c.pass)
        }
        resp, err := c.http.Do(req)
        if err != nil {
                return err
        }
        defer resp.Body.Close()
        raw, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
        if resp.StatusCode >= 300 {
                return fmt.Errorf("opensearch %s %s → HTTP %d: %s", method, path, resp.StatusCode, truncate(string(raw), 300))
        }
        if out != nil && len(raw) > 0 {
                if err := json.Unmarshal(raw, out); err != nil {
                        return fmt.Errorf("پاسخ OpenSearch قابل تحلیل نیست: %w", err)
                }
        }
        return nil
}

func (c *osClient) ping() error {
        ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
        defer cancel()
        var out map[string]any
        if err := c.do(ctx, "GET", "/", nil, &out); err != nil {
                return err
        }
        if v, ok := out["version"].(map[string]any); ok {
                if d, ok := v["distribution"].(string); ok && d != "" && !strings.Contains(d, "opensearch") {
                        // موتور دیگری پاسخ داده — صادقانه رد می‌کنیم
                        return fmt.Errorf("سرویس پاسخ‌دهنده OpenSearch نیست (distribution=%s)", d)
                }
        }
        return nil
}

// osDiacriticFilter حذف اعراب/تطویل — همان مجموعهٔ مصوب norm.ArabicDiacritics + تطویل.
func osDiacriticFilter() map[string]any {
        diacs := []rune{
                0x0610, 0x0611, 0x0612, 0x064B, 0x064C, 0x064E, 0x064F, 0x0650, 0x0651, 0x0652,
                0x0653, 0x0654, 0x0655, 0x0656, 0x0670, 0x0674, 0x06D6, 0x06D7, 0x06D8, 0x06D9,
                0x06DA, 0x06DB, 0x06DC, 0x06DF, 0x06E0, 0x06E1, 0x06E2, 0x06E3, 0x06E4, 0x06E7,
                0x06E8, 0x06EA, 0x06EB, 0x06EC, 0x06ED, 0x0640,
        }
        mappings := make([]string, 0, len(diacs))
        for _, d := range diacs {
                mappings = append(mappings, string(d)+" => ")
        }
        return map[string]any{"type": "mapping", "mappings": mappings}
}

// ensureIndex ساخت index با mapping مصوب (الف-۱): بدون stemming/stopword؛
// tokenizer سفارشی هم‌ارز norm.Tokenize (حرف/رقم/خط‌تیره/نیم‌فاصله = نویسهٔ واژه)؛
// فیلد raw (keyword) برای عبارت دقیق؛ _source حداقلی (متن‌ها از نمایهٔ محلی خوانده می‌شوند).
func (c *osClient) ensureIndex(index string) error {
        ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
        defer cancel()
        if err := c.do(ctx, "HEAD", "/"+index, nil, nil); err == nil {
                return nil // موجود است
        } else if !strings.Contains(err.Error(), "HTTP 404") {
                return err // خطای دیگر (اتصال/احراز) — گزارش صریح
        }
        mapping := map[string]any{
                "settings": map[string]any{
                        "number_of_shards": 1, "number_of_replicas": 0, "index.max_ngram_diff": 22,
                        "analysis": map[string]any{
                                "char_filter": map[string]any{
                                        "noor_strip": osDiacriticFilter(),
                                        "noor_fold": map[string]any{
                                                "type": "mapping",
                                                "mappings": []string{
                                                        "أ => ا", "إ => ا", "آ => ا", "ٱ => ا",
                                                        "ؤ => و", "ئ => ی", "ة => ه", "ى => ی",
                                                        "ي => ی", "ك => ک",
                                                },
                                        },
                                },
                                "tokenizer": map[string]any{
                                        // هم‌ارز norm.Tokenize: واژه = حرف/رقم/خط‌تیره/نیم‌فاصله
                                        "noor_tok": map[string]any{"type": "pattern", "pattern": "([\\p{L}\\p{Nd}\\-\\u200C]+)", "group": 1},
                                },
                                "filter": map[string]any{
                                        "title_ngram": map[string]any{"type": "ngram", "min_gram": 2, "max_gram": 24},
                                },
                                "analyzer": map[string]any{
                                        "noor_n1":      map[string]any{"type": "custom", "char_filter": []string{"noor_strip"}, "tokenizer": "noor_tok", "filter": []string{"lowercase"}},
                                        "noor_title":   map[string]any{"type": "custom", "char_filter": []string{"noor_fold"}, "tokenizer": "noor_tok", "filter": []string{"lowercase", "title_ngram"}},
                                        "noor_title_q": map[string]any{"type": "custom", "char_filter": []string{"noor_fold"}, "tokenizer": "noor_tok", "filter": []string{"lowercase"}},
                                },
                        },
                },
                "mappings": map[string]any{
                        // _source حداقلی: متن‌های کامل و نگاشت از _source حذف شده‌اند — از نمایهٔ SQLite خوانده می‌شوند
                        // citation_keys فقط برای terms filter است و در _source لازم نیست.
                        "_source": map[string]any{"excludes": []string{"text_original", "text_n1", "n1_map", "role_ranges", "citations", "citation_keys"}},
                        "properties": map[string]any{
                                "kind":             map[string]any{"type": "keyword"},
                                "passage_uid":      map[string]any{"type": "keyword"},
                                "release_uid":      map[string]any{"type": "keyword"},
                                "collection_uid":   map[string]any{"type": "keyword"},
                                "work_uid":         map[string]any{"type": "keyword"},
                                "document_uid":     map[string]any{"type": "keyword"},
                                "section_uid":      map[string]any{"type": "keyword"},
                                "page_uid":         map[string]any{"type": "keyword"},
                                "page_label":       map[string]any{"type": "keyword"},
                                "language":         map[string]any{"type": "keyword"},
                                "local_hadith_uid": map[string]any{"type": "keyword"},
                                "revayat_index":    map[string]any{"type": "keyword"},
                                "fingerprint":      map[string]any{"type": "keyword"},
                                // کلیدهای استناد قرآنی برای پرس‌وجوی استناد صرف (مورد ۳ دور ممیزی)
                                "citation_keys":    map[string]any{"type": "keyword"},
                                "source_start":     map[string]any{"type": "integer"},
                                "source_end":       map[string]any{"type": "integer"},
                                "block_start":      map[string]any{"type": "integer"},
                                "block_end":        map[string]any{"type": "integer"},
                                "text_original":    map[string]any{"type": "text", "analyzer": "noor_n1"},
                                "text_n1":          map[string]any{"type": "text", "analyzer": "noor_n1", "fields": map[string]any{"raw": map[string]any{"type": "keyword"}}},
                                "title":            map[string]any{"type": "keyword"},
                                "short_title":      map[string]any{"type": "keyword"},
                                "author":           map[string]any{"type": "keyword"},
                                "title_search":     map[string]any{"type": "text", "analyzer": "noor_title"},
                        },
                },
        }
        return c.do(ctx, "PUT", "/"+index, mapping, nil)
}

// BulkIndex نمایه‌سازی bulk با نرخ کنترل‌شده (اندازهٔ دسته + مکث؛ §۳۸).
// src هر آیتم را به سند JSON و شناسه تبدیل می‌کند.
func (c *osClient) BulkIndex(ctx context.Context, index string, items []map[string]any, ids []string, batchSize int, pause time.Duration, progress func(done int)) error {
        if batchSize <= 0 {
                batchSize = 500
        }
        for start := 0; start < len(items); start += batchSize {
                if ctx.Err() != nil {
                        return ctx.Err()
                }
                end := start + batchSize
                if end > len(items) {
                        end = len(items)
                }
                var buf bytes.Buffer
                for i := start; i < end; i++ {
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
                var out struct {
                        Errors bool `json:"errors"`
                        Items  []struct {
                                Index struct {
                                        Status int    `json:"status"`
                                        Error  any    `json:"error"`
                                        ID     string `json:"_id"`
                                } `json:"index"`
                        } `json:"items"`
                }
                reqBody := json.RawMessage(buf.Bytes())
                if err := c.do(ctx, "POST", "/_bulk", reqBody, &out); err != nil {
                        return err
                }
                if out.Errors {
                        first := ""
                        for _, it := range out.Items {
                                if it.Index.Error != nil {
                                        first = fmt.Sprint(it.Index.Error)
                                        break
                                }
                        }
                        return fmt.Errorf("نمایه‌سازی bulk با خطا مواجه شد: %s", truncate(first, 300))
                }
                if progress != nil {
                        progress(end)
                }
                if pause > 0 && end < len(items) {
                        select {
                        case <-ctx.Done():
                                return ctx.Err()
                        case <-time.After(pause):
                        }
                }
        }
        return nil
}

// searchAll پیمایش کامل نتایج با PIT + search_after (صفحه‌بندی پایدار در برابر تغییر index).
// توجه: در OpenSearch ساخت PIT روی «POST /{index}/_search/point_in_time» است و
// بستنش روی «DELETE /_pit» با بدنهٔ {"pit_id": ...}.
func (c *osClient) searchAll(index string, body map[string]any, sortKeys []any, maxHits int) ([]osHit, error) {
        ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
        defer cancel()
        // PIT
        var pit struct {
                ID string `json:"pit_id"`
        }
        if err := c.do(ctx, "POST", "/"+index+"/_search/point_in_time?keep_alive=2m", nil, &pit); err != nil {
                return nil, err
        }
        defer func() {
                b, _ := json.Marshal(map[string]any{"pit_id": pit.ID})
                req, err := http.NewRequestWithContext(ctx, "DELETE", c.baseURL+"/_pit", bytes.NewReader(b))
                if err == nil {
                        req.Header.Set("Content-Type", "application/json")
                        if c.user != "" {
                                req.SetBasicAuth(c.user, c.pass)
                        }
                        if resp, err := c.http.Do(req); err == nil {
                                resp.Body.Close()
                        }
                }
        }()
        b := map[string]any{
                "size":  1000,
                "query": body["query"],
                "sort":  sortKeys,
                "pit":   map[string]any{"id": pit.ID, "keep_alive": "2m"},
        }
        var after []any
        var hits []osHit
        for {
                if len(hits) >= maxHits {
                        break
                }
                if after != nil {
                        b["search_after"] = after
                }
                var out struct {
                        Hits struct {
                                Hits []struct {
                                        Sort   []any          `json:"sort"`
                                        Source map[string]any `json:"_source"`
                                } `json:"hits"`
                        } `json:"hits"`
                }
                if err := c.do(ctx, "POST", "/_search", b, &out); err != nil {
                        return hits, err
                }
                page := out.Hits.Hits
                if len(page) == 0 {
                        break
                }
                for _, h := range page {
                        hits = append(hits, osHit{Source: h.Source})
                }
                last := page[len(page)-1].Sort
                if len(last) == 0 {
                        break
                }
                after = last
        }
        return hits, nil
}

func (c *osClient) searchOnce(index string, body map[string]any, out any) error {
        ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
        defer cancel()
        return c.do(ctx, "POST", "/"+index+"/_search", body, out)
}

var errOSNotFound = errors.New("opensearch: not found")

var _ = url.QueryEscape // نگه‌داشتن ایمپورت url برای آدرس‌دهی‌های آینده

// ---- سندهای حداقلی و کمک‌ها ----

type osHit struct {
        Source map[string]any `json:"-"`
}

func str(v any) string {
        if s, ok := v.(string); ok {
                return s
        }
        return ""
}

func num(v any) int {
        switch x := v.(type) {
        case float64:
                return int(x)
        case int:
                return x
        }
        return 0
}

func truncate(s string, n int) string {
        r := []rune(s)
        if len(r) > n {
                return string(r[:n]) + "…"
        }
        return s
}
