// Package search — موتور جست‌وجو: بازیابی کاندید از نمایه + verifier روی متن مؤثر (§۴۴–۴۷).
// صحت مقدم بر سرعت است؛ count کاندید هرگز «نتیجهٔ نهایی» نمایش داده نمی‌شود.
// توجه: همهٔ offsetها code point هستند (نه بایت) — §۴۲.
package search

import (
        "context"
        "crypto/hmac"
        "crypto/rand"
        "crypto/sha256"
        "database/sql"
        "encoding/base64"
        "encoding/hex"
        "encoding/json"
        "errors"
        "fmt"
        "strings"
        "sync"
        "time"

        "noor/internal/norm"
)

// Modes حالت‌های مجاز (§۴۴).
const (
        StrictPhrase     = "strict_phrase"
        NormalizedPhrase = "normalized_phrase"
        AllWords         = "all_words"
        AnyWords         = "any_words"
        Near             = "near"
        Linguistic       = "linguistic"
        LongQuote        = "long_quote"
)

// Scope دامنهٔ جست‌وجو (§۴۸).
type Scope struct {
        Target         string   `json:"target"` // library|collection|work|document|section|titles|citations
        CollectionUIDs []string `json:"collection_uids,omitempty"`
        WorkUID        *string  `json:"work_uid,omitempty"`
        DocumentUIDs   []string `json:"document_uids,omitempty"`
        Roles          []string `json:"roles,omitempty"`
        Language       *string  `json:"language,omitempty"`
        // Quran فیلتر استناد قرآنی (QUR-03): سوره و آیه/بازهٔ مشخص
        Quran *QuranRef `json:"quran,omitempty"`
}

// QuranRef نشانی استناد؛ سوره الزامی، آیه اختیاری (بازهٔ آیه نیز پوشش داده می‌شود).
type QuranRef struct {
        Sure string `json:"sure"`
        Aya  string `json:"aya,omitempty"`
}

// Request درخواست جست‌وجو.
type Request struct {
        Query    string `json:"query"`
        Mode     string `json:"mode"`
        Scope    Scope  `json:"scope"`
        Near     *struct {
                Slop    int  `json:"slop"`
                Ordered bool `json:"ordered"`
        } `json:"near,omitempty"`
        Sort     string `json:"sort"` // relevance|source
        PageSize int    `json:"page_size"`
}

// Result نتیجهٔ تأییدشده.
type Result struct {
        PassageUID  string          `json:"passage_uid"`
        MatchType   string          `json:"match_type"`
        Work        Ref             `json:"work"`
        Document    Ref             `json:"document"`
        Page        Ref             `json:"page"`
        Section     *Ref            `json:"section,omitempty"`
        Snippet     string          `json:"snippet"`
        Highlight   []Range         `json:"highlight"`
        Roles       []string        `json:"roles"`
        LocalHadith string          `json:"local_hadith_uid,omitempty"`
        // RevayatIndex شمارهٔ درون‌منبع روایت (HAD-08) — نمایش در کارت نتیجه؛
        // تعمیم به کتاب‌های دیگر ندارد و در پرس‌وجوی میان‌کتابی (§۴۷) به‌کار نمی‌رود.
        RevayatIndex string          `json:"revayat_index,omitempty"`
        Fingerprint  string          `json:"fingerprint,omitempty"`
        SourceRange [2]int          `json:"source_offsets"`
        // بازهٔ دقیق تطبیق در مختصات سند (نه فقط passage) — برای هایلایت کتاب‌خوان
        MatchRange [2]int               `json:"match_offsets,omitempty"`
        Citations   json.RawMessage `json:"citations,omitempty"`
}

type Ref struct {
        UID   string `json:"uid"`
        Title string `json:"title"`
        Label string `json:"label"`
}

type Range struct {
        Start int    `json:"start"`
        End   int    `json:"end"`
        Unit  string `json:"unit"` // codepoint
}

// Response پاسخ صادقانه (§۴۷).
type Response struct {
        SessionUID            string   `json:"session_uid"`
        ReleaseUID            string   `json:"release_uid"`
        CompletionState       string   `json:"completion_state"`
        VerifiedOccurrences   int      `json:"verified_occurrences"`
        VerifiedBooks         int      `json:"verified_books"`
        // TECH-11: شمارش جداگانهٔ قطعه‌های متمایز و روایت‌های متمایز — با مواضع/کتاب‌ها مخلوط نمی‌شود
        VerifiedPassages      int      `json:"verified_passages,omitempty"`
        VerifiedHadiths       int      `json:"verified_hadiths,omitempty"`
        CountRelation         string   `json:"count_relation"`
        ContinuationAvailable bool     `json:"continuation_available"`
        NextCursor            string   `json:"next_cursor,omitempty"`
        CountJobUID           string   `json:"count_job_uid,omitempty"`
        Results               []Result `json:"results"`
}

