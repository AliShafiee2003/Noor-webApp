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
	"log"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf8"

	"noor/internal/index"
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
	SimilarQuote     = "similar_quote"
	Tiered           = "tiered"
)

// Scope دامنهٔ جست‌وجو (§۴۸).
type Scope struct {
	Target         string   `json:"target"` // library|collection|work|document|section|titles|authors|citations
	CollectionUIDs []string `json:"collection_uids,omitempty"`
	WorkUID        *string  `json:"work_uid,omitempty"`
	Author         *string  `json:"author,omitempty"`
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
	IgnoreSpacing bool      `json:"ignore_spacing,omitempty"`
	Query         string    `json:"query"`
	Mode          string    `json:"mode"`
	Scope         Scope     `json:"scope"`
	Near          *NearOpts `json:"near,omitempty"`
	Sort          string    `json:"sort"` // relevance|source
	PageSize      int       `json:"page_size"`
	// گزینه‌های موتور FTS5 (§۱۵/§۲۰/§۲۳) — موتورهای دیگر نادیده می‌گیرند.
	// Diacritics: "" یا "ignore" = اعراب نادیده؛ "respect" = هر علامتی که کاربر نوشته باید
	// روی همان حرف در متن باشد (متن می‌تواند اعراب بیشتری داشته باشد؛ حرف بی‌حرکت متن سازگار
	// است — §۱۵ پیش‌فرض)؛ "respect_strict" = حرف بی‌حرکت متن هم ناسازگار.
	Diacritics string `json:"diacritics,omitempty"`
	// Layers محدودسازی لایه‌ها در tiered/similar/long (L1..L5)؛ خالی = L1 تا L4.
	Layers []string `json:"layers,omitempty"`
	// MinScore آستانهٔ شباهت L4 در بازهٔ [0.5, 1]؛ صفر = پیش‌فرض ۰٫۷۰.
	MinScore float64 `json:"min_score,omitempty"`
	// NearSpelling فعال‌سازی L5 (واژهٔ نزدیک با یک ویرایش حرفی) — فقط با انتخاب صریح.
	NearSpelling bool `json:"near_spelling,omitempty"`
	// ExpandMorphology گسترش صرفی L3 (مفرد ↔ جمع با «ها») — فقط با انتخاب صریح؛ نتایج
	// با match_type «L3 (صورت صرفی)» و برچسب تفاوت جدا گزارش می‌شوند.
	ExpandMorphology bool `json:"expand_morphology,omitempty"`

	// — قرارداد دوحالته (modes.go): canonicalize این دو را به حالت داخلی برمی‌گرداند و پاک می‌کند.
	// Flex میزان انعطاف حالت text: exact | written | spelling | similar (پیش‌فرض).
	Flex string `json:"flex,omitempty"`
	// Words تنظیمات حالت words.
	Words *WordsOpts `json:"words,omitempty"`
	// ResultLayers فیلتر نمایش نتایج بر لایه (L1..L5). روی همان اجرای کش‌شده اعمال می‌شود و در
	// کلید کش نیست؛ شمارش‌های قطعی و layer_counts همیشه کل جست‌وجو را گزارش می‌کنند.
	ResultLayers []string `json:"result_layers,omitempty"`
}

// Result نتیجهٔ تأییدشده.
type Result struct {
	PassageUID  string   `json:"passage_uid"`
	MatchType   string   `json:"match_type"`
	Work        Ref      `json:"work"`
	Document    Ref      `json:"document"`
	Page        Ref      `json:"page"`
	Section     *Ref     `json:"section,omitempty"`
	Snippet     string   `json:"snippet"`
	Highlight   []Range  `json:"highlight"`
	Roles       []string `json:"roles"`
	LocalHadith string   `json:"local_hadith_uid,omitempty"`
	// RevayatIndex شمارهٔ درون‌منبع روایت (HAD-08) — نمایش در کارت نتیجه؛
	// تعمیم به کتاب‌های دیگر ندارد و در پرس‌وجوی میان‌کتابی (§۴۷) به‌کار نمی‌رود.
	RevayatIndex string `json:"revayat_index,omitempty"`
	Fingerprint  string `json:"fingerprint,omitempty"`
	SourceRange  [2]int `json:"source_offsets"`
	// بازهٔ دقیق تطبیق در مختصات سند (نه فقط passage) — برای هایلایت کتاب‌خوان
	MatchRange [2]int          `json:"match_offsets,omitempty"`
	Citations  json.RawMessage `json:"citations,omitempty"`
	// Layer لایهٔ تطبیق (L1 عین متن، L2 نرمال‌شده، L3 آزاد، L4 مشابه، L5 واژهٔ نزدیک) —
	// فقط موتور FTS5 پر می‌کند.
	Layer string `json:"layer,omitempty"`
	// Diffs تفاوت‌های L3/L5 با پرسش («پیشوند و»، «همزه/الف»، …).
	Diffs []string `json:"diffs,omitempty"`
	// Similarity جزئیات هم‌ترازی L4 (و امتیاز لایه‌های دیگر در similar_quote).
	Similarity *Similarity `json:"similarity,omitempty"`
	// FullText متن کامل قطعه در صورت روایت یا استخراج
	FullText string `json:"full_text,omitempty"`
}