// BookGroup گروه‌بندی «کتاب‌های دارای تطبیق تأییدشده».
type BookGroup struct {
        Work      Ref           `json:"work"`
        Documents []DocEvidence `json:"documents"`
}

type DocEvidence struct {
        Document            Ref      `json:"document"`
        VerifiedOccurrences int      `json:"verified_occurrences"`
        Evidence            []Result `json:"evidence"`
}

type TitleHit struct {
        WorkUID    string `json:"uid"`
        Title      string `json:"title"`
        ShortTitle string `json:"short_title"`
        Author     string `json:"author"`
}

// Engine اینترفیس موتور (قابل‌تعویض با OpenSearch — §۴۶).
type Engine interface {
        Search(ctx context.Context, req *Request, releaseUID string) (*Response, error)
        Continue(ctx context.Context, sessionUID, cursor string, releaseUID string) (*Response, error)
        BooksGrouped(ctx context.Context, sessionUID string) ([]BookGroup, error)
        SearchTitles(ctx context.Context, q string, pageSize int) ([]TitleHit, error)
}

// GoneError خطای 410 cursor منقضی.
type GoneError struct{ Message string }

func (e *GoneError) Error() string { return e.Message }

// ---- LocalIndexEngine ----

type LocalEngine struct {
        path     string
        Secret   []byte
        catalog  MetaSource
        mu       sync.Mutex
        sessions map[string]*searchSession
        dbMu     sync.Mutex
        db       *sql.DB
        dbInode  uint64
        dbSize   int64
}

// MetaSource ابردادهٔ کار/سند.
type MetaSource interface {
        WorkTitle(uid string) (title, short, author string, ok bool)
        DocumentMeta(uid string) (workUID, label string, ok bool)
        SectionTitle(docUID, secUID string) (string, bool)
}

type searchSession struct {
        req      *Request
        release  string
        offset   int
        verified []Result
        complete bool
        expire   time.Time
}

const sessionTTL = 5 * time.Minute

func NewLocal(path string, secret []byte, meta MetaSource) *LocalEngine {
        return &LocalEngine{path: path, Secret: secret, catalog: meta, sessions: map[string]*searchSession{}}
}

// dbHandle اتصال فقط‌خواندنی نمایه؛ با تعویض فایل (نسل جدید) خودکار بازگشایی می‌شود.
// تشخیص تعویض: inode + اندازه؛ و اگر release_uid اتصال با نسخهٔ درخواستی نخواند، بازگشایی اجباری.
func (e *LocalEngine) dbHandle() (*sql.DB, error) {
        e.dbMu.Lock()
        defer e.dbMu.Unlock()
        fi, err := osStat(e.path)
        if err == nil {
                ino := fileInode(fi)
                sz := fi.Size()
                if e.db != nil && (ino != e.dbInode || sz != e.dbSize) {
                        e.db.Close()
                        e.db = nil
                }
                if e.db == nil {
                        db, err := sql.Open("sqlite", "file:"+e.path+"?mode=ro")
                        if err != nil {
                                return nil, err
                        }
                        db.SetMaxOpenConns(3)
                        e.db = db
                        e.dbInode = ino
                        e.dbSize = sz
                }
                return e.db, nil
        }
        if e.db != nil {
                return e.db, nil
        }
        return nil, errors.New("نمایهٔ جست‌وجو در دسترس نیست")
}

// ensureRelease اگر اتصالِ فعلی نسلِ درخواستی را ندارد، اتصال را نوسازی می‌کند
// (مقاوم در برابر inode reuse بین نسل‌ها).
func (e *LocalEngine) ensureRelease(db *sql.DB, releaseUID string) (*sql.DB, error) {
        var rel string
        err := db.QueryRow(`SELECT release_uid FROM passages LIMIT 1`).Scan(&rel)
        if err == nil && rel == releaseUID {
                return db, nil
        }
        // نوسازی اجباری
        e.dbMu.Lock()
        if e.db != nil {
                e.db.Close()
                e.db = nil
        }
        e.dbMu.Unlock()
        return e.dbHandle()
}