// Similarity جزئیات امتیاز شباهت لفظی (§۲۳) — هرگز «درصد اطمینان علمی» نیست.
type Similarity struct {
	Score     float64    `json:"score"`
	Coverage  float64    `json:"coverage"`
	Counts    EditCounts `json:"counts"`
	Diffs     []string   `json:"diffs,omitempty"`
	Algorithm string     `json:"algorithm"`
	Version   string     `json:"version"`
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
	SessionUID          string `json:"session_uid"`
	ReleaseUID          string `json:"release_uid"`
	CompletionState     string `json:"completion_state"`
	VerifiedOccurrences int    `json:"verified_occurrences"`
	VerifiedBooks       int    `json:"verified_books"`
	// TECH-11: شمارش جداگانهٔ قطعه‌های متمایز و روایت‌های متمایز — با مواضع/کتاب‌ها مخلوط نمی‌شود
	VerifiedPassages      int    `json:"verified_passages,omitempty"`
	VerifiedHadiths       int    `json:"verified_hadiths,omitempty"`
	CountRelation         string `json:"count_relation"`
	ContinuationAvailable bool   `json:"continuation_available"`
	NextCursor            string `json:"next_cursor,omitempty"`
	CountJobUID           string `json:"count_job_uid,omitempty"`
	// Notice پیام صادقانهٔ فارسی برای حالت‌های خاص (مثل فعال‌شدن سقف نتایج) —
	// افزودهٔ سازگار با قرارداد؛ نبودش معنی «حالت عادی» دارد.
	Notice  string   `json:"notice,omitempty"`
	Results []Result `json:"results"`
	// LayerCounts شمار اختصاصی هر لایه (فقط FTS5 در حالت‌های لایه‌ای).
	LayerCounts map[string]int `json:"layer_counts,omitempty"`
	// SimilarOccurrences شمار نتایج L4/L5 که در «شمار قطعی» (verified_occurrences) جمع نمی‌شوند.
	SimilarOccurrences int `json:"similar_occurrences,omitempty"`
	// TotalResults کل نتایج قابل‌پیمایش این نشست (قطعی + مشابه) برای صفحه‌بندی.
	TotalResults int `json:"total_results,omitempty"`
	// SimilarCoverage وضعیت پوشش L4: complete | partial (سقف‌های تعاملی) — §۲۲.
	SimilarCoverage string `json:"similar_coverage,omitempty"`
	// Engine نام موتور پاسخ‌دهنده و نسخهٔ قواعد (برای ثبت در فیش و خروجی).
	Engine string `json:"engine,omitempty"`
	// EffectiveMode/EffectiveFlex حالت داخلی اجراشده و سطح انعطاف معادل آن (قرارداد text/words).
	EffectiveMode string `json:"effective_mode,omitempty"`
	EffectiveFlex string `json:"effective_flex,omitempty"`
	// ResultLayers فیلتر نمایش اعمال‌شده؛ total_results و صفحه‌بندی روی فهرست فیلترشده است.
	ResultLayers []string `json:"result_layers,omitempty"`
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

// LocalEngine موتور محلی روی نمایهٔ SQLite (§۴۶).
// صفحه‌بندی: نشست فقط «درخواست + release» را نگه می‌دارد (SQLite یا حافظه با سقف و
// تخلیهٔ per-session)؛ ادامهٔ صفحه‌بندی با re-execute قطعی همان پرس‌وجو و skip موقعیتی
// انجام می‌شود — هیچ آرایهٔ کامل نتایج در حافظهٔ نشست نگه داشته نمی‌شود (ب-۶).
type LocalEngine struct {
	path       string
	Secret     []byte
	catalog    MetaSource
	mu         sync.Mutex
	memSess    map[string]*memSession
	maxResults int
	sessionTTL time.Duration
	// candCap سقف بازیابی کاندید در زیرکوئری‌ها (SEARCH-01)؛
	// از NOOR_CANDIDATE_CAP یا WithCandidateCap؛ پیش‌فرض DefaultCandidateCap.
	candCap   int
	sessStore SessionStore
	dbMu      sync.Mutex
	db        *sql.DB
	dbInode   uint64
	dbSize    int64
	// آمار پیش‌فیلتر (round14-B آزمون مقیاس) — فقط شمارش برای پایش/بنچمارک؛
	// هیچ تصمیمی از روی این مقادیر گرفته نمی‌شود و مسیر صحت جست‌وجو تغییری نمی‌کند.
	statCands  atomic.Int64
	hasOverlap atomic.Bool  // نمایهٔ باز ستون overlap_runes دارد؟ (SEARCH-02) // کاندیدهای واکشی‌شده در آخرین run کامل
	statScans  atomic.Int64 // دفعات اسکن کاملِ strict (نمایهٔ قدیمی یا عبارت کوتاه)
}

// MetaSource ابردادهٔ کار/سند.
type MetaSource interface {
	WorkTitle(uid string) (title, short, author string, ok bool)
	DocumentMeta(uid string) (workUID, label string, ok bool)
	SectionTitle(docUID, secUID string) (string, bool)
}

// SessionStore نگهداری سبک نشست جست‌وجو (فقط درخواست؛ نه نتایج).
// پیاده‌سازی تولیدی: جدول search_sessions در app.sqlite.
type SessionStore interface {
	SaveSearchSession(uid, releaseUID string, reqJSON []byte, ttl time.Duration) error
	// LoadSearchSession اگر نشست نبود یا منقضی بود، خطای ErrSearchSessionGone می‌دهد.
	LoadSearchSession(uid string) (releaseUID string, reqJSON []byte, err error)
	TouchSearchSession(uid string, ttl time.Duration) error
}

// ErrSearchSessionGone نشست جست‌وجو نیست/منقضی است → 410 (GoneError).
var ErrSearchSessionGone = errors.New("search session gone")

type memSession struct {
	release string
	reqJSON []byte
	expire  time.Time
}

// پیش‌فرض‌های قابل‌تنظیم با option (ب-۵: سقف کل نتایج و TTL نشست).
const (
	defaultMaxResults = 10000
	defaultSessionTTL = 30 * time.Minute
	maxMemSessions    = 400 // فقط برای fallback حافظه؛ با تخلیهٔ per-session
	// DefaultCandidateCap سقف بازیابی کاندید در زیرکوئری‌ها (SEARCH-01).
	// رسیدن به این سقف یعنی احتمال برش کاندید → پاسخ باید partial/lower_bound باشد
	// (هرگز complete/exact). قابل‌تنظیم با NOOR_CANDIDATE_CAP.
	DefaultCandidateCap = 20000
)

// envCandidateCap متغیر محیطی سقف کاندید.
const envCandidateCap = "NOOR_CANDIDATE_CAP"

// candidateCapFromEnv خواندن سقف کاندید از محیط؛ مقدار نامعتبر/غیرمثبت
// بی‌صدا نادیده گرفته می‌شود و پیش‌فرض برمی‌گردد (SEARCH-01 — قابل آزمون).
func candidateCapFromEnv() int {
	v := strings.TrimSpace(os.Getenv(envCandidateCap))
	if v == "" {
		return DefaultCandidateCap
	}
	n, err := strconv.Atoi(v)
	if err != nil || n <= 0 {
		return DefaultCandidateCap
	}
	return n
}

// runState وضعیت صداقت پاسخ پس از هر اجرا (SEARCH-01/07):
// capped = سقف کل نتایج فعال شد؛ candSaturated = بازیابی کاندید به سقف خورد
// یا منبع (OpenSearch) ناقص گزارش داد — در هر دو حالت، اعلام «کامل/دقیق» ممنوع است.
type runState struct {
	capped        bool
	candSaturated bool
	hitTruncated  bool // سقف مواضع در برخی قطعه‌ها فعال شد (۵۰ برای modeها، ۱۰ برای near)
}

// verifyStats آمار فرایند تطبیق؛ صادق‌گویی سقف‌های هر قطعه (ممیزی: سقف ۵۰ بی‌اعلام).
type verifyStats struct {
	truncatedPassages int
}

type Option func(*LocalEngine)

// WithLimits سقف کل نتایج تأییدشدهٔ هر پرس‌وجو و TTL نشست را تنظیم می‌کند.
func WithLimits(maxResults int, ttl time.Duration) Option {
	return func(e *LocalEngine) {
		if maxResults > 0 {
			e.maxResults = maxResults
		}
		if ttl > 0 {
			e.sessionTTL = ttl
		}
	}
}

// WithCandidateCap سقف بازیابی کاندید را تنظیم می‌کند (SEARCH-01)؛
// مقادیر غیرمثبت نادیده گرفته می‌شوند. برای آزمون اشباع با مقدار کوچک.
func WithCandidateCap(n int) Option {
	return func(e *LocalEngine) {
		if n > 0 {
			e.candCap = n
		}
	}
}

// WithSessionStore نشست‌ها را در SQLite نگه می‌دارد (پیش‌فرض: حافظه با سقف).
func WithSessionStore(s SessionStore) Option {
	return func(e *LocalEngine) { e.sessStore = s }
}

func NewLocal(path string, secret []byte, meta MetaSource, opts ...Option) *LocalEngine {
	e := &LocalEngine{path: path, Secret: secret, catalog: meta,
		memSess:    map[string]*memSession{},
		maxResults: defaultMaxResults,
		sessionTTL: defaultSessionTTL,
		candCap:    candidateCapFromEnv(), // SEARCH-01: سقف کاندید قابل‌تنظیم با محیط
	}
	for _, o := range opts {
		o(e)
	}
	return e
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
			var n int
			if qerr := db.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('passages') WHERE name='overlap_runes'`).Scan(&n); qerr == nil && n > 0 {
				e.hasOverlap.Store(true)
			} else {
				e.hasOverlap.Store(false)
			}
		}
		return e.db, nil
	}
	if e.db != nil {
		return e.db, nil
	}
	return nil, errors.New("نمایهٔ جست‌وجو در دسترس نیست")
}

// Close بستن اتصال باز به دیتابیس نمایه.
func (e *LocalEngine) Close() error {
	e.dbMu.Lock()
	defer e.dbMu.Unlock()
	if e.db != nil {
		err := e.db.Close()
		e.db = nil
		return err
	}
	return nil
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

// LastCandidateCount آمار پیش‌فیلتر: شمار کاندیدهای واکشی‌شده در آخرین run کامل
// (Search/Continue). برای سنجش گزینش‌پذیری پیش‌فیلتر در آزمون مقیاس (round14-B).
func (e *LocalEngine) LastCandidateCount() int64 { return e.statCands.Load() }

// FullScanCount آمار پیش‌فیلتر: شمار دفعات اسکن کاملِ strict از آغاز عمر موتور
// (نمایهٔ قدیمی یا عبارت کوتاه‌تر از ۳ نویسه — مسیر fallback).
func (e *LocalEngine) FullScanCount() int64 { return e.statScans.Load() }

func (e *LocalEngine) validate(req *Request) error { return validateRequest(req) }

// validateRequest قواعد مشترک اعتبارسنجی پرس‌وجو (هر سه موتور). نخست قرارداد text/words
// به حالت داخلی برگردانده می‌شود تا همهٔ قواعد بعدی (و کلید کش) فقط حالت داخلی را ببینند.
func validateRequest(req *Request) error {
	if err := canonicalize(req); err != nil {
		return err
	}
	if req.IgnoreSpacing {
		if req.Mode != NormalizedPhrase || (req.Scope.Target != "document" && req.Scope.Target != "work") {
			return errors.New("ignore_spacing فقط برای عبارت نرمال‌شده در دامنه جلد یا اثر معتبر است")
		}
		if req.Scope.Target == "work" && (req.Scope.WorkUID == nil || *req.Scope.WorkUID == "") {
			return errors.New("شناسه اثر لازم است")
		}
		if req.Scope.Target == "document" && len(req.Scope.DocumentUIDs) == 0 {
			return errors.New("شناسه جلد لازم است")
		}
	}

	n := utf8.RuneCountInString(req.Query)
	// جست‌وجوی صرفاً استنادی (بدون عبارت) مجاز است — QUR-03
	if n == 0 && req.Scope.Quran == nil {
		return errors.New("عبارت جست‌وجو خالی است")
	}
	if !isKnownMode(req.Mode) {
		return fmt.Errorf("حالت جست‌وجو معتبر نیست")
	}
	limit := maxWordsQueryRunes
	if isTextMode(req.Mode) {
		limit = maxTextQueryRunes
	}
	if n > limit {
		return fmt.Errorf("عبارت بیش از حد مجاز است (حداکثر %s نویسه)", faNum(limit))
	}
	if req.Mode == AnyWords {
		if k := len(dedupStrings(norm.Tokenize(req.Query))); k > maxAnyWords {
			return fmt.Errorf("«حداقل یک واژه» حداکثر %s واژهٔ متمایز می‌پذیرد (%s داده شد)", faNum(maxAnyWords), faNum(k))
		}
	}
	for _, l := range req.ResultLayers {
		switch l {
		case "L1", "L2", "L3", "L4", "L5":
		default:
			return fmt.Errorf("لایهٔ نمایش %q معتبر نیست (L1 تا L5)", l)
		}
	}
	if len(req.ResultLayers) > 0 && !isTextMode(req.Mode) {
		return errors.New("فیلتر لایه (result_layers) فقط در حالت text معتبر است")
	}
	if req.PageSize < 5 || req.PageSize > 50 {
		req.PageSize = 20
	}
	switch req.Diacritics {
	case "", "ignore", "respect", "respect_strict":
	default:
		return fmt.Errorf("گزینهٔ اعراب معتبر نیست (ignore، respect یا respect_strict)")
	}
	for _, l := range req.Layers {
		switch l {
		case "L1", "L2", "L3", "L4", "L5":
		default:
			return fmt.Errorf("لایهٔ %q معتبر نیست (L1 تا L5)", l)
		}
	}
	if req.MinScore != 0 && (req.MinScore < 0.5 || req.MinScore > 1) {
		return fmt.Errorf("آستانهٔ شباهت باید بین ۰٫۵ و ۱ باشد")
	}
	return nil
}

// Search اجرای جست‌وجو: کاندید → verifier → نتایج تأییدشده.
func (e *LocalEngine) Search(ctx context.Context, req *Request, releaseUID string) (*Response, error) {
	if err := e.validate(req); err != nil {
		return nil, err
	}
	if req.Scope.Target == "titles" || req.Scope.Target == "authors" {
		var hits []TitleHit
		var err error
		if req.Scope.Target == "authors" {
			hits, err = e.SearchAuthors(ctx, req.Query, req.PageSize)
		} else {
			hits, err = e.SearchTitles(ctx, req.Query, req.PageSize)
			if err == nil && req.Scope.Author != nil && *req.Scope.Author != "" {
				authorFold := norm.Fold(*req.Scope.Author)
				var filteredHits []TitleHit
				for _, h := range hits {
					if strings.Contains(norm.Fold(h.Author), authorFold) {
						filteredHits = append(filteredHits, h)
					}
				}
				hits = filteredHits
			}
		}
		if err != nil {
			return nil, err
		}
		resp := &Response{ReleaseUID: releaseUID, CompletionState: "complete", CountRelation: "exact", Results: []Result{}}
		for _, h := range hits {
			pageLabel := "نام کتاب"
			if req.Scope.Target == "authors" {
				pageLabel = "پدیدآور"
			}
			resp.Results = append(resp.Results, Result{
				PassageUID: "title-" + h.WorkUID, MatchType: "exact",
				Work:    Ref{UID: h.WorkUID, Title: h.Title, Label: h.ShortTitle},
				Section: &Ref{Title: h.Author},
				Page:    Ref{Label: pageLabel},
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
	verified, st, err := e.run(ctx, db, req, releaseUID)
	if err != nil {
		return nil, err
	}
	sid := newID("s")
	if err := e.saveSession(sid, releaseUID, req); err != nil {
		return nil, err
	}
	return e.buildResponse(sid, releaseUID, req, verified, 0, st), nil
}

// Continue ادامهٔ بررسی با cursor امضاشده (§۴۷) — re-execute قطعی + skip موقعیتی.
func (e *LocalEngine) Continue(ctx context.Context, sessionUID, cursor, releaseUID string) (*Response, error) {
	if !verifyCursor(cursor, e.Secret) {
		return nil, &GoneError{Message: "نشانهٔ ادامهٔ جست‌وجو معتبر نیست؛ دوباره اجرا کنید."}
	}
	payload, ok := parseCursorPayload(cursor)
	if !ok || payload.S != sessionUID {
		return nil, &GoneError{Message: "نشانهٔ ادامهٔ جست‌وجو معتبر نیست؛ دوباره اجرا کنید."}
	}
	release, req, err := e.loadSession(sessionUID)
	if err != nil {
		return nil, &GoneError{Message: "مهلت این جست‌وجو پایان یافته است؛ دوباره اجرا کنید."}
	}
	db, err := e.dbHandle()
	if err != nil {
		return nil, err
	}
	db, err = e.ensureRelease(db, release)
	if err != nil {
		return nil, err
	}
	verified, st, err := e.run(ctx, db, req, release)
	if err != nil {
		return nil, err
	}
	_ = releaseUID // پرس‌وجو با release نشست ادامه می‌یابد تا نتایج صفحه‌ها هم‌خوان بمانند
	return e.buildResponse(sessionUID, release, req, verified, payload.O, st), nil
}

// cursorPayload محتوای امضاشدهٔ cursor: شناسهٔ نشست + موقعیت.
type cursorPayloadT struct {
	S string `json:"s"`
	O int    `json:"o"`
}

func parseCursorPayload(cursor string) (cursorPayloadT, bool) {
	var out cursorPayloadT
	part := strings.SplitN(cursor, ".", 2)[0]
	b, err := base64.RawURLEncoding.DecodeString(part)
	if err != nil || json.Unmarshal(b, &out) != nil {
		return out, false
	}
	return out, true
}

// buildResponse پاسخ از روی نتایج کامل اجرای جاری می‌سازد؛ صفحه از offset شروع می‌شود.
// صداقت شمارش (SEARCH-01/07): سقف کل نتایج → lower_bound؛ اشباع کاندید/منبع ناقص →
// partial + lower_bound؛ پرس‌وجوی بی‌توکن → complete/exact با Notice صادقانهٔ خودش
// (هرگز پیام سقف — E7).
func (e *LocalEngine) buildResponse(sid, release string, req *Request, verified []Result, offset int, st runState) *Response {
	if offset < 0 {
		offset = 0
	}
	if offset > len(verified) {
		offset = len(verified)
	}
	pageSize := req.PageSize
	if pageSize < 5 || pageSize > 50 {
		pageSize = 20
	}
	page := verified[offset:]
	if len(page) > pageSize {
		page = page[:pageSize]
	}
	if page == nil {
		page = []Result{} // قرارداد results آرایه است — هرگز null
	}
	books := map[string]bool{}
	passages := map[string]bool{}
	hadiths := map[string]bool{}
	for _, r := range verified {
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
	newOffset := offset + len(page)
	continuation := newOffset < len(verified)
	// پرس‌وجوی بی‌توکن (غیراستنادی): نتیجه‌ای نیست و هیچ سقفی هم فعال نشده —
	// پیام سقف دروغ بود (E7)؛ حالا پاسخ کامل/دقیق با Notice مخصوص خودش است.
	qN, _ := norm.Normalize(req.Query)
	zeroToken := len(norm.Tokenize(qN)) == 0 && req.Scope.Quran == nil
	rel := "exact"
	completion := "complete"
	var notices []string
	if st.candSaturated {
		// اشباع بازیابی کاندید (SEARCH-01): احتمال برش کاندید — کامل/دقیق هرگز.
		completion = "partial"
		rel = "lower_bound"
		notices = append(notices, "شمار کاندیدها به سقف بازیابی رسید؛ شمارش‌ها حداقل واقعی‌اند.")
	}
	if st.capped {
		rel = "lower_bound" // سقف فعال شد؛ شمارش‌ها حداقل واقعی‌اند
		notices = append(notices, fmt.Sprintf("نتایج بیشتر از سقف جست‌وجو است؛ شمارش‌ها حداقل واقعی‌اند (سقف %s موضع).", faNum(e.maxResults)))
	}
	if st.hitTruncated {
		// سقف مواضعِ هر قطعه فعال شد (ممیزی: سقف ۵۰/۱۰ بی‌اعلام نماند) — صادقانه lower_bound.
		rel = "lower_bound"
		notices = append(notices, "شمار مواضع در برخی قطعه‌ها از سقفِ مواضعِ هر قطعه گذشت و برش خورد؛ شمارش‌ها حداقل واقعی‌اند.")
	}
	if zeroToken {
		notices = append(notices, "عبارت پس از نرمال‌سازی واژه‌ای نداشت؛ نتیجه‌ای وجود ندارد.")
	}
	resp := &Response{
		SessionUID:            sid,
		ReleaseUID:            release,
		CompletionState:       completion,
		VerifiedOccurrences:   len(verified),
		VerifiedBooks:         len(books),
		VerifiedPassages:      len(passages),
		VerifiedHadiths:       len(hadiths),
		CountRelation:         rel,
		ContinuationAvailable: continuation,
		Results:               page,
		EffectiveMode:         req.Mode,
		EffectiveFlex:         effectiveFlex(req.Mode),
	}
	if len(notices) > 0 {
		resp.Notice = strings.Join(notices, " ")
	}
	if continuation {
		resp.NextCursor = signCursor(map[string]any{"s": sid, "o": newOffset}, e.Secret)
	}
	return resp
}

// BooksGrouped «این عبارت در چه کتاب‌هایی آمده؟» — فقط تأییدشده‌ها (§۴۷).
// با re-execute از روی درخواست ذخیره‌شدهٔ نشست (بدون نگهداری نتایج در حافظه).
func (e *LocalEngine) BooksGrouped(ctx context.Context, sessionUID string) ([]BookGroup, error) {
	release, req, err := e.loadSession(sessionUID)
	if err != nil {
		return nil, &GoneError{Message: "مهلت این جست‌وجو پایان یافته است؛ دوباره اجرا کنید."}
	}
	db, err := e.dbHandle()
	if err != nil {
		return nil, err
	}
	db, err = e.ensureRelease(db, release)
	if err != nil {
		return nil, err
	}
	verified, _, err := e.run(ctx, db, req, release)
	if err != nil {
		return nil, err
	}
	workOrder := []string{}
	groups := map[string]*BookGroup{}
	docOrder := map[string][]string{}
	docs := map[string]*DocEvidence{}
	for _, r := range verified {
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

// ---- نشست جست‌وجو: ذخیرهٔ فقط «درخواست» — SQLite یا حافظه با تخلیهٔ per-session ----

func (e *LocalEngine) saveSession(sid, releaseUID string, req *Request) error {
	reqJSON, err := json.Marshal(req)
	if err != nil {
		return err
	}
	if e.sessStore != nil {
		return e.sessStore.SaveSearchSession(sid, releaseUID, reqJSON, e.sessionTTL)
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	e.evictMemSessionsLocked()
	e.memSess[sid] = &memSession{release: releaseUID, reqJSON: reqJSON, expire: time.Now().Add(e.sessionTTL)}
	return nil
}

func (e *LocalEngine) loadSession(sid string) (string, *Request, error) {
	if e.sessStore != nil {
		release, reqJSON, err := e.sessStore.LoadSearchSession(sid)
		if err != nil {
			return "", nil, err
		}
		_ = e.sessStore.TouchSearchSession(sid, e.sessionTTL)
		var req Request
		if err := json.Unmarshal(reqJSON, &req); err != nil {
			return "", nil, ErrSearchSessionGone
		}
		return release, &req, nil
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	ms, ok := e.memSess[sid]
	if !ok || time.Now().After(ms.expire) {
		if ok {
			delete(e.memSess, sid) // تخلیهٔ per-session، نه تخلیهٔ کلی
		}
		return "", nil, ErrSearchSessionGone
	}
	ms.expire = time.Now().Add(e.sessionTTL)
	var req Request
	if err := json.Unmarshal(ms.reqJSON, &req); err != nil {
		return "", nil, ErrSearchSessionGone
	}
	return ms.release, &req, nil
}

// evictMemSessionsLocked منقضی‌ها را حذف می‌کند؛ اگر هنوز بالای سقف بود،
// زودترین انقضا (قدیمی‌ترین) حذف می‌شود — هرگز تخلیهٔ کامل map نیست.
func (e *LocalEngine) evictMemSessionsLocked() {
	now := time.Now()
	for k, ms := range e.memSess {
		if now.After(ms.expire) {
			delete(e.memSess, k)
		}
	}
	for len(e.memSess) >= maxMemSessions {
		oldestK := ""
		var oldest time.Time
		for k, ms := range e.memSess {
			if oldestK == "" || ms.expire.Before(oldest) {
				oldestK = k
				oldest = ms.expire
			}
		}
		if oldestK == "" {
			break
		}
		delete(e.memSess, oldestK)
	}
}

func runeLev1(a, b []rune) bool {
	la, lb := len(a), len(b)
	if la < 4 || lb < 4 || la-lb > 1 || lb-la > 1 {
		return false
	}
	if la == lb {
		diff := 0
		for i := 0; i < la; i++ {
			if a[i] != b[i] {
				diff++
				if diff > 1 {
					return false
				}
			}
		}
		return diff <= 1
	}
	shorter, longer := a, b
	if la > lb {
		shorter, longer = b, a
	}
	for i := 0; i < len(longer); i++ {
		match := true
		si := 0
		for li := 0; li < len(longer); li++ {
			if li == i {
				continue
			}
			if longer[li] != shorter[si] {
				match = false
				break
			}
			si++
		}
		if match {
			return true
		}
	}
	return false
}

func slidingLev1(pattern, target []rune) bool {
	L := len(pattern)
	if L < 6 || len(target) < L-1 {
		return false
	}
	for _, wlen := range []int{L - 1, L, L + 1} {
		if wlen < 4 || wlen > len(target) {
			continue
		}
		for i := 0; i+wlen <= len(target); i++ {
			if runeLev1(pattern, target[i:i+wlen]) {
				return true
			}
		}
	}
	return false
}

// SearchTitles جست‌وجوی نام کتاب.
func (e *LocalEngine) SearchTitles(ctx context.Context, q string, pageSize int) ([]TitleHit, error) {
	db, err := e.dbHandle()
	if err != nil {
		return nil, err
	}
	nf := norm.Fold(q)
	nfComp := strings.ReplaceAll(strings.ReplaceAll(nf, " ", ""), "\u200c", "")
	nfRunes := []rune(nfComp)
	toks := norm.Tokenize(nf)
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
		tFold := norm.Fold(title)
		sFold := norm.Fold(short)
		tComp := strings.ReplaceAll(strings.ReplaceAll(tFold, " ", ""), "\u200c", "")
		sComp := strings.ReplaceAll(strings.ReplaceAll(sFold, " ", ""), "\u200c", "")
		matched := nf == "" || strings.Contains(tFold, nf) || strings.Contains(sFold, nf) ||
			(nfComp != "" && (strings.Contains(tComp, nfComp) || strings.Contains(sComp, nfComp)))
		if !matched && len(toks) > 1 {
			allToks := true
			titleToks := norm.Tokenize(tFold + " " + sFold)
			for _, tk := range toks {
				tkRunes := []rune(tk)
				foundTk := false
				for _, ttk := range titleToks {
					if strings.Contains(ttk, tk) || runeLev1(tkRunes, []rune(ttk)) {
						foundTk = true
						break
					}
				}
				if !foundTk {
					allToks = false
					break
				}
			}
			matched = allToks
		}
		if !matched && len(nfRunes) >= 6 {
			matched = slidingLev1(nfRunes, []rune(tComp)) || slidingLev1(nfRunes, []rune(sComp))
		}
		if matched {
			out = append(out, TitleHit{WorkUID: uid, Title: title, ShortTitle: short, Author: author})
		}
		if len(out) >= pageSize {
			break
		}
	}
	return out, nil
}

// SearchAuthors جست‌وجوی نام پدیدآور / مؤلف.
func (e *LocalEngine) SearchAuthors(ctx context.Context, q string, pageSize int) ([]TitleHit, error) {
	db, err := e.dbHandle()
	if err != nil {
		return nil, err
	}
	nf := norm.Fold(q)
	nfComp := strings.ReplaceAll(strings.ReplaceAll(nf, " ", ""), "\u200c", "")
	nfRunes := []rune(nfComp)
	toks := norm.Tokenize(nf)
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
		aFold := norm.Fold(author)
		aComp := strings.ReplaceAll(strings.ReplaceAll(aFold, " ", ""), "\u200c", "")
		matched := nf == "" || strings.Contains(aFold, nf) || (nfComp != "" && strings.Contains(aComp, nfComp))
		if !matched && len(toks) > 1 {
			allToks := true
			anySignificant := false
			authorToks := norm.Tokenize(aFold)
			for _, tk := range toks {
				tkRunes := []rune(tk)
				foundTk := false
				for _, atk := range authorToks {
					if strings.Contains(atk, tk) || runeLev1(tkRunes, []rune(atk)) {
						foundTk = true
						break
					}
				}
				if foundTk {
					if len(tkRunes) >= 4 {
						anySignificant = true
					}
				} else {
					allToks = false
				}
			}
			matched = allToks || anySignificant
		}
		if !matched && len(nfRunes) >= 6 {
			matched = slidingLev1(nfRunes, []rune(aComp))
		}
		if matched {
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
	OverlapRunes  int
}

func scanCand(rows *sql.Rows, r *candRow) error {
	return rows.Scan(&r.PassageUID, &r.ReleaseUID, &r.CollectionUID, &r.WorkUID, &r.DocumentUID,
		&r.SectionUID, &r.PageUID, &r.PageLabel, &r.Language, &r.LocalHadith,
		&r.RevayatIndex,
		&r.TextOriginal, &r.TextN1, &r.N1Map, &r.SourceStart, &r.SourceEnd,
		&r.RoleRanges, &r.Citations, &r.Fingerprint, &r.BlockStart, &r.BlockEnd)
}

// scanCandO اسکن با ستون اختیاری overlap_runes — نمایه‌های قدیمی این ستون را
// ندارند؛ در آن صورت overlap=۰ فرض می‌شود (رفتار پیشین حفظ می‌شود).
func scanCandO(rows *sql.Rows, r *candRow, withOverlap bool) error {
	if !withOverlap {
		return scanCand(rows, r)
	}
	return rows.Scan(&r.PassageUID, &r.ReleaseUID, &r.CollectionUID, &r.WorkUID, &r.DocumentUID,
		&r.SectionUID, &r.PageUID, &r.PageLabel, &r.Language, &r.LocalHadith,
		&r.RevayatIndex,
		&r.TextOriginal, &r.TextN1, &r.N1Map, &r.SourceStart, &r.SourceEnd,
		&r.RoleRanges, &r.Citations, &r.Fingerprint, &r.BlockStart, &r.BlockEnd, &r.OverlapRunes)
}

// candSelect فهرست ستون‌های کاندید + ستون اختیاری overlap (تشخیص در dbHandle).
func candSelect(withOverlap bool) string {
	if withOverlap {
		return candCols + ",COALESCE(overlap_runes,0)"
	}
	return candCols
}

// candCols فهرست صریح ستون‌ها — ترتیب اسکن هرگز به ترتیب فیزیکی جدول وابسته نیست
// (اشتباهِ ترتیب = خطای اسکن = حذف خاموش همهٔ کاندیدها؛ رگرسیون واقعی این فایل).
const candCols = `passage_uid,release_uid,collection_uid,work_uid,document_uid,` +
	`section_uid,page_uid,page_label,language,local_hadith_uid,revayat_index,` +
	`text_original,text_n1,n1_map,source_start,source_end,role_ranges,citations,fingerprint,block_start,block_end`

func (e *LocalEngine) run(ctx context.Context, db *sql.DB, req *Request, releaseUID string) ([]Result, runState, error) {
	qN, _ := norm.Normalize(req.Query)
	toks := norm.Tokenize(qN)
	citationOnly := req.Scope.Quran != nil && len(toks) == 0
	if len(toks) == 0 && !citationOnly {
		return nil, runState{}, nil // E7: پاسخ صادقانه در buildResponse ساخته می‌شود
	}
	cap := e.maxResults
	if cap <= 0 {
		cap = defaultMaxResults
	}
	var rows *sql.Rows
	var err error
	candLimited := false // زیرکوئری کاندید سقف دارد؟ (تشخیص اشباع SEARCH-01)
	ov := e.hasOverlap.Load()
	cols := candSelect(ov)
	sCols := strings.ReplaceAll(candCols, ",", ",s.")
	if ov {
		sCols += ",COALESCE(s.overlap_runes,0)"
	}
	if req.IgnoreSpacing {
		query := `SELECT ` + cols + ` FROM passages WHERE release_uid=?`
		args := []any{releaseUID}
		if req.Scope.Target == "work" {
			query += ` AND work_uid=?`
			args = append(args, *req.Scope.WorkUID)
		} else {
			query += ` AND document_uid IN (` + placeholders(len(req.Scope.DocumentUIDs)) + `)`
			for _, uid := range req.Scope.DocumentUIDs {
				args = append(args, uid)
			}
		}
		rows, err = db.QueryContext(ctx, query+` ORDER BY work_uid,document_uid,block_start`, args...)
	} else if citationOnly {
		// جست‌وجوی استناد قرآنی (QUR-03): همهٔ passages دامنه، فیلتر در verifier
		rows, err = db.Query(`SELECT `+cols+` FROM passages WHERE release_uid=? ORDER BY work_uid, document_uid, block_start`, releaseUID)
	} else if req.Mode == StrictPhrase {
		// عبارت دقیق: پیش‌فیلتر با سه‌گانه‌های نویسه‌ای text_n1 (بدون اسکن کامل)؛
		// تأیید نهایی تطبیق همیشه روی متن اصلی با مرز واژه در verifyInText می‌ماند —
		// رفتار نتایج تغییری نمی‌کند (pre-filter ابرمجموعهٔ sound است).
		tris := norm.Trigrams(qN)
		if len(tris) > 0 && index.HasTrigrams(db) {
			sel := sampleTrigrams(tris, 48)
			candLimited = true
			rows, err = db.Query(`SELECT s.`+sCols+` FROM passages s WHERE s.release_uid=? AND s.passage_uid IN (
                                SELECT passage_uid FROM trigrams WHERE tri IN (`+placeholders(len(sel))+`) GROUP BY passage_uid HAVING COUNT(DISTINCT tri)=? LIMIT ?)
                                ORDER BY s.work_uid, s.document_uid, s.block_start`, append([]any{releaseUID}, append(toStrs(sel), len(sel), e.candCap)...)...)
		} else {
			// نمایهٔ قدیمی بدون جدول trigrams یا عبارتِ کوتاه‌تر از ۳ نویسه — اسکن کامل (منصفانه گزارش می‌شود)
			log.Println("noor-search: strict_phrase بدون پیش‌فیلتر trigram (نمایه قدیمی یا عبارت کوتاه) — اسکن کامل")
			e.statScans.Add(1)
			rows, err = db.Query(`SELECT `+cols+` FROM passages WHERE release_uid=? ORDER BY work_uid, document_uid, block_start`, releaseUID)
		}
	} else if req.Mode == AnyWords || req.Mode == Linguistic {
		ph := placeholders(len(toks))
		candLimited = true
		rows, err = db.Query(`SELECT s.`+sCols+` FROM passages s WHERE s.release_uid=? AND s.passage_uid IN (
                        SELECT DISTINCT p.passage_uid FROM postings p JOIN tokens t ON t.token_id=p.token_id WHERE t.token IN (`+ph+`) LIMIT ?)
                        ORDER BY s.work_uid, s.document_uid, s.block_start`, append([]any{releaseUID}, append(toStrs(toks), e.candCap)...)...)
	} else {
		// پیش‌فیلتر «همهٔ واژه‌ها باید در passage باشند»: شمار مقایسه‌ای =
		// شمار واژه‌های متمایزِ پرس‌وجو (نه توکن‌ها با تکرار) — وگرنه هر عبارت
		// دارای واژهٔ تکراری (مثل «الرسول ما الرسول») بی‌کاندید می‌ماند.
		uniq := dedupStrings(toks)
		ph := placeholders(len(uniq))
		candLimited = true
		rows, err = db.Query(`SELECT s.`+sCols+` FROM passages s WHERE s.release_uid=? AND s.passage_uid IN (
                        SELECT p.passage_uid FROM postings p JOIN tokens t ON t.token_id=p.token_id WHERE t.token IN (`+ph+`)
                        GROUP BY p.passage_uid HAVING COUNT(DISTINCT t.token)=? LIMIT ?)
                        ORDER BY s.work_uid, s.document_uid, s.block_start`, append([]any{releaseUID}, append(toStrs(uniq), len(uniq), e.candCap)...)...)
	}
	if err != nil {
		return nil, runState{}, err
	}
	defer rows.Close()
	var out []Result
	seen := map[string]bool{}
	rowN := 0
	vs := &verifyStats{}
	for rows.Next() {
		rowN++
		if ctx.Err() != nil {
			return out, runState{}, ctx.Err()
		}
		var r candRow
		if err := scanCandO(rows, &r, ov); err != nil {
			// حذف خاموش ممنوع: خطای اسکن = کاندید نادیده = نتیجهٔ ناقص بی‌اعلام.
			// طبق فلسفهٔ خطای §۳۹، این وضعیت باید صریحاً خطا باشد.
			return nil, runState{}, fmt.Errorf("scan candidate: %w", err)
		}
		// فیلتر دامنهٔ اثر/سند/زبان در verifier هم اعمال می‌شود (دفاع در عمق)
		if !scopeAllows(req, &r, e.catalog) {
			continue
		}
		if !citationAllows(req, &r) {
			continue // استناد باید واقعاً در همین passage باشد، نه فقط در سند
		}
		hits, matchType := verifyInText(req, &r, vs)
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
			if len(req.Scope.Roles) > 0 && !matchInsideRoles(r.RoleRanges, h.Range, req.Scope.Roles...) {
				continue // فیلتر نقش: محل واقعی تطبیق باید داخل نقش باشد (§۴۵)
			}
			out = append(out, e.toResult(&r, h, matchType))
			if len(out) >= cap {
				// سقف کل نتایج فعال شد (ب-۵): جمع‌آوری متوقف؛ صادقانه lower_bound اعلام می‌شود.
				e.statCands.Store(int64(rowN))
				return out, runState{capped: true, hitTruncated: vs.truncatedPassages > 0}, nil
			}
		}
	}
	e.statCands.Store(int64(rowN))
	// SEARCH-01: رسیدن شمار کاندیدها به سقف زیرکوئری = احتمال برش خاموش؛
	// پاسخ دیگر «کامل/دقیق» اعلام نمی‌شود (partial + lower_bound در buildResponse).
	return out, runState{candSaturated: candLimited && rowN >= e.candCap, hitTruncated: vs.truncatedPassages > 0}, nil
}

// sampleTrigrams نمونهٔ پخش‌شده از سه‌گانه‌ها برای پرس‌وجوی پیش‌فیلتر —
// زیرمجموعه از سه‌گانه‌های عبارت است، پس صدا حفظ می‌شود (ابر‌مجموعهٔ کاندید).

// verifyInText تطبیق هر mode با قاعدهٔ مالکیت overlap (SEARCH-02):
// در modeهای غیرعبارتی، رخدادِ داخل ناحیهٔ هم‌پوشانی tail تکرارِ متنِ passage
// قبلی است (مالک آن passage قبل است) و حذف می‌شود تا covering-hit و شمارش‌ها
// duplicate نسازند. modeهای عبارتی tail را نگه می‌دارند (هدف: پوشش مرز) —
// کلید مطلق dedupe تکرار واقعی را جمع می‌کند.
func verifyInText(req *Request, r *candRow, vs *verifyStats) ([]hit, string) {
	hits, mt := verifyInTextRaw(req, r, vs)
	if r.OverlapRunes > 0 {
		switch req.Mode {
		case AllWords, AnyWords, Near, Linguistic:
			bodyStart := r.OverlapRunes + 1
			kept := hits[:0:0]
			for _, h := range hits {
				if h.Range[0] >= bodyStart {
					kept = append(kept, h)
				}
			}
			hits = kept
		}
	}
	return hits, mt
}

func sampleTrigrams(tris []string, k int) []string {
	if len(tris) <= k {
		return tris
	}
	step := (len(tris) + k - 1) / k
	var out []string
	for i := 0; i < len(tris) && len(out) < k; i += step {
		out = append(out, tris[i])
	}
	return out
}

// faNum نمایش عدد با ارقام فارسی برای پیام‌های کاربر.
func faNum(n int) string {
	fd := []rune("۰۱۲۳۴۵۶۷۸۹")
	s := strconv.Itoa(n)
	out := make([]rune, 0, len(s))
	for _, c := range s {
		if c >= '0' && c <= '9' {
			out = append(out, fd[c-'0'])
		} else {
			out = append(out, c)
		}
	}
	return string(out)
}

type hit struct {
	Range [2]int // بازهٔ متن اصلی (code point)
}

// verifyInTextRaw بدنهٔ تطبیق هر mode (بدون آگاهی از overlap).
// vs سقف‌های مواضعِ هر قطعه را می‌شمارد تا پاسخ صادقانه lower_bound اعلام شود.
func verifyInTextRaw(req *Request, r *candRow, vs *verifyStats) ([]hit, string) {
	if req.IgnoreSpacing {
		return spacingHits(req, r, vs), "normalized"
	}
	orig := []rune(r.TextOriginal)
	switch req.Mode {
	case StrictPhrase:
		q := []rune(strings.TrimSpace(req.Query))
		var out []hit
		start := 0
		for {
			idx := indexRunes(orig[start:], q)
			if idx < 0 {
				break
			}
			s := start + idx
			e := s + len(q)
			if norm.WordBoundaryRunes(orig, s, e) {
				out = append(out, hit{Range: [2]int{s, e}})
			}
			start = s + 1
			if len(out) >= 50 {
				vs.truncatedPassages++ // رسیدن به سقف مواضع قطعه — شمارش حداقل است (ممیزی)
				break
			}
		}
		return out, "exact"
	default:
		// متن N1 و نگاشتش فقط در این شاخه لازم‌اند (strict فقط متن اصلی را می‌خواند)
		n1 := []rune(r.TextN1)
		var n1Map []int
		_ = json.Unmarshal([]byte(r.N1Map), &n1Map)
		qN, _ := norm.Normalize(req.Query)
		qN = strings.TrimSpace(qN)
		if req.Mode == Linguistic {
			qTokens := norm.TokenizeAligned(req.Query)
			if len(qTokens) > 0 {
				docTokens := norm.TokenizeAligned(r.TextOriginal)
				m := len(qTokens)
				var out []hit
				for i := 0; i+m <= len(docTokens); i++ {
					match := true
					for j := 0; j < m; j++ {
						if docTokens[i+j].N2 != qTokens[j].N2 {
							match = false
							break
						}
					}
					if match {
						s := docTokens[i].Start
						e := docTokens[i+m-1].End
						out = append(out, hit{Range: [2]int{s, e}})
						if len(out) >= 50 {
							vs.truncatedPassages++
							break
						}
					}
				}
				if len(out) > 0 {
					return out, "linguistic"
				}

				// اگر تطبیق مستقیم نیافت، گونه‌های پیوسته و گسستهٔ فارسی بررسی شوند (§۱۶)
				qN2Words := make([]string, len(qTokens))
				for qi, tk := range qTokens {
					qN2Words[qi] = tk.N2
				}
				variants := norm.GeneratePersianVariants(qN2Words)
				if len(variants) > 1 {
					for _, v := range variants[1:] {
						vm := len(v)
						for i := 0; i+vm <= len(docTokens); i++ {
							match := true
							for j := 0; j < vm; j++ {
								if docTokens[i+j].N2 != v[j] {
									match = false
									break
								}
							}
							if match {
								s := docTokens[i].Start
								e := docTokens[i+vm-1].End
								out = append(out, hit{Range: [2]int{s, e}})
								if len(out) >= 50 {
									vs.truncatedPassages++
									break
								}
							}
						}
						if len(out) > 0 {
							return out, "L3 (تفاوت پیوستگی)"
						}
					}
				}
				return out, "linguistic"
			}
		}
		if req.Mode == AllWords || req.Mode == Near || req.Mode == AnyWords {
			toks := norm.Tokenize(qN)
			positions := make([][]int, len(toks))
			for i, t := range toks {
				positions[i] = findAllWord(n1, t)
			}
			// SEARCH-02/مالکیت overlap: رخدادهای ناحیهٔ tail تکرارِ متنِ passage قبلی‌اند؛
			// پوشاننده/ترکیب فقط از رخدادهای بدنه ساخته می‌شود تا شمارش duplicate نشود.
			// modeهای عبارتی tail را نگه می‌دارند (پوشش مرز) و کلید مطلق dedupe جمع می‌کند.
			if r.OverlapRunes > 0 {
				if bs := n1BodyStart(n1Map, r.OverlapRunes+1); bs > 0 {
					for i, ps := range positions {
						var kept []int
						for _, p := range ps {
							if p >= bs {
								kept = append(kept, p)
							}
						}
						positions[i] = kept
					}
				}
			}
			var out []hit
			// any_words: هر رخداد هر واژه یک موضع است (پیش‌تر به مسیر عبارتی می‌افتاد و
			// پرسش چندواژه‌ای فقط وقتی تطبیق می‌خورد که کل عبارت پشت‌سرهم بیاید).
			if req.Mode == AnyWords {
				type occ struct{ s, e int }
				var occs []occ
				for i, ps := range positions {
					for _, p := range ps {
						occs = append(occs, occ{p, p + len([]rune(toks[i]))})
					}
				}
				sort.Slice(occs, func(a, b int) bool { return occs[a].s < occs[b].s })
				for _, o := range occs {
					out = append(out, mapN1Hit([2]int{o.s, o.e}, n1Map))
					if len(out) >= 50 {
						vs.truncatedPassages++
						break
					}
				}
				return out, "normalized"
			}
			if req.Mode == Near && req.Near != nil && req.Near.Slop > 0 {
				wins, more := nearWindows(positions, req.Near.Slop, req.Near.Ordered, len(n1))
				for _, rng := range wins {
					out = append(out, mapN1Hit(rng, n1Map))
				}
				if more {
					vs.truncatedPassages++ // پنجره‌های near بیش از سقف هر قطعه — شمارش حداقل است
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
			if norm.WordBoundaryRunes(n1, s, e) {
				out = append(out, mapN1Hit([2]int{s, e}, n1Map))
			}
			start = s + 1
			if len(out) >= 50 {
				vs.truncatedPassages++ // رسیدن به سقف مواضع قطعه — شمارش حداقل است (ممیزی)
				break
			}
		}
		if len(out) > 0 {
			if req.Mode == Linguistic {
				return out, "linguistic"
			}
			return out, "normalized"
		}

		// بررسی گونه‌های فارسی برای عبارت نرمال‌شده (§۱۶/§۲۰)
		qWords := norm.Tokenize(qN)
		if len(qWords) > 0 {
			variants := norm.GeneratePersianVariants(qWords)
			if len(variants) > 1 {
				for _, v := range variants[1:] {
					vStr := strings.Join(v, " ")
					vRunes := []rune(vStr)
					vStart := 0
					for {
						idx := indexRunes(n1[vStart:], vRunes)
						if idx < 0 {
							break
						}
						s := vStart + idx
						e := s + len(vRunes)
						if norm.WordBoundaryRunes(n1, s, e) {
							out = append(out, mapN1Hit([2]int{s, e}, n1Map))
						}
						vStart = s + 1
						if len(out) >= 50 {
							vs.truncatedPassages++
							break
						}
					}
					if len(out) > 0 {
						return out, "L3 (تفاوت پیوستگی)"
					}
				}
			}
		}

		if req.Mode == Linguistic {
			return out, "linguistic"
		}
		return out, "normalized"
	}
}

// n1BodyStart نخستین ایندکس n1 که به متن اصلیِ >= bodyStart می‌رسد (n1Map صعودی است).
func n1BodyStart(n1Map []int, bodyStart int) int {
	if len(n1Map) == 0 {
		return bodyStart // بدون map، مختصات n1==اصل فرض می‌شود
	}
	for i, o := range n1Map {
		if o >= bodyStart {
			return i
		}
	}
	return len(n1Map)
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
		if norm.WordBoundaryRunes(s, p, p+len(rs)) {
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

// nearWindows یافتن پنجره‌های near با الگوریتم کران‌دار — جایگزین شمارش دکارتیِ
// موقعیت‌ها (ممیزی: near بی‌کران). معناشناسی حفظ شده: پنجرهٔ معتبر همهٔ واژه‌ها را
// دارد و (بیشینه−کمینهٔ مواضع) ≤ slop*6 (slop×6 قرارداد مستند این سرویس است)؛
// در ordered مواضع به‌ترتیب توکن‌ها نزول‌نپذیرند. خروجی حداکثر nearCap پنجره به‌همراه
// پرچمِ «پنجرهٔ معتبر بیشتری از سقف وجود داشت» برای اعلام صادقانهٔ برش.
// هزینه: ordered ‏O(|P0|·k·logN)‎ و unordered ‏O(N·k)‎ — دیگر تابع ضرب دکارتی نیست.
func nearWindows(positions [][]int, slop int, ordered bool, textLen int) ([][2]int, bool) {
	const nearCap = 10
	if len(positions) == 0 || !allPresent(positions) {
		return nil, false
	}
	lim := slop * 6
	out := make([][2]int, 0, nearCap)
	endPad := len(positions[len(positions)-1])
	if ordered && len(positions) > 1 {
		// زنجیرهٔ حریصانه از هر رخداد واژهٔ نخست: نخستین موضعِ مجاز هر واژهٔ بعدی با
		// جست‌وجوی دودویی — کم‌ترین پایان زنجیره تضمین می‌شود؛ پس اگر برای لنگرِ داده‌شده
		// پنجرهٔ معتبری وجود داشته باشد همین الگوریتم آن را می‌یابد (کامل/sound).
		for _, p0 := range positions[0] {
			cur := p0
			ok := true
			for i := 1; i < len(positions); i++ {
				j := sort.SearchInts(positions[i], cur)
				if j >= len(positions[i]) {
					ok = false
					break
				}
				cur = positions[i][j]
				if cur-p0 > lim {
					ok = false
					break
				}
			}
			if ok {
				if len(out) >= nearCap {
					return out, true // پنجرهٔ معتبر بیشتری هم بود — صادقانه اعلام می‌شود
				}
				out = append(out, [2]int{p0, clampInt(cur+endPad, 0, textLen)})
			}
		}
		return out, false
	}
	// unordered: پنجرهٔ لغزان روی رخدادهای ادغام‌شده — برای هر لنگر، کم‌ترین پنجرهٔ
	// کامل‌کننده ثبت می‌شود؛ هر پنجرهٔ معتبرِ ممکن با لنگرِ کمینهٔ خود زیرمجموعهٔ
	// همین فهرست است، پس هیچ تطبیقی از دست نمی‌رود.
	type ev struct {
		pos, tok int
	}
	var evs []ev
	total := 0
	for i, ps := range positions {
		total += len(ps)
		for _, p := range ps {
			evs = append(evs, ev{p, i})
		}
	}
	sort.Slice(evs, func(a, b int) bool { return evs[a].pos < evs[b].pos })
	count := make([]int, len(positions))
	missing := len(positions)
	hi := 0
	for lo := 0; lo < len(evs); lo++ {
		if lo > 0 {
			count[evs[lo-1].tok]--
			if count[evs[lo-1].tok] == 0 {
				missing++
			}
		}
		if missing > 0 {
			for hi < total && missing > 0 {
				count[evs[hi].tok]++
				if count[evs[hi].tok] == 1 {
					missing--
				}
				hi++
			}
			if missing > 0 {
				break // هیچ پنجرهٔ کامل دیگری از این لنگر به بعد نیست
			}
		}
		if evs[hi-1].pos-evs[lo].pos <= lim {
			if len(out) >= nearCap {
				return out, true
			}
			out = append(out, [2]int{evs[lo].pos, clampInt(evs[hi-1].pos+endPad, 0, textLen)})
		}
	}
	return out, false
}

type roleRangeT struct {
	Role  string `json:"role"`
	Start int    `json:"start"`
	End   int    `json:"end"`
}

// scopeAllows فیلتر دامنهٔ اثر/سند/زبان/مؤلف روی هر کاندید (دفاع در عمق — هر دو موتور).
func scopeAllows(req *Request, r *candRow, cat MetaSource) bool {
	if req.Scope.Target == "work" && (req.Scope.WorkUID == nil || r.WorkUID != *req.Scope.WorkUID) {
		return false
	}
	if req.Scope.Author != nil && *req.Scope.Author != "" && cat != nil {
		authorFold := norm.Fold(*req.Scope.Author)
		_, _, author, ok := cat.WorkTitle(r.WorkUID)
		if !ok || !strings.Contains(norm.Fold(author), authorFold) {
			return false
		}
	}
	if len(req.Scope.DocumentUIDs) > 0 {
		inScope := false
		for _, d := range req.Scope.DocumentUIDs {
			if d == r.DocumentUID {
				inScope = true
				break
			}
		}
		if !inScope {
			return false
		}
	}
	if req.Scope.Language != nil && *req.Scope.Language != "" && r.Language != *req.Scope.Language {
		return false
	}
	return true
}

// citationAllows فیلتر استناد قرآنی (QUR-03) روی خود passage — مشترک میان دو موتور.
func citationAllows(req *Request, r *candRow) bool {
	if req.Scope.Quran == nil {
		return true
	}
	cits, err := parseCitations(r.Citations.String)
	if err != nil {
		return false
	}
	for _, c := range cits {
		if c.Sure != req.Scope.Quran.Sure {
			continue
		}
		if req.Scope.Quran.Aya == "" {
			return true
		}
		if c.Aya != "" && ayaEq(c.Aya, req.Scope.Quran.Aya) {
			return true
		}
		if c.AyaFrom != "" && c.AyaTo != "" && between(c.AyaFrom, c.AyaTo, req.Scope.Quran.Aya) {
			return true
		}
	}
	return false
}

// groupVerified گروه‌بندی «کتاب‌های دارای تطبیق تأییدشده» — مشترک میان دو موتور.
func groupVerified(catalog MetaSource, verified []Result) []BookGroup {
	workOrder := []string{}
	groups := map[string]*BookGroup{}
	docOrder := map[string][]string{}
	docs := map[string]*DocEvidence{}
	for _, r := range verified {
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
	return out
}

// fetchCandRows واکشی ردیف‌های کامل کاندید از نمایهٔ محلی بر اساس passage_uid
// (منبع متن واحد است — OpenSearch فقط نشانی می‌دهد)؛ ترتیب خروجی = ترتیب ورودی.
func fetchCandRows(db *sql.DB, releaseUID string, hits []osHit, withOverlap bool) ([]candRow, error) {
	uids := make([]string, 0, len(hits))
	for _, h := range hits {
		if u := str(h.Source["passage_uid"]); u != "" {
			uids = append(uids, u)
		}
	}
	if len(uids) == 0 {
		return nil, nil
	}
	q := `SELECT ` + candSelect(withOverlap) + ` FROM passages WHERE release_uid=? AND passage_uid IN (` + placeholders(len(uids)) + `)`
	args := make([]any, 0, len(uids)+1)
	args = append(args, releaseUID)
	for _, u := range uids {
		args = append(args, u)
	}
	rows, err := db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	byUID := map[string]*candRow{}
	for rows.Next() {
		var r candRow
		if err := scanCandO(rows, &r, withOverlap); err != nil {
			return nil, fmt.Errorf("scan candidate: %w", err)
		}
		byUID[r.PassageUID] = &r
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]candRow, 0, len(uids))
	for _, u := range uids {
		if r, ok := byUID[u]; ok {
			out = append(out, *r)
		}
		// uid بدون ردیف: کاندید منقضی/خارج از release — عمداً نادیده؛
		// verifier شمارش واقعی را تضمین می‌کند و _source حداقلی متن را از همین‌جا می‌گیرد
	}
	return out, nil
}
func matchInsideRoles(roleRangesJSON string, rng [2]int, reqRoles ...string) bool {
	if roleRangesJSON == "" || roleRangesJSON == "[]" {
		return false
	}
	var rr []roleRangeT
	if err := json.Unmarshal([]byte(roleRangesJSON), &rr); err != nil {
		return false
	}
	for _, r := range rr {
		if r.Start < rng[1] && r.End > rng[0] {
			if len(reqRoles) == 0 {
				return true
			}
			for _, reqRole := range reqRoles {
				switch reqRole {
				case "ayah", "ayah_text", "ayah_quote":
					if r.Role == "ayah" || r.Role == "ayah_text" || r.Role == "ayah_quote" {
						return true
					}
				case "sanad", "sanadHadith":
					if r.Role == "sanad" || r.Role == "sanadHadith" {
						return true
					}
				case "hadith", "hadith_body", "G":
					if r.Role == "hadith" || r.Role == "hadith_body" || r.Role == "G" {
						return true
					}
				case "b", "B", "sharh":
					if r.Role == "b" || r.Role == "B" || r.Role == "sharh" {
						return true
					}
				default:
					if strings.EqualFold(r.Role, reqRole) {
						return true
					}
				}
			}
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
	sub, lo := runeSpan(r.TextOriginal, h.Range[0]-60, h.Range[1]+60)
	hl := Range{Start: h.Range[0] - lo, End: h.Range[1] - lo, Unit: "codepoint"}
	var fullText string
	if (r.LocalHadith.Valid && r.LocalHadith.String != "") || r.LocalHadith.String != "" {
		fullText = r.TextOriginal
	} else {
		for _, ro := range roles {
			if ro == "hadith" || ro == "B" || ro == "b" {
				fullText = r.TextOriginal
				break
			}
		}
	}
	return Result{
		PassageUID: r.PassageUID, MatchType: matchType,
		Work: work, Document: doc,
		Page:    Ref{UID: r.PageUID, Label: orDefault(r.PageLabel.String, "—")},
		Section: sec,
		Snippet: sub, Highlight: []Range{hl},
		Roles: roles, LocalHadith: r.LocalHadith.String,
		RevayatIndex: r.RevayatIndex.String,
		Fingerprint:  r.Fingerprint.String,
		SourceRange:  [2]int{r.SourceStart, r.SourceEnd},
		MatchRange:   [2]int{r.SourceStart + h.Range[0], r.SourceStart + h.Range[1]},
		Citations:    json.RawMessage(r.Citations.String),
		FullText:     fullText,
	}
}

// runeSpan برش code point [lo, hi) از s (هر دو به [0, طول] بریده می‌شوند) بدون تبدیل کل
// passage به []rune — هم‌ارز string([]rune(s)[lo:hi]) و lo بریده‌شده. پیش‌تر هر نتیجه کل
// متن passage را به rune تبدیل می‌کرد و برای واژهٔ پرتکرار گلوگاه اصلی پاسخ بود.
func runeSpan(s string, lo, hi int) (string, int) {
	if lo < 0 {
		lo = 0
	}
	if hi < lo {
		hi = lo
	}
	i, cp := 0, 0
	bLo, bHi := -1, -1
	for {
		if cp == lo && bLo < 0 {
			bLo = i
		}
		if cp == hi {
			bHi = i
			break
		}
		if i >= len(s) {
			break
		}
		_, sz := utf8.DecodeRuneInString(s[i:])
		i += sz
		cp++
	}
	if bLo < 0 {
		bLo, lo = i, cp
	}
	if bHi < 0 {
		bHi = i
	}
	sub := s[bLo:bHi]
	if !utf8.ValidString(sub) {
		sub = string([]rune(sub)) // همان جایگزینی U+FFFD تبدیل []rune
	}
	return sub, lo
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

// between بررسی تعلق آیهٔ پرس‌شده به بازهٔ استناد با مقایسهٔ عددی (SEARCH-03/E3 —
// مقایسهٔ لغوی رشته‌ای «9»<="10" غلط می‌داد و کل بازه‌های دارای تغییر طول رقم می‌شکست).
func between(from, to, aya string) bool {
	f, ok1 := ayaNum(from)
	t, ok2 := ayaNum(to)
	a, ok3 := ayaNum(aya)
	if !ok1 || !ok2 || !ok3 {
		return false
	}
	return a >= f && a <= t
}

// ayaEq تطبیق تک‌آیه با مقایسهٔ عددی ارقام (E3b: آیهٔ ۲۵۵ با ارقام عربی/فارسی باید
// با استناد ذخیره‌شدهٔ لاتین برابر باشد — مقایسهٔ رشتهٔ خام false negative می‌داد).
func ayaEq(a, b string) bool {
	x, ok1 := ayaNum(a)
	y, ok2 := ayaNum(b)
	return ok1 && ok2 && x == y
}

// ayaNum ارقام فارسی/عربی/لاتین را به عدد می‌برد؛ خالی/نامعتبر = ناموفق (هرگز صفر پیش‌فرض).
func ayaNum(s string) (int, bool) {
	n := numNorm(s)
	if n == "" {
		return 0, false
	}
	v, err := strconv.Atoi(n)
	if err != nil || v <= 0 {
		return 0, false
	}
	return v, true
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