func (e *LocalEngine) validate(req *Request) error {
        // جست‌وجوی صرفاً استنادی (بدون عبارت) مجاز است — QUR-03
        if len([]rune(req.Query)) == 0 && req.Scope.Quran == nil {
                return errors.New("عبارت جست‌وجو خالی است")
        }
        modeOK := false
        for _, m := range []string{StrictPhrase, NormalizedPhrase, AllWords, AnyWords, Near, Linguistic, LongQuote} {
                if req.Mode == m {
                        modeOK = true
                }
        }
        if !modeOK {
                return fmt.Errorf("حالت جست‌وجو معتبر نیست")
        }
        limit := 2048
        if req.Mode == LongQuote {
                limit = 8192
        }
        if len([]rune(req.Query)) > limit {
                return errors.New("عبارت بیش از حد مجاز است؛ برای نقل‌قول بلند از حالت مخصوص آن استفاده کنید")
        }
        if req.PageSize < 5 || req.PageSize > 50 {
                req.PageSize = 20
        }
        return nil
}

// Search اجرای جست‌وجو: کاندید → verifier → نتایج تأییدشده.
func (e *LocalEngine) Search(ctx context.Context, req *Request, releaseUID string) (*Response, error) {
        if err := e.validate(req); err != nil {
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
        db, err := e.dbHandle()
        if err != nil {
                return nil, err
        }
        db, err = e.ensureRelease(db, releaseUID)
        if err != nil {
                return nil, err
        }
        verified, complete, err := e.run(ctx, db, req, releaseUID)
        if err != nil {
                return nil, err
        }
        page := verified
        if len(page) > req.PageSize {
                page = page[:req.PageSize]
        }
        sid := newID("s")
        sess := &searchSession{req: req, release: releaseUID, offset: len(page), verified: verified, complete: complete, expire: time.Now().Add(sessionTTL)}
        e.mu.Lock()
        if len(e.sessions) > 400 {
                e.sessions = map[string]*searchSession{}
        }
        e.sessions[sid] = sess
        e.mu.Unlock()
        return e.buildResponse(sid, sess, page), nil
}

// Continue ادامهٔ بررسی با cursor امضاشده (§۴۷).
func (e *LocalEngine) Continue(ctx context.Context, sessionUID, cursor, releaseUID string) (*Response, error) {
        e.mu.Lock()
        sess, ok := e.sessions[sessionUID]
        e.mu.Unlock()
        if !ok || time.Now().After(sess.expire) {
                if ok {
                        e.mu.Lock()
                        delete(e.sessions, sessionUID)
                        e.mu.Unlock()
                }
                return nil, &GoneError{Message: "مهلت این جست‌وجو پایان یافته است؛ دوباره اجرا کنید."}
        }
        if !verifyCursor(cursor, e.Secret) {
                return nil, &GoneError{Message: "نشانهٔ ادامهٔ جست‌وجو معتبر نیست؛ دوباره اجرا کنید."}
        }
        sess.expire = time.Now().Add(sessionTTL)
        remaining := sess.verified[sess.offset:]
        page := remaining
        if len(page) > sess.req.PageSize {
                page = page[:sess.req.PageSize]
        }
        sess.offset += len(page)
        return e.buildResponse(sessionUID, sess, page), nil
}

func (e *LocalEngine) buildResponse(sid string, sess *searchSession, page []Result) *Response {
        books := map[string]bool{}
        passages := map[string]bool{}
        hadiths := map[string]bool{}
        for _, r := range sess.verified {
                if w, _, ok := e.catalog.DocumentMeta(r.Document.UID); ok {
                        books[w] = true
                } else {
                        books[r.Work.UID] = true
                }
                if r.PassageUID != "" {
                        passages[r.PassageUID] = true
                }
                if r.LocalHadith != "" {
                        // روایت درون هر سند متمایز است؛ شناسهٔ محلی جهانی نیست
                        hadiths[r.Document.UID+"/"+r.LocalHadith] = true
                }
        }
        continuation := sess.offset < len(sess.verified)
        resp := &Response{
                SessionUID:            sid,
                ReleaseUID:            sess.release,
                CompletionState:       "complete",
                VerifiedOccurrences:   len(sess.verified),
                VerifiedBooks:         len(books),
                VerifiedPassages:      len(passages),
                VerifiedHadiths:       len(hadiths),
                CountRelation:         "exact",
                ContinuationAvailable: continuation,
                Results:               page,
        }
        if continuation {
                resp.NextCursor = signCursor(map[string]any{"s": sid, "o": sess.offset}, e.Secret)
        }
        return resp
}

// BooksGrouped «این عبارت در چه کتاب‌هایی آمده؟» — فقط تأییدشده‌ها (§۴۷).
func (e *LocalEngine) BooksGrouped(ctx context.Context, sessionUID string) ([]BookGroup, error) {
        e.mu.Lock()
        sess, ok := e.sessions[sessionUID]
        e.mu.Unlock()
        if !ok || time.Now().After(sess.expire) {
                return nil, &GoneError{Message: "مهلت این جست‌وجو پایان یافته است؛ دوباره اجرا کنید."}
        }
        sess.expire = time.Now().Add(sessionTTL)
        workOrder := []string{}
        groups := map[string]*BookGroup{}
        docOrder := map[string][]string{}
        docs := map[string]*DocEvidence{}
        for _, r := range sess.verified {
                bg, ok2 := groups[r.Work.UID]
                if !ok2 {
                        bg = &BookGroup{Work: r.Work, Documents: []DocEvidence{}}
                        groups[r.Work.UID] = bg
                        workOrder = append(workOrder, r.Work.UID)
                }
                key := r.Work.UID + "|" + r.Document.UID
                dg, ok3 := docs[key]
                if !ok3 {
                        dg = &DocEvidence{Document: r.Document, Evidence: []Result{}}
                        docs[key] = dg
                        docOrder[r.Work.UID] = append(docOrder[r.Work.UID], r.Document.UID)
                }
                dg.VerifiedOccurrences++
                if len(dg.Evidence) < 3 {
                        dg.Evidence = append(dg.Evidence, r)
                }

        }
        var out []BookGroup
        for _, wUID := range workOrder {
                bg := groups[wUID]
                bg.Documents = []DocEvidence{}
                for _, dUID := range docOrder[wUID] {
                        bg.Documents = append(bg.Documents, *docs[wUID+"|"+dUID])
                }
                out = append(out, *bg)
        }
        if out == nil {
                out = []BookGroup{}
        }
        return out, nil
}

// SearchTitles جست‌وجوی نام کتاب.
func (e *LocalEngine) SearchTitles(ctx context.Context, q string, pageSize int) ([]TitleHit, error) {
        db, err := e.dbHandle()
        if err != nil {
                return nil, err
        }
        nf := norm.Fold(q)
        rows, err := db.Query(`SELECT work_uid, title, short_title, author FROM titles ORDER BY work_uid`)
        if err != nil {
                return nil, err
        }
        defer rows.Close()
        var out []TitleHit
        for rows.Next() {
                var uid, title, short, author string
                if err := rows.Scan(&uid, &title, &short, &author); err != nil {
                        continue
                }
                if nf == "" || strings.Contains(norm.Fold(title), nf) || strings.Contains(norm.Fold(short), nf) {
                        out = append(out, TitleHit{WorkUID: uid, Title: title, ShortTitle: short, Author: author})
                }
                if len(out) >= pageSize {
                        break
                }
        }
        return out, nil
}

// ---- اجرا: کاندید → verifier ----

type candRow struct {
        PassageUID    string
        ReleaseUID    string
        CollectionUID string
        WorkUID       string
        DocumentUID   string
        SectionUID    sql.NullString
        PageUID       string
        PageLabel     sql.NullString
        Language      string
        LocalHadith   sql.NullString
        RevayatIndex  sql.NullString
        TextOriginal  string
        TextN1        string
        N1Map         string
        SourceStart   int
        SourceEnd     int
        RoleRanges    string
        Citations     sql.NullString
        Fingerprint   sql.NullString
        BlockStart    int
        BlockEnd      int
}

func scanCand(rows *sql.Rows, r *candRow) error {
        return rows.Scan(&r.PassageUID, &r.ReleaseUID, &r.CollectionUID, &r.WorkUID, &r.DocumentUID,
                &r.SectionUID, &r.PageUID, &r.PageLabel, &r.Language, &r.LocalHadith,
                &r.RevayatIndex,
                &r.TextOriginal, &r.TextN1, &r.N1Map, &r.SourceStart, &r.SourceEnd,
                &r.RoleRanges, &r.Citations, &r.Fingerprint, &r.BlockStart, &r.BlockEnd)
}

// candCols فهرست صریح ستون‌ها — ترتیب اسکن هرگز به ترتیب فیزیکی جدول وابسته نیست
// (اشتباهِ ترتیب = خطای اسکن = حذف خاموش همهٔ کاندیدها؛ رگرسیون واقعی این فایل).
const candCols = `passage_uid,release_uid,collection_uid,work_uid,document_uid,` +
        `section_uid,page_uid,page_label,language,local_hadith_uid,revayat_index,` +
        `text_original,text_n1,n1_map,source_start,source_end,role_ranges,citations,fingerprint,block_start,block_end`

func (e *LocalEngine) run(ctx context.Context, db *sql.DB, req *Request, releaseUID string) ([]Result, bool, error) {
        qN, _ := norm.Normalize(req.Query)
        toks := norm.Tokenize(qN)
        citationOnly := req.Scope.Quran != nil && len(toks) == 0
        if len(toks) == 0 && !citationOnly {
                return nil, true, nil
        }
        var rows *sql.Rows
        var err error
        if citationOnly {
                // جست‌وجوی استناد قرآنی (QUR-03): همهٔ passages دامنه، فیلتر در verifier
                rows, err = db.Query(`SELECT `+candCols+` FROM passages WHERE release_uid=? ORDER BY work_uid, document_uid, block_start`, releaseUID)
        } else if req.Mode == StrictPhrase {
                // عبارت دقیق: اسکن متنی scope با مرز واژه روی متن اصلی (بدون stemming/fuzzy)
                rows, err = db.Query(`SELECT `+candCols+` FROM passages WHERE release_uid=? ORDER BY work_uid, document_uid, block_start`, releaseUID)
        } else if req.Mode == AnyWords || req.Mode == Linguistic {
                ph := placeholders(len(toks))
                rows, err = db.Query(`SELECT s.`+strings.ReplaceAll(candCols, ",", ",s.")+` FROM passages s WHERE s.release_uid=? AND s.passage_uid IN (
                        SELECT DISTINCT p.passage_uid FROM postings p JOIN tokens t ON t.token_id=p.token_id WHERE t.token IN (`+ph+`) LIMIT 20000)
                        ORDER BY s.work_uid, s.document_uid, s.block_start`, append([]any{releaseUID}, toStrs(toks)...)...)
        } else {
                // پیش‌فیلتر «همهٔ واژه‌ها باید در passage باشند»: شمار مقایسه‌ای =
                // شمار واژه‌های متمایزِ پرس‌وجو (نه توکن‌ها با تکرار) — وگرنه هر عبارت
                // دارای واژهٔ تکراری (مثل «الرسول ما الرسول») بی‌کاندید می‌ماند.
                uniq := dedupStrings(toks)
                ph := placeholders(len(uniq))
                rows, err = db.Query(`SELECT s.`+strings.ReplaceAll(candCols, ",", ",s.")+` FROM passages s WHERE s.release_uid=? AND s.passage_uid IN (
                        SELECT p.passage_uid FROM postings p JOIN tokens t ON t.token_id=p.token_id WHERE t.token IN (`+ph+`)
                        GROUP BY p.passage_uid HAVING COUNT(DISTINCT t.token)=? LIMIT 20000)
                        ORDER BY s.work_uid, s.document_uid, s.block_start`, append([]any{releaseUID}, append(toStrs(uniq), len(uniq))...)...)
        }
        if err != nil {
                return nil, false, err
        }
        defer rows.Close()
        var out []Result
        seen := map[string]bool{}
        rowN := 0
        for rows.Next() {
                rowN++
                if ctx.Err() != nil {
                        return out, false, ctx.Err()
                }
                var r candRow
                if err := scanCand(rows, &r); err != nil {
                        // حذف خاموش ممنوع: خطای اسکن = کاندید نادیده = نتیجهٔ ناقص بی‌اعلام.
                        // طبق فلسفهٔ خطای §۳۹، این وضعیت باید صریحاً خطا باشد.
                        return nil, false, fmt.Errorf("scan candidate: %w", err)
                }
                // فیلتر دامنهٔ اثر/سند/زبان در verifier هم اعمال می‌شود (دفاع در عمق)
                if req.Scope.Target == "work" && (req.Scope.WorkUID == nil || r.WorkUID != *req.Scope.WorkUID) {
                        continue
                }
                if req.Scope.Target == "document" || req.Scope.Target == "section" {
                        inScope := false
                        for _, d := range req.Scope.DocumentUIDs {
                                if d == r.DocumentUID {
                                        inScope = true
                                        break
                                }
                        }
                        if !inScope {
                                continue
                        }
                }
                if req.Scope.Language != nil && *req.Scope.Language != "" && r.Language != *req.Scope.Language {
                        continue
                }
                if req.Scope.Quran != nil {
                        cits, err := parseCitations(r.Citations.String)
                        if err != nil {
                                continue
                        }
                        matched := false
                        for _, c := range cits {
                                if c.Sure == req.Scope.Quran.Sure {
                                        if req.Scope.Quran.Aya == "" {
                                                matched = true
                                                break
                                        }
                                        if c.Aya == req.Scope.Quran.Aya {
                                                matched = true
                                                break
                                        }
                                        if c.AyaFrom != "" && c.AyaTo != "" {
                                                if between(c.AyaFrom, c.AyaTo, req.Scope.Quran.Aya) {
                                                        matched = true
                                                        break
                                                }
                                        }
                                }
                        }
                        if !matched {
                                continue // استناد باید واقعاً در همین passage باشد، نه فقط در سند
                        }
                }
                hits, matchType := verifyInText(req, &r)
                if req.Scope.Quran != nil && len([]rune(req.Query)) == 0 && len(hits) == 0 {
                        // جست‌وجوی صرفاً استنادی: خود passage با شاهد ابتدایی نمایش داده می‌شود
                        n1r := []rune(r.TextOriginal)
                        hi := clampInt(160, 0, len(n1r))
                        hits = []hit{{Range: [2]int{0, hi}}}
                        matchType = "exact"
                }

                for _, h := range hits {
                        // کلید رخداد = document + محدودهٔ واقعی مطلق در جریان متن سند (§۴۵)
                        key := r.DocumentUID + ":" + fmt.Sprint(r.SourceStart+h.Range[0]) + ":" + fmt.Sprint(r.SourceStart+h.Range[1])
                        if seen[key] {
                                continue // overlap تکراری نتیجه نمی‌سازد؛ رخدادهای واقعی جدا می‌مانند
                        }
                        seen[key] = true
                        if len(req.Scope.Roles) > 0 && !matchInsideRoles(r.RoleRanges, h.Range) {
                                continue // فیلتر نقش: محل واقعی تطبیق باید داخل نقش باشد (§۴۵)
                        }
                        out = append(out, e.toResult(&r, h, matchType))
                }
        }
        return out, true, nil
}

type hit struct {
        Range [2]int // بازهٔ متن اصلی (code point)
}

// verifyInText بسته به mode تطبیق را روی متن واقعی همان نسخه تأیید می‌کند.
func verifyInText(req *Request, r *candRow) ([]hit, string) {
        orig := []rune(r.TextOriginal)
        n1 := []rune(r.TextN1)
        var n1Map []int
        _ = json.Unmarshal([]byte(r.N1Map), &n1Map)
        switch req.Mode {
        case StrictPhrase:
                q := []rune(req.Query)
                var out []hit
                start := 0
                for {
                        idx := indexRunes(orig[start:], q)
                        if idx < 0 {
                                break
                        }
                        s := start + idx
                        e := s + len(q)
                        if norm.WordBoundary(string(orig), s, e) {
                                out = append(out, hit{Range: [2]int{s, e}})
                        }
                        start = s + 1
                        if len(out) >= 50 {
                                break
                        }
                }
                return out, "exact"
        default:
                qN, _ := norm.Normalize(req.Query)
                if req.Mode == Linguistic {
                        qN = norm.Fold(req.Query)
                }
                if req.Mode == AllWords || req.Mode == Near {
                        toks := norm.Tokenize(qN)
                        positions := make([][]int, len(toks))
                        for i, t := range toks {
                                positions[i] = findAllWord(n1, t)
                        }
                        var out []hit
                        if req.Mode == Near && req.Near != nil && req.Near.Slop > 0 {
                                for _, rng := range nearCombination(positions, req.Near.Slop, req.Near.Ordered, len(n1)) {
                                        out = append(out, mapN1Hit(rng, n1Map))
                                }
                                return out, "normalized"
                        }
                        if allPresent(positions) {
                                lo, hi := -1, -1
                                for i, ps := range positions {
                                        if i == 0 || ps[0] < lo {
                                                lo = ps[0]
                                        }
                                        last := ps[len(ps)-1] + len([]rune(toks[i]))
                                        if i == 0 || last > hi {
                                                hi = last
                                        }
                                }
                                out = append(out, mapN1Hit([2]int{lo, hi}, n1Map))
                        }
                        return out, "normalized"
                }
                // normalized_phrase / linguistic / long_quote: تطبیق متوالی با مرز واژه
                qRunes := []rune(qN)
                var out []hit
                start := 0
                for {
                        idx := indexRunes(n1[start:], qRunes)
                        if idx < 0 {
                                break
                        }
                        s := start + idx
                        e := s + len(qRunes)
                        if norm.WordBoundary(string(n1), s, e) {
                                out = append(out, mapN1Hit([2]int{s, e}, n1Map))
                        }
                        start = s + 1
                        if len(out) >= 50 {
                                break
                        }
                }
                if req.Mode == Linguistic {
                        return out, "linguistic"
                }
                return out, "normalized"
        }
}

// mapN1Hit نگاشت بازهٔ نرمال → بازهٔ متن اصلی (highlight روی اصل — SEARCH-11).
func mapN1Hit(rng [2]int, n1Map []int) hit {
        if len(n1Map) == 0 {
                return hit{Range: rng}
        }
        s := clampInt(rng[0], 0, len(n1Map)-1)
        e := clampInt(rng[1], s, len(n1Map))
        if e > s {
                return hit{Range: [2]int{n1Map[s], n1Map[e-1] + 1}}
        }
        return hit{Range: [2]int{n1Map[s], n1Map[s]}}
}

func clampInt(v, lo, hi int) int {
        if v < lo {
                return lo
        }
        if v > hi {
                return hi
        }
        return v
}

func findAllWord(s []rune, w string) []int {
        var out []int
        rs := []rune(w)
        start := 0
        for {
                idx := indexRunes(s[start:], rs)
                if idx < 0 {
                        break
                }
                p := start + idx
                if norm.WordBoundary(string(s), p, p+len(rs)) {
                        out = append(out, p)
                }
                start = p + 1
        }
        return out
}

func allPresent(ps [][]int) bool {
        for _, p := range ps {
                if len(p) == 0 {
                        return false
                }
        }
        return true
}

func nearCombination(positions [][]int, slop int, ordered bool, textLen int) [][2]int {
        var out [][2]int
        if len(positions) == 0 || !allPresent(positions) {
                return nil
        }
        idx := make([]int, len(positions))
        for {
                var lo, hi int
                for i, p := range positions {
                        pos := p[idx[i]]
                        if i == 0 || pos < lo {
                                lo = pos
                        }
                        if i == 0 || pos > hi {
                                hi = pos
                        }
                }
                ok := (hi - lo) <= slop*6
                if ok && ordered && len(positions) > 1 {
                        for i := 1; i < len(positions); i++ {
                                if positions[i][idx[i]] < positions[i-1][idx[i-1]] {
                                        ok = false
                                        break
                                }
                        }
                }
                if ok {
                        out = append(out, [2]int{lo, clampInt(hi+len(positions[len(positions)-1]), 0, textLen)})
                }
                i := len(idx) - 1
                for i >= 0 {
                        idx[i]++
                        if idx[i] < len(positions[i]) {
                                break
                        }
                        idx[i] = 0
                        i--
                }
                if i < 0 || len(out) >= 10 {
                        break
                }
        }
        return out
}

type roleRangeT struct {
        Role  string `json:"role"`
        Start int    `json:"start"`
        End   int    `json:"end"`
}

// matchInsideRoles بازهٔ تطبیق باید با محدودهٔ واقعی نقش هم‌پوشان باشد (§۴۵).
func matchInsideRoles(roleRangesJSON string, rng [2]int) bool {
        if roleRangesJSON == "" || roleRangesJSON == "[]" {
                return false
        }
        var rr []roleRangeT
        if err := json.Unmarshal([]byte(roleRangesJSON), &rr); err != nil {
                return false
        }
        for _, r := range rr {
                if r.Start < rng[1] && r.End > rng[0] {
                        return true
                }
        }
        return false
}

func (e *LocalEngine) toResult(r *candRow, h hit, matchType string) Result {
        work := Ref{UID: r.WorkUID}
        if t, s, _, ok := e.catalog.WorkTitle(r.WorkUID); ok {
                work.Title = t
                work.Label = s
        }
        doc := Ref{UID: r.DocumentUID}
        if _, label, ok := e.catalog.DocumentMeta(r.DocumentUID); ok {
                doc.Label = label
        }
        doc.Title = work.Title
        sec := (*Ref)(nil)
        if r.SectionUID.Valid && r.SectionUID.String != "" {
                title, _ := e.catalog.SectionTitle(r.DocumentUID, r.SectionUID.String)
                sec = &Ref{UID: r.SectionUID.String, Title: title, Label: title}
        }
        var ranges []roleRangeT
        _ = json.Unmarshal([]byte(r.RoleRanges), &ranges)
        roles := []string{}
        for _, g := range ranges {
                if g.Start < h.Range[1] && g.End > h.Range[0] {
                        roles = append(roles, g.Role)
                }
        }
        roles = dedupStrings(roles)
        snippet := []rune(r.TextOriginal)
        lo := clampInt(h.Range[0]-60, 0, len(snippet))
        hi := clampInt(h.Range[1]+60, 0, len(snippet))
        sub := string(snippet[lo:hi])
        hl := Range{Start: h.Range[0] - lo, End: h.Range[1] - lo, Unit: "codepoint"}
        return Result{
                PassageUID: r.PassageUID, MatchType: matchType,
                Work: work, Document: doc,
                Page:    Ref{UID: r.PageUID, Label: orDefault(r.PageLabel.String, "—")},
                Section: sec,
                Snippet: sub, Highlight: []Range{hl},
                Roles: roles, LocalHadith: r.LocalHadith.String,
                RevayatIndex: r.RevayatIndex.String,
                Fingerprint: r.Fingerprint.String,
                SourceRange: [2]int{r.SourceStart, r.SourceEnd},
                MatchRange:  [2]int{r.SourceStart + h.Range[0], r.SourceStart + h.Range[1]},
                Citations:   json.RawMessage(r.Citations.String),
        }
}

func dedupStrings(s []string) []string {
        seen := map[string]bool{}
        var out []string
        for _, x := range s {
                if !seen[x] {
                        seen[x] = true
                        out = append(out, x)
                }
        }
        return out
}

// indexRunes یافتن زیررشته بر پایهٔ code point — نه بایت (صحت نشانی عربی/فارسی).
func indexRunes(s []rune, sub []rune) int {
        n := len(sub)
        if n == 0 || n > len(s) {
                return -1
        }
        for i := 0; i+n <= len(s); i++ {
                match := true
                for j := 0; j < n; j++ {
                        if s[i+j] != sub[j] {
                                match = false
                                break
                        }
                }
                if match {
                        return i
                }
        }
        return -1
}

func placeholders(n int) string {
        return strings.TrimSuffix(strings.Repeat("?,", n), ",")
}

func toStrs(ss []string) []any {
        out := make([]any, len(ss))
        for i, s := range ss {
                out[i] = s
        }
        return out
}

func orDefault(s, d string) string {
        if s == "" {
                return d
        }
        return s
}

// ---- cursor امضاشده opaque ----

func signCursor(payload map[string]any, secret []byte) string {
        b, _ := json.Marshal(payload)
        body := base64.RawURLEncoding.EncodeToString(b)
        mac := hmac.New(sha256.New, secret)
        mac.Write([]byte(body))
        return body + "." + hex.EncodeToString(mac.Sum(nil)[:16])
}

func verifyCursor(cursor string, secret []byte) bool {
        parts := strings.SplitN(cursor, ".", 2)
        if len(parts) != 2 {
                return false
        }
        mac := hmac.New(sha256.New, secret)
        mac.Write([]byte(parts[0]))
        want := hex.EncodeToString(mac.Sum(nil)[:16])
        return hmac.Equal([]byte(want), []byte(parts[1]))
}

func newID(prefix string) string {
        b := make([]byte, 8)
        _, _ = rand.Read(b)
        return prefix + "-" + hex.EncodeToString(b)
}

// parseCitations استنادهای ذخیره‌شدهٔ passage را می‌خواند (فرمت xmlparse.Citation).
func parseCitations(raw string) ([]citationRef, error) {
        if raw == "" || raw == "null" {
                return nil, nil
        }
        var out []citationRef
        if err := json.Unmarshal([]byte(raw), &out); err != nil {
                return nil, err
        }
        return out, nil
}

type citationRef struct {
        Sure     string `json:"sure"`
        Aya      string `json:"aya"`
        AyaFrom  string `json:"aya_from"`
        AyaTo    string `json:"aya_to"`
        Address  string `json:"address"`
        BlockID  string `json:"block_id"`
        InHadith string `json:"in_hadith"`
}

// between بررسی تعلق آیهٔ پرس‌شده به بازهٔ استناد (اعداد فارسی/عربی/لاتین نرمال می‌شوند).
func between(from, to, aya string) bool {
        f := numNorm(from)
        t := numNorm(to)
        a := numNorm(aya)
        if f == "" || t == "" || a == "" {
                return false
        }
        return a >= f && a <= t
}

func numNorm(s string) string {
        digits := map[rune]string{
                '٠': "0", '١': "1", '٢': "2", '٣': "3", '٤': "4", '٥': "5", '٦': "6", '٧': "7", '٨': "8", '٩': "9",
                '۰': "0", '۱': "1", '۲': "2", '۳': "3", '۴': "4", '۵': "5", '۶': "6", '۷': "7", '۸': "8", '۹': "9",
        }
        var b []byte
        for _, r := range s {
                if d, ok := digits[r]; ok {
                        b = append(b, d...)
                } else if r >= '0' && r <= '9' {
                        b = append(b, byte(r))
                }
        }
        return string(b)
}
