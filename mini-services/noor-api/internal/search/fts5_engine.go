// Package search — موتور FTS5 چندستونه، موازی روی شاردهای یک نسل pin‌شده، با لایه‌های
// L1 تا L5، Verifier روی متن واقعی و Aligner شباهت (§۲۰ تا §۲۴، §۲۶).
//
// تفاوت‌های اساسی با نسخهٔ پیشین (رفع یافته‌های ممیزی):
//   - کاندیدها با عبارت MATCH دقیق هر mode و بدون «OR همهٔ واژه‌ها + سقف ۵۰۰۰ + ORDER BY rowid»
//     واکشی می‌شوند؛ تنها سقف، سقف صریح کل نتایج است (lower_bound).
//   - نمایهٔ بازکاربرد با موضع (pos) و مختصات جریان خوانده می‌شود؛ سقف‌ها اعلام می‌شوند.
//   - Continue و BooksGrouped همین موتور و همین نسل را اجرا می‌کنند (نه LocalEngine).
//   - نسل از fts/ACTIVE خوانده و با manifest اعتبارسنجی می‌شود؛ تعویض نسل بدون قطع درخواست‌ها.
//   - خطای هر شارد کل پاسخ را خطا می‌کند (نه «۰ نتیجه، کامل»).
package search

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
	"noor/internal/index"
	"noor/internal/norm"
)

// FTS5Engine موتور جست‌وجوی بومی مبتنی بر FTS5 و شاردهای SQLite.
type FTS5Engine struct {
	base    *LocalEngine
	dataDir string // خالی = نسل pin‌شده (بدون بارگذاری مجدد)

	mu        sync.Mutex
	cur       *ftsRelease
	prev      *ftsRelease
	lastCheck time.Time

	cache *resultCache
	// L4Budget سقف زمانی مرحلهٔ L4 در مسیر تعاملی؛ پس از آن پوشش partial اعلام می‌شود.
	L4Budget time.Duration
}

const ftsSessionPrefix = "fts:"

// OpenFTS5FromDir نسل فعال را از <dataDir>/fts/ACTIVE باز می‌کند و تعویض نسل را دنبال می‌کند.
// برای سازگاری: اگر fts/ACTIVE نبود و دقیقاً یک پایگاه اصلی نسل (library_index_<rel>.sqlite)
// مستقیم در dataDir بود، همان نسل pin می‌شود؛ بیش از یکی = خطا (اختلاط نسل‌ها ممنوع).
func OpenFTS5FromDir(base *LocalEngine, dataDir string) (*FTS5Engine, error) {
	rel, err := index.ActiveFTSRelease(dataDir)
	if err == nil {
		r, err := openFTSRelease(index.FTSReleaseDir(dataDir, rel), rel)
		if err != nil {
			return nil, err
		}
		e := newFTS5(base, dataDir, r)
		return e, nil
	}
	if !errors.Is(err, index.ErrNoActiveFTS) {
		return nil, err
	}
	matches, _ := filepath.Glob(filepath.Join(dataDir, "library_index_*.sqlite"))
	var mains []string
	for _, m := range matches {
		if !strings.Contains(filepath.Base(m), "_shard") {
			mains = append(mains, m)
		}
	}
	if len(mains) != 1 {
		return nil, fmt.Errorf("fts5 engine: %v؛ و در %s %d پایگاه اصلی نسل یافت شد (باید دقیقاً یکی باشد یا نسل با worker/buildfts -publish منتشر شود)", index.ErrNoActiveFTS, dataDir, len(mains))
	}
	relUID := strings.TrimSuffix(strings.TrimPrefix(filepath.Base(mains[0]), "library_index_"), ".sqlite")
	return OpenFTS5Release(base, dataDir, relUID)
}

// OpenFTS5Release یک نسل مشخص را از پوشهٔ مشخص باز و pin می‌کند (آزمون، ابزارها).
func OpenFTS5Release(base *LocalEngine, dir, rel string) (*FTS5Engine, error) {
	r, err := openFTSRelease(dir, rel)
	if err != nil {
		return nil, err
	}
	return newFTS5(base, "", r), nil
}

func newFTS5(base *LocalEngine, dataDir string, r *ftsRelease) *FTS5Engine {
	e := &FTS5Engine{base: base, dataDir: dataDir, cur: r, lastCheck: time.Now(), cache: newResultCache(64), L4Budget: 20 * time.Second}
	go r.warmUp(context.Background())
	return e
}

// ActiveRelease شناسهٔ نسل FTS5 در حال سرویس.
// SetL4Budget بودجهٔ زمانی L4 را تنظیم می‌کند — باید زیر تایم‌اوت HTTP باشد تا
// L4 سنگین عملاً به بودجهٔ خودش برسد (main از cfg.SearchTimeout مشتق می‌کند).
func (e *FTS5Engine) SetL4Budget(d time.Duration) {
	if d > 0 {
		e.L4Budget = d
	}
}

func (e *FTS5Engine) ActiveRelease() string {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.cur == nil {
		return ""
	}
	return e.cur.uid
}

func (e *FTS5Engine) PassagesCount() int {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.cur == nil {
		return 0
	}
	return e.cur.passages
}

// Close بستن همهٔ نسل‌ها و موتور پایه.
func (e *FTS5Engine) Close() error {
	e.mu.Lock()
	cur, prev := e.cur, e.prev
	e.cur, e.prev = nil, nil
	e.mu.Unlock()
	if cur != nil {
		cur.retire()
	}
	if prev != nil {
		prev.retire()
	}
	if e.base != nil {
		_ = e.base.Close()
	}
	return nil
}

// maybeReload هر ۲ ثانیه fts/ACTIVE را بررسی و در صورت تغییر نسل تازه را باز می‌کند.
func (e *FTS5Engine) maybeReload() {
	if e.dataDir == "" {
		return
	}
	e.mu.Lock()
	if time.Since(e.lastCheck) < 2*time.Second {
		e.mu.Unlock()
		return
	}
	e.lastCheck = time.Now()
	curUID := ""
	if e.cur != nil {
		curUID = e.cur.uid
	}
	e.mu.Unlock()
	rel, err := index.ActiveFTSRelease(e.dataDir)
	if err != nil || rel == curUID {
		return
	}
	r, err := openFTSRelease(index.FTSReleaseDir(e.dataDir, rel), rel)
	if err != nil {
		log.Printf("fts5: نسل تازهٔ %s باز نشد؛ نسل %s همچنان سرویس می‌دهد: %v", rel, curUID, err)
		return
	}
	go r.warmUp(context.Background())
	e.mu.Lock()
	old := e.prev
	e.prev = e.cur
	e.cur = r
	e.mu.Unlock()
	if old != nil {
		old.retire()
	}
	log.Printf("fts5: نسل %s فعال شد (پیشین: %s)", rel, curUID)
}

// acquireCurrent نسل جاری را با ارجاع برمی‌گرداند.
func (e *FTS5Engine) acquireCurrent() (*ftsRelease, error) {
	e.maybeReload()
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.cur == nil {
		return nil, errors.New("fts5 engine: نمایهٔ جست‌وجو در دسترس نیست")
	}
	e.cur.refs.Add(1)
	return e.cur, nil
}

// acquireRelease نسل نشست را برمی‌گرداند (جاری، پیشین یا باز کردن از دیسک)؛ نبودن = 410.
func (e *FTS5Engine) acquireRelease(uid string) (*ftsRelease, error) {
	e.mu.Lock()
	for _, r := range []*ftsRelease{e.cur, e.prev} {
		if r != nil && r.uid == uid {
			r.refs.Add(1)
			e.mu.Unlock()
			return r, nil
		}
	}
	e.mu.Unlock()
	if e.dataDir != "" {
		dir := index.FTSReleaseDir(e.dataDir, uid)
		if _, err := os.Stat(dir); err == nil {
			r, err := openFTSRelease(dir, uid)
			if err == nil {
				e.mu.Lock()
				old := e.prev
				e.prev = r
				r.refs.Add(1)
				e.mu.Unlock()
				if old != nil {
					old.retire()
				}
				return r, nil
			}
		}
	}
	return nil, &GoneError{Message: "نسل نمایهٔ این جست‌وجو دیگر در دسترس نیست؛ دوباره اجرا کنید."}
}

// SearchTitles جست‌وجوی عناوین کتب.
func (e *FTS5Engine) SearchTitles(ctx context.Context, query string, limit int) ([]TitleHit, error) {
	if e.base != nil {
		return e.base.SearchTitles(ctx, query, limit)
	}
	return nil, nil
}

// SearchAuthors جست‌وجوی نام پدیدآور / مؤلف.
func (e *FTS5Engine) SearchAuthors(ctx context.Context, query string, limit int) ([]TitleHit, error) {
	if e.base != nil {
		return e.base.SearchAuthors(ctx, query, limit)
	}
	return nil, nil
}

// routesToBase پرس‌وجوهای بدون واژه (استناد صرف قرآنی/پرسش تهی) و جست‌وجوی عنوان با
// موتور پایه اجرا می‌شوند (همان نسل در index.sqlite).
func routesToBase(req *Request) bool {
	// عناوین، پدیدآور و فیلتر استناد قرآنی/ارجاع‌ها از جدول citations پایگاه index.sqlite سرویس می‌شوند
	if req.Scope.Target == "titles" || req.Scope.Target == "authors" || req.Scope.Target == "citations" || req.Scope.Quran != nil {
		return true
	}
	return len(norm.TokenizeAligned(req.Query)) == 0
}

// wrapFTSErr خطاهای زیرساختی موتور را با پیشوند پایدار «fts5 engine:» علامت می‌زند تا لایهٔ
// HTTP آن‌ها را ۵۰۳ (قابل‌تلاش) گزارش کند نه «پرس‌وجوی نامعتبر»؛ Gone و لغو کلاینت دست‌نخورده‌اند.
func wrapFTSErr(err error) error {
	if err == nil {
		return nil
	}
	var g *GoneError
	if errors.As(err, &g) || errors.Is(err, context.Canceled) || strings.HasPrefix(err.Error(), "fts5 engine:") {
		return err
	}
	return fmt.Errorf("fts5 engine: %w", err)
}

// Search اجرای درخواست جست‌وجو.
func (e *FTS5Engine) Search(ctx context.Context, req *Request, releaseUID string) (*Response, error) {
	if req == nil {
		return nil, errors.New("request is nil")
	}
	if err := validateRequest(req); err != nil {
		return nil, err
	}
	if routesToBase(req) {
		return e.base.Search(ctx, req, releaseUID)
	}
	t0 := time.Now()
	rel, err := e.acquireCurrent()
	if err != nil {
		return nil, err
	}
	defer rel.releaseRef()
	out, err := e.executeCached(ctx, rel, req)
	if err != nil {
		return nil, wrapFTSErr(err)
	}
	sid := newID("s")
	if err := e.base.saveSession(sid, ftsSessionPrefix+rel.uid, req); err != nil {
		return nil, err
	}
	resp := e.buildResponse(sid, rel, req, out, 0)
	resp.Notice = strings.TrimSpace(resp.Notice + fmt.Sprintf(" (موتور FTS5، نسل %s، %d میلی‌ثانیه)", rel.uid, time.Since(t0).Milliseconds()))
	return resp, nil
}

// Continue ادامهٔ صفحه‌بندی نشست با همان نسل pin‌شده (re-execute قطعی یا کش).
func (e *FTS5Engine) Continue(ctx context.Context, sessionUID, cursor, releaseUID string) (*Response, error) {
	if !verifyCursor(cursor, e.base.Secret) {
		return nil, &GoneError{Message: "نشانهٔ ادامهٔ جست‌وجو معتبر نیست؛ دوباره اجرا کنید."}
	}
	payload, ok := parseCursorPayload(cursor)
	if !ok || payload.S != sessionUID {
		return nil, &GoneError{Message: "نشانهٔ ادامهٔ جست‌وجو معتبر نیست؛ دوباره اجرا کنید."}
	}
	sessRel, req, err := e.base.loadSession(sessionUID)
	if err != nil {
		return nil, &GoneError{Message: "مهلت این جست‌وجو پایان یافته است؛ دوباره اجرا کنید."}
	}
	if !strings.HasPrefix(sessRel, ftsSessionPrefix) {
		return e.base.Continue(ctx, sessionUID, cursor, releaseUID)
	}
	rel, err := e.acquireRelease(strings.TrimPrefix(sessRel, ftsSessionPrefix))
	if err != nil {
		return nil, err
	}
	defer rel.releaseRef()
	out, err := e.executeCached(ctx, rel, req)
	if err != nil {
		return nil, wrapFTSErr(err)
	}
	return e.buildResponse(sessionUID, rel, req, out, payload.O), nil
}

// BooksGrouped «این عبارت در چه کتاب‌هایی آمده؟» — فقط وقوع‌های قطعی (L1–L3 و modeهای
// غیرلایه‌ای)، از همان نسل و همان اجرا.
func (e *FTS5Engine) BooksGrouped(ctx context.Context, sessionUID string) ([]BookGroup, error) {
	sessRel, req, err := e.base.loadSession(sessionUID)
	if err != nil {
		return nil, &GoneError{Message: "مهلت این جست‌وجو پایان یافته است؛ دوباره اجرا کنید."}
	}
	if !strings.HasPrefix(sessRel, ftsSessionPrefix) {
		return e.base.BooksGrouped(ctx, sessionUID)
	}
	rel, err := e.acquireRelease(strings.TrimPrefix(sessRel, ftsSessionPrefix))
	if err != nil {
		return nil, err
	}
	defer rel.releaseRef()
	out, err := e.executeCached(ctx, rel, req)
	if err != nil {
		return nil, wrapFTSErr(err)
	}
	var certain []Result
	for i := range out.items {
		if isCertain(out.items[i].hit.layer) {
			certain = append(certain, out.result(e, i))
		}
	}
	return groupResultsByBook(certain), nil
}

func isCertain(layer string) bool { return layer != "L4" && layer != "L5" }

func groupResultsByBook(verified []Result) []BookGroup {
	workOrder := []string{}
	groups := map[string]*BookGroup{}
	docOrder := map[string][]string{}
	docs := map[string]*DocEvidence{}
	for _, r := range verified {
		bg, ok := groups[r.Work.UID]
		if !ok {
			bg = &BookGroup{Work: r.Work, Documents: []DocEvidence{}}
			groups[r.Work.UID] = bg
			workOrder = append(workOrder, r.Work.UID)
		}
		key := r.Work.UID + "|" + r.Document.UID
		dg, ok := docs[key]
		if !ok {
			dg = &DocEvidence{Document: r.Document, Evidence: []Result{}}
			docs[key] = dg
			docOrder[r.Work.UID] = append(docOrder[r.Work.UID], r.Document.UID)
		}
		dg.VerifiedOccurrences++
		if len(dg.Evidence) < 3 {
			dg.Evidence = append(dg.Evidence, r)
		}
	}
	out := []BookGroup{}
	for _, w := range workOrder {
		bg := groups[w]
		for _, d := range docOrder[w] {
			bg.Documents = append(bg.Documents, *docs[w+"|"+d])
		}
		out = append(out, *bg)
	}
	return out
}

// ---------- اجرا ----------

// execOutcome خروجی کامل یک اجرا (قابل کش؛ هرگز تغییر داده نمی‌شود).
type execOutcome struct {
	// items همهٔ نتایج مرتب این اجرا به‌صورت سبک (ردیف + تطبیق). Result کامل (برش متن، نقش‌ها،
	// عنوان‌ها) فقط برای نتایجی ساخته می‌شود که واقعاً نمایش داده می‌شوند (result) — پیش‌تر
	// برای واژهٔ پرتکرار هر ۱۰٬۰۰۰ نتیجه پیش از برگرداندن صفحهٔ ۲۰تایی کامل ساخته می‌شد.
	items       []outItem
	matMu       sync.Mutex
	mat         []*Result
	capped      bool
	truncated   bool
	simPartial  bool
	simSkipped  bool // L4 خواسته شد ولی پرسش برای آن کوتاه بود
	layerCounts map[string]int
	notes       []string

	// شمارش‌های پاسخ یک بار برای هر اجرا محاسبه می‌شوند (نه در هر صفحه/Continue).
	statsOnce sync.Once
	stats     outcomeStats
	// نماهای فیلترشدهٔ لایه (result_layers) — اندیس‌ها روی results، یک بار برای هر فیلتر.
	viewMu sync.Mutex
	views  map[string][]int32
}

// outItem نتیجهٔ سبک: کپی فیلدهای ردیف (بدون واژه‌های واژه‌بندی‌شده و n1_map، تا کش نتایج
// حافظهٔ ردیف‌ها را نگه ندارد؛ برش snippet همیشه به text_original ارجاع داشت) و تطبیق.
type outItem struct {
	row *candRow
	hit rawHit
}

// result نتیجهٔ کامل اندیس i (یک بار ساخته و نگه داشته می‌شود؛ ایمن برای درخواست‌های هم‌زمان).
func (o *execOutcome) result(e *FTS5Engine, i int) Result {
	o.matMu.Lock()
	defer o.matMu.Unlock()
	if o.mat == nil {
		o.mat = make([]*Result, len(o.items))
	}
	if o.mat[i] == nil {
		r := e.rowToResult(o.items[i].row, o.items[i].hit)
		o.mat[i] = &r
	}
	return *o.mat[i]
}

type outcomeStats struct {
	certain, similar, books, passages, hadiths int
}

// statsFor شمارش‌های قطعی/مشابه کل اجرا (مستقل از فیلتر نمایش).
func (o *execOutcome) statsFor(e *FTS5Engine) outcomeStats {
	o.statsOnce.Do(func() {
		books, passages, hadiths := map[string]struct{}{}, map[string]struct{}{}, map[string]struct{}{}
		for i := range o.items {
			r, layer := o.items[i].row, o.items[i].hit.layer
			if !isCertain(layer) {
				o.stats.similar++
				continue
			}
			o.stats.certain++
			if w, _, ok := e.base.catalog.DocumentMeta(r.DocumentUID); ok {
				books[w] = struct{}{}
			} else {
				books[r.WorkUID] = struct{}{}
			}
			passages[r.PassageUID] = struct{}{}
			if r.LocalHadith.String != "" {
				hadiths[r.DocumentUID+"/"+r.LocalHadith.String] = struct{}{}
			}
		}
		o.stats.books, o.stats.passages, o.stats.hadiths = len(books), len(passages), len(hadiths)
	})
	return o.stats
}

// view اندیس نتایجِ لایه‌های خواسته‌شده؛ nil = بدون فیلتر.
func (o *execOutcome) view(layers []string) []int32 {
	set := layerSet(layers)
	if set == nil {
		return nil
	}
	key := strings.Join(sortedKeys(set), ",")
	o.viewMu.Lock()
	defer o.viewMu.Unlock()
	if v, ok := o.views[key]; ok {
		return v
	}
	v := make([]int32, 0, len(o.items)/2)
	for i := range o.items {
		if set[o.items[i].hit.layer] {
			v = append(v, int32(i))
		}
	}
	if o.views == nil {
		o.views = map[string][]int32{}
	}
	o.views[key] = v
	return v
}

func sortedKeys(m map[string]bool) []string {
	ks := make([]string, 0, len(m))
	for k := range m {
		ks = append(ks, k)
	}
	sort.Strings(ks)
	return ks
}

func requestKey(rel string, req *Request) string {
	c := *req
	c.PageSize = 0
	c.ResultLayers = nil // فیلتر نمایش روی همان اجرای کش‌شده اعمال می‌شود
	b, _ := json.Marshal(c)
	h := sha256.Sum256(append([]byte(rel+"|"), b...))
	return hex.EncodeToString(h[:])
}

func (e *FTS5Engine) executeCached(ctx context.Context, rel *ftsRelease, req *Request) (*execOutcome, error) {
	key := requestKey(rel.uid, req)
	if out, ok := e.cache.get(key); ok {
		return out, nil
	}
	out, err := e.execute(ctx, rel, req)
	if err != nil {
		return nil, err
	}
	e.cache.put(key, out)
	return out, nil
}

func (e *FTS5Engine) maxResults() int {
	if e.base != nil && e.base.maxResults > 0 {
		return e.base.maxResults
	}
	return defaultMaxResults
}

// wantLayers لایه‌های فعال درخواست.
func wantLayers(req *Request) map[string]bool {
	w := map[string]bool{}
	switch req.Mode {
	case Tiered, LongQuote, SimilarQuote:
		if len(req.Layers) == 0 {
			for _, l := range []string{"L1", "L2", "L3", "L4"} {
				w[l] = true
			}
		}
		for _, l := range req.Layers {
			w[l] = true
		}
		if req.NearSpelling {
			w["L5"] = true
		}
	case Linguistic:
		w["L1"], w["L2"], w["L3"] = true, true, true
	case NormalizedPhrase:
		w["L1"], w["L2"], w["L3"] = true, true, true
	case StrictPhrase:
		w["L1"] = true
	}
	return w
}

func (e *FTS5Engine) execute(ctx context.Context, rel *ftsRelease, req *Request) (*execOutcome, error) {
	q := parseFTSQuery(strings.TrimSpace(req.Query), req.Diacritics == "respect" || req.Diacritics == "respect_strict")
	q.diaStrict = req.Diacritics == "respect_strict"
	if len(q.toks) == 0 {
		return &execOutcome{layerCounts: map[string]int{}}, nil
	}
	switch req.Mode {
	case NormalizedPhrase:
		if req.IgnoreSpacing {
			break
		}
		// عبارت نرمال‌شده: فقط تفاوت‌های نوشتاری (پیوستگی و یای اضافه)، نه گسترش دعایی/صرفی
		if err := q.buildVariants(ctx, rel, map[string]bool{norm.KindSpacing: true, norm.KindEzafe: true}, false); err != nil {
			return nil, err
		}
	case Linguistic, Tiered, LongQuote, SimilarQuote:
		if err := q.buildVariants(ctx, rel, nil, req.ExpandMorphology); err != nil {
			return nil, err
		}
	}
	want := wantLayers(req)
	allow := e.newDocFilter(rel, req)
	capN := e.maxResults()
	minScore := req.MinScore
	if minScore == 0 {
		minScore = 0.70
	}
	layered := req.Mode == Tiered || req.Mode == LongQuote || req.Mode == SimilarQuote
	runExact := !layered || want["L1"] || want["L2"] || want["L3"]
	// L4 برای عبارت‌های ۳ واژه‌ای هم اجرا می‌شود؛ چون تضمین بازیابی §۲۲ برای
	// m < t(e+1)+2e برقرار نیست، پوشش این حالت صادقانه «partial» اعلام می‌شود.
	runL4 := layered && want["L4"] && len(q.toks) >= 3
	runL5 := layered && want["L5"] && len(q.toks) == 1 && !q.hasPfx

	var l5forms []string
	l5Truncated := false
	if runL5 {
		var err error
		l5forms, l5Truncated, err = nearForms(ctx, rel.main, q.n1[0], q.n2[0])
		if err != nil {
			return nil, err
		}
	}

	type shardOut struct {
		exact     []rawResult
		sim       []rawResult
		capped    bool
		truncated bool
		partial   bool
		err       error
	}
	outs := make([]shardOut, len(rel.shards))
	var wg sync.WaitGroup
	l4ctx, l4cancel := context.WithTimeout(ctx, e.L4Budget)
	defer l4cancel()
	for si := range rel.shards {
		wg.Add(1)
		go func(si int) {
			defer wg.Done()
			so := &outs[si]
			rowCache := map[int64]*ftsRow{}
			if runExact {
				expr := q.matchExpr(req.Mode)
				ex, capped, trunc, err := e.exactShard(ctx, rel, si, expr, q, req, want, allow, capN, rowCache)
				if err != nil {
					so.err = err
					return
				}
				so.exact, so.capped, so.truncated = ex, capped, trunc
			}
			if runL4 {
				sim, err := e.similarShard(l4ctx, rel, si, q, allow, so.exact, minScore, req.Scope.Roles, rowCache)
				if err != nil {
					if l4ctx.Err() != nil && ctx.Err() == nil {
						so.partial = true // بودجهٔ زمانی L4 تمام شد — صادقانه partial
					} else {
						so.err = err
						return
					}
				}
				so.sim = append(so.sim, sim.results...)
				so.partial = so.partial || sim.partial
			}
			if runL5 && len(l5forms) > 0 {
				l5, capped, trunc, err := e.nearShard(ctx, rel, si, q, l5forms, req, allow, capN, so.exact, rowCache)
				if err != nil {
					so.err = err
					return
				}
				so.sim = append(so.sim, l5...)
				so.capped = so.capped || capped
				so.truncated = so.truncated || trunc
			}
		}(si)
	}
	wg.Wait()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	res := &execOutcome{layerCounts: map[string]int{}}
	var exact, sim []rawResult
	for si, so := range outs {
		if so.err != nil {
			return nil, fmt.Errorf("fts5 engine: شارد %d: %w", si, so.err)
		}
		exact = append(exact, so.exact...)
		sim = append(sim, so.sim...)
		res.capped = res.capped || so.capped
		res.truncated = res.truncated || so.truncated
		res.simPartial = res.simPartial || so.partial
	}
	// برش سقف با اولویت لایه: پیش از برش، دقیق‌ترین لایه‌ها جلو می‌افتند تا وقتی
	// سقف فعال می‌شود وقوع L1/L2 قربانی L3 نشود (§ ترتیب: دقیق ≥ نرمال ≥ هم‌ارز).
	sortExactForCap(exact)
	exact = dedupeAbs(exact)
	if len(exact) > capN {
		exact = exact[:capN]
		res.capped = true
	}
	sortCanonical(sim)
	if len(sim) > capN {
		sim = sim[:capN]
		res.capped = true
	}
	// امتیاز شباهت برای L1–L3 در similar_quote (تا مرتب‌سازی بر امتیاز یکدست باشد)
	if req.Mode == SimilarQuote {
		if err := e.scoreExact(ctx, rel, q, exact); err != nil {
			return nil, err
		}
	}
	all := make([]rawResult, 0, len(exact)+len(sim))
	all = append(all, exact...)
	all = append(all, sim...)
	sortForMode(all, req)
	res.items = make([]outItem, len(all))
	rowCopy := make(map[*ftsRow]*candRow, len(all))
	for i := range all {
		cr := rowCopy[all[i].row]
		if cr == nil {
			c := all[i].row.candRow
			c.TextN1, c.N1Map = "", "" // فقط near آن‌ها را واکشی می‌کند و toResult نیازی ندارد
			cr = &c
			rowCopy[all[i].row] = cr
		}
		res.items[i] = outItem{row: cr, hit: all[i].hit}
		if l := all[i].hit.layer; l != "" {
			res.layerCounts[l]++
		}
	}
	if layered && want["L4"] && !runL4 {
		res.simSkipped = true
		res.notes = append(res.notes, "جست‌وجوی مشابه (L4) برای پرسش کمتر از ۳ واژه اجرا نمی‌شود.")
	}
	capPartial := res.simPartial // فقط سقف‌های تعاملی (نه کوتاهی پرسش)
	if runL4 && len(q.toks) == 3 {
		res.simPartial = true
		res.notes = append(res.notes, "تضمین بازیابی نقل‌قول مشابه برای کمتر از ۴ واژه برقرار نیست؛ نتایج L4 حداقل واقعی‌اند.")
	}
	if runL4 && capPartial {
		res.notes = append(res.notes, "پوشش نقل‌قول مشابه (L4) به‌دلیل سقف‌های تعاملی کامل نیست؛ نتایج L4 حداقل واقعی‌اند.")
	}
	if rel.normMismatch != "" {
		res.notes = append(res.notes, fmt.Sprintf("نمایهٔ فعال با قواعد نرمال‌سازی %s ساخته شده و موتور %s است؛ برخی تطبیق‌ها ممکن است از دست بروند تا نمایه بازسازی شود.", rel.normMismatch, norm.Version))
	}
	if q.varTrunc {
		res.notes = append(res.notes, fmt.Sprintf("گونه‌های L3 پرسش (پیوستگی/دعایی/صرفی) از سقف %s گونه گذشت؛ نتایج L3 حداقل واقعی‌اند.", faNum(maxVariants)))
	}
	if l5Truncated {
		res.notes = append(res.notes, "نزدیک‌ترین ۲۴ صورتِ واژه (L5) سنجیده شد؛ فهرست کامل گونه‌های نزدیک در این پاسخ نیست.")
	}
	return res, nil
}

// exactShard پیمایش کامل کاندیدهای MATCH یک شارد به ترتیب rowid و راستی‌آزمایی.
func (e *FTS5Engine) exactShard(ctx context.Context, rel *ftsRelease, si int, expr string, q *ftsQuery, req *Request, want map[string]bool, allow *docFilter, capN int, rowCache map[int64]*ftsRow) ([]rawResult, bool, bool, error) {
	var out []rawResult
	truncated := false
	pruned := false // آیا بخشی از نتایج برای سقف رها شد؟ (شمارش دیگر دقیق نیست)
	scanned := 0    // کل وقوع‌های تأییدشدهٔ دیده‌شده در این شارد
	verify := func(r *ftsRow, tr *bool) []rawHit {
		if req.IgnoreSpacing {
			stats := &verifyStats{}
			hs := spacingHits(req, &r.candRow, stats)
			*tr = *tr || stats.truncatedPassages > 0
			var out []rawHit
			for _, h := range hs {
				out = append(out, rawHit{rng: h.Range, layer: "L2", label: "normalized"})
			}
			return out
		}

		switch req.Mode {
		case StrictPhrase:
			vs := &verifyStats{}
			hs, _ := verifyInTextRaw(req, &r.candRow, vs)
			if vs.truncatedPassages > 0 {
				*tr = true
			}
			var out []rawHit
			for _, h := range hs {
				out = append(out, rawHit{rng: h.Range, layer: "L1", label: "exact"})
			}
			return out
		case AllWords:
			return q.verifyWords(r, true, tr)
		case AnyWords:
			return q.verifyWords(r, false, tr)
		case Near:
			vs := &verifyStats{}
			hs, _ := verifyInText(req, &r.candRow, vs)
			if vs.truncatedPassages > 0 {
				*tr = true
			}
			var out []rawHit
			for _, h := range hs {
				out = append(out, rawHit{rng: h.Range, label: "normalized"})
			}
			return out
		case NormalizedPhrase:
			return q.verifyLayers(r, want, false, tr)
		default:
			return q.verifyLayers(r, want, true, tr)
		}
	}
	db := rel.shards[si]
	workers := runtime.NumCPU() / len(rel.shards)
	if workers < 1 {
		workers = 1
	}
	const batch = 256
	ranges := allow.ranges(rel, si)
	if req.IgnoreSpacing {
		// Scan only this shard's scoped documents, even when there are many volumes.
		ranges = allow.byShard[si]
	}
	for _, rg := range ranges {
		var rows *sql.Rows
		var err error
		if req.IgnoreSpacing {
			rows, err = rel.main.QueryContext(ctx, `SELECT seq FROM passages WHERE seq BETWEEN ? AND ? ORDER BY seq`, rg[0], rg[1])
		} else {
			rows, err = db.QueryContext(ctx, `SELECT rowid FROM fts_phrase WHERE fts_phrase MATCH ? AND rowid BETWEEN ? AND ? ORDER BY rowid`, expr, rg[0], rg[1])
		}
		if err != nil {
			return nil, false, false, fmt.Errorf("MATCH %q: %w", expr, err)
		}
		var seqs []int64
		flush := func() (bool, error) {
			if len(seqs) == 0 {
				return false, nil
			}
			rs, err := fetchRows(ctx, rel.main, seqs, req.Mode == Near)
			seqs = seqs[:0]
			if err != nil {
				return false, err
			}
			hits := make([][]rawHit, len(rs))
			trs := make([]bool, len(rs)) // هر کارگر پرچم برش ردیف خودش را می‌نویسد (بدون data race)
			var wg sync.WaitGroup
			chunk := (len(rs) + workers - 1) / workers
			for w := 0; w < workers; w++ {
				lo, hi := w*chunk, (w+1)*chunk
				if hi > len(rs) {
					hi = len(rs)
				}
				if lo >= hi {
					continue
				}
				wg.Add(1)
				go func(lo, hi int) {
					defer wg.Done()
					for i := lo; i < hi; i++ {
						r := rs[i]
						if !scopeAllows(req, &r.candRow, e.base.catalog) || !citationAllows(req, &r.candRow) {
							continue
						}
						hits[i] = verify(r, &trs[i])
					}
				}(lo, hi)
			}
			wg.Wait()
			for _, t := range trs {
				truncated = truncated || t
			}
			for i, r := range rs {
				if len(rowCache) < rowCacheMax {
					rowCache[r.Seq] = r
				}
				for _, h := range hits[i] {
					if len(req.Scope.Roles) > 0 && !matchInsideRoles(r.RoleRanges, h.rng, req.Scope.Roles...) {
						continue
					}
					if h.label == "" {
						h.label = layerLabel(h.layer, h.diffs, 1)
					}
					scanned++
					out = append(out, rawResult{seq: r.Seq, start: h.rng[0], doc: r.DocOrd,
						absLo: r.SourceStart + h.rng[0], absHi: r.SourceStart + h.rng[1], row: r, hit: h, score: 1, cover: 1, layer: h.layer})
				}
			}
			// سقف با اولویت لایه (نه ترتیب canonical): وقتی out از سقف+حاشیه گذشت، بهترین‌ها
			// (لایه، سپس canonical) نگه داشته و بقیه رها می‌شوند (حافظه کران‌دار) و پویش ادامه
			// می‌یابد تا وقوع L1 اواخر کتابخانه قربانی L3 اوایل نشود. توقف وقتی است که خودِ
			// L1ها سقف را پر کنند (هیچ وقوع بعدی وارد مجموعهٔ نهایی نمی‌شود) یا بودجهٔ پویش
			// (exactScanFactor برابر سقف) تمام شود — در هر دو حالت شمارش lower_bound است.
			keep := capN + perPassageHitCap
			if len(out) <= keep {
				return false, nil
			}
			pruned = true
			sortExactForCap(out)
			for i := keep; i < len(out); i++ {
				out[i] = rawResult{} // رهاسازی ارجاع ردیف برای GC
			}
			out = out[:keep]
			if layerRank[out[keep-1].layer] <= 1 || scanned > max(exactScanFactor*keep, exactScanMin) {
				return true, nil
			}
			return false, nil
		}
		stop := false
		for rows.Next() {
			var s int64
			if err := rows.Scan(&s); err != nil {
				rows.Close()
				return nil, false, false, err
			}
			seqs = append(seqs, s)
			if len(seqs) >= batch {
				st, err := flush()
				if err != nil {
					rows.Close()
					return nil, false, false, err
				}
				if st {
					stop = true
					break
				}
			}
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, false, false, err
		}
		rows.Close()
		if !stop {
			if st, err := flush(); err != nil {
				return nil, false, false, err
			} else if st {
				stop = true
			}
		}
		if stop {
			return out, true, truncated, nil
		}
		if err := ctx.Err(); err != nil {
			return nil, false, false, err
		}
	}
	return out, pruned, truncated, nil
}

// exactScanFactor بودجهٔ پویش پس از پرشدن سقف (برابر سقف) برای یافتن لایه‌های دقیق‌تر.
const (
	exactScanFactor = 4
	exactScanMin    = 4096 // کف بودجه برای سقف‌های کوچک
)

// nearShard L5: واژه‌های نزدیک واژگان → MATCH روی n1 → تطبیق واژه.
func (e *FTS5Engine) nearShard(ctx context.Context, rel *ftsRelease, si int, q *ftsQuery, forms []string, req *Request, allow *docFilter, capN int, exact []rawResult, rowCache map[int64]*ftsRow) ([]rawResult, bool, bool, error) {
	set := map[string]bool{}
	for _, f := range forms {
		set[f] = true
	}
	expr := wordsExpr(forms, nil, "OR")
	var out []rawResult
	truncated := false
	exactByDoc := map[int64][][2]int{}
	for _, x := range exact {
		exactByDoc[x.doc] = append(exactByDoc[x.doc], [2]int{x.absLo, x.absHi})
	}
	for _, rg := range allow.ranges(rel, si) {
		rows, err := rel.shards[si].QueryContext(ctx, `SELECT rowid FROM fts_phrase WHERE fts_phrase MATCH ? AND rowid BETWEEN ? AND ? ORDER BY rowid`, expr, rg[0], rg[1])
		if err != nil {
			return nil, false, false, fmt.Errorf("L5 MATCH: %w", err)
		}
		var seqs []int64
		for rows.Next() {
			var s int64
			if rows.Scan(&s) == nil {
				seqs = append(seqs, s)
			}
		}
		rows.Close()
		for start := 0; start < len(seqs); start += 256 {
			end := start + 256
			if end > len(seqs) {
				end = len(seqs)
			}
			rs, err := fetchRows(ctx, rel.main, seqs[start:end], false)
			if err != nil {
				return nil, false, false, err
			}
			for _, r := range rs {
				if !scopeAllows(req, &r.candRow, e.base.catalog) || !citationAllows(req, &r.candRow) {
					continue
				}
				n := 0
				for _, t := range bodyTokens(r) {
					if !set[t.N1] {
						continue
					}
					if n >= perPassageHitCap {
						truncated = true
						break
					}
					absLo, absHi := r.SourceStart+t.Start, r.SourceStart+t.End
					if overlapsAny(exactByDoc[r.DocOrd], absLo, absHi) {
						continue
					}
					if len(req.Scope.Roles) > 0 && !matchInsideRoles(r.RoleRanges, [2]int{t.Start, t.End}, req.Scope.Roles...) {
						continue
					}
					n++
					h := rawHit{rng: [2]int{t.Start, t.End}, layer: "L5", label: layerLabel("L5", nil, 0),
						diffs: []string{fmt.Sprintf("واژهٔ نزدیک: «%s» به‌جای «%s»", t.N1, q.n1[0])}}
					out = append(out, rawResult{seq: r.Seq, start: t.Start, doc: r.DocOrd, absLo: absLo, absHi: absHi, row: r, hit: h, layer: "L5"})
				}
				if len(out) > capN {
					return out, true, truncated, nil
				}
			}
		}
	}
	return out, false, truncated, nil
}

// scoreExact امتیاز شباهت L1–L3 برای similar_quote (هم‌ترازی پرسش با خود بازهٔ تطبیق).
func (e *FTS5Engine) scoreExact(ctx context.Context, rel *ftsRelease, q *ftsQuery, rs []rawResult) error {
	qa := make([]AlignToken, len(q.toks))
	var words []string
	for i, t := range q.toks {
		qa[i] = AlignToken{N1: t.N1, N2: t.N2}
		words = append(words, t.N2)
	}
	if err := rel.prefetchDF(ctx, words); err != nil {
		return err
	}
	al := newAligner(qa, rel.weightFn(), DefaultScoreProfile)
	var da []AlignToken
	for i := range rs {
		r := &rs[i]
		da = da[:0]
		for _, t := range r.row.tokens() {
			if t.Start >= r.hit.rng[0] && t.End <= r.hit.rng[1] {
				da = append(da, AlignToken{N1: t.N1, N2: t.N2})
			}
		}
		var ar AlignmentResult
		if len(qa) == 0 || len(da) == 0 {
			ar = AlignmentResult{Algorithm: AlignerAlgorithm, Version: AlignerVersion}
		} else {
			ar = al.align(da)
		}
		r.score, r.cover = ar.Score, ar.Coverage
		r.hit.sim = &Similarity{Score: ar.Score, Coverage: ar.Coverage, Counts: ar.Counts, Diffs: ar.Diffs, Algorithm: ar.Algorithm, Version: ar.Version}
	}
	return nil
}

func sortCanonical(rs []rawResult) {
	sort.SliceStable(rs, func(i, j int) bool {
		if rs[i].seq != rs[j].seq {
			return rs[i].seq < rs[j].seq
		}
		if rs[i].start != rs[j].start {
			return rs[i].start < rs[j].start
		}
		return layerRank[rs[i].layer] < layerRank[rs[j].layer]
	})
}

// sortExactForCap ترتیب موقت پیش از برش سقف: لایه، سپس canonical.
func sortExactForCap(rs []rawResult) {
	sort.SliceStable(rs, func(i, j int) bool {
		if layerRank[rs[i].layer] != layerRank[rs[j].layer] {
			return layerRank[rs[i].layer] < layerRank[rs[j].layer]
		}
		if rs[i].seq != rs[j].seq {
			return rs[i].seq < rs[j].seq
		}
		return rs[i].start < rs[j].start
	})
}

// rowCacheMax سقف ردیف‌های کش‌شده در طول یک پرس‌وجو — بدون آن، پرس‌وجوی واژهٔ
// بسیار پرتکرار تمام passageها را در حافظه نگه می‌داشت (نشت حافظه به‌ازای پرس‌وجو).
const rowCacheMax = 20000

// dedupeAbs حذف تکرار یک وقوع که هم در بدنهٔ passage و هم در tail بعدی آمده است.
func dedupeAbs(rs []rawResult) []rawResult {
	type absKey struct {
		doc    int64
		lo, hi int
	}
	seen := make(map[absKey]struct{}, len(rs))
	out := rs[:0]
	for _, r := range rs {
		k := absKey{r.doc, r.absLo, r.absHi}
		if _, ok := seen[k]; ok {
			continue
		}
		seen[k] = struct{}{}
		out = append(out, r)
	}
	return out
}

// sortForMode ترتیب نهایی (§۲۰): لایه‌ای → لایه، سپس canonical (L4: امتیاز، پوشش، canonical)؛
// similar_quote → امتیاز؛ sort=source → canonical محض.
func sortForMode(rs []rawResult, req *Request) {
	canon := func(a, b rawResult) bool {
		if a.seq != b.seq {
			return a.seq < b.seq
		}
		return a.start < b.start
	}
	if req.Sort == "source" {
		sort.SliceStable(rs, func(i, j int) bool { return canon(rs[i], rs[j]) })
		return
	}
	switch req.Mode {
	case SimilarQuote:
		sort.SliceStable(rs, func(i, j int) bool {
			if rs[i].score != rs[j].score {
				return rs[i].score > rs[j].score
			}
			if layerRank[rs[i].layer] != layerRank[rs[j].layer] {
				return layerRank[rs[i].layer] < layerRank[rs[j].layer]
			}
			if rs[i].cover != rs[j].cover {
				return rs[i].cover > rs[j].cover
			}
			return canon(rs[i], rs[j])
		})
	case Tiered, LongQuote, Linguistic, NormalizedPhrase:
		sort.SliceStable(rs, func(i, j int) bool {
			li, lj := layerRank[rs[i].layer], layerRank[rs[j].layer]
			if li != lj {
				return li < lj
			}
			if rs[i].layer == "L4" {
				if rs[i].score != rs[j].score {
					return rs[i].score > rs[j].score
				}
				if rs[i].cover != rs[j].cover {
					return rs[i].cover > rs[j].cover
				}
			}
			return canon(rs[i], rs[j])
		})
	default:
		sort.SliceStable(rs, func(i, j int) bool { return canon(rs[i], rs[j]) })
	}
}

// buildResponse پاسخ صادقانه: شمار قطعی (L1–L3) جدا از L4/L5؛ صفحه‌بندی روی فهرست (فیلترشدهٔ)
// نمایش. شمارش‌ها یک بار برای هر اجرا ساخته می‌شوند و هر صفحه فقط O(page) کار دارد.
func (e *FTS5Engine) buildResponse(sid string, rel *ftsRelease, req *Request, out *execOutcome, offset int) *Response {
	st := out.statsFor(e)
	idx := out.view(req.ResultLayers)
	total := len(out.items)
	if idx != nil {
		total = len(idx)
	}
	if offset < 0 {
		offset = 0
	}
	if offset > total {
		offset = total
	}
	pageSize := req.PageSize
	if pageSize < 5 || pageSize > 50 {
		pageSize = 20
	}
	end := offset + pageSize
	if end > total {
		end = total
	}
	page := make([]Result, 0, end-offset)
	for i := offset; i < end; i++ {
		if idx != nil {
			page = append(page, out.result(e, int(idx[i])))
		} else {
			page = append(page, out.result(e, i))
		}
	}
	rel_ := "exact"
	var notices []string
	if out.capped {
		rel_ = "lower_bound"
		notices = append(notices, fmt.Sprintf("نتایج بیشتر از سقف جست‌وجو است؛ شمارش‌ها حداقل واقعی‌اند (سقف %s موضع).", faNum(e.maxResults())))
	}
	if out.truncated {
		rel_ = "lower_bound"
		notices = append(notices, "شمار مواضع در برخی قطعه‌ها از سقفِ مواضعِ هر قطعه گذشت و برش خورد؛ شمارش‌ها حداقل واقعی‌اند.")
	}
	notices = append(notices, out.notes...)
	if st.similar > 0 {
		notices = append(notices, fmt.Sprintf("%s نتیجهٔ مشابه/نزدیک (L4/L5) جدا از شمار قطعی نمایش داده می‌شود.", faNum(st.similar)))
	}
	resp := &Response{
		SessionUID:            sid,
		ReleaseUID:            rel.uid,
		CompletionState:       "complete",
		VerifiedOccurrences:   st.certain,
		VerifiedBooks:         st.books,
		VerifiedPassages:      st.passages,
		VerifiedHadiths:       st.hadiths,
		CountRelation:         rel_,
		ContinuationAvailable: end < total,
		Results:               page,
		SimilarOccurrences:    st.similar,
		TotalResults:          total,
		Engine:                "fts5 " + rel.uid + " " + norm.Version + " " + AlignerAlgorithm + "/" + AlignerVersion,
		Notice:                strings.Join(notices, " "),
		EffectiveMode:         req.Mode,
		EffectiveFlex:         effectiveFlex(req.Mode),
		ResultLayers:          req.ResultLayers,
	}
	if len(out.layerCounts) > 0 {
		resp.LayerCounts = out.layerCounts
	}
	if isLayeredMode(req.Mode) {
		switch {
		case out.simSkipped:
			resp.SimilarCoverage = "not_run"
		case out.simPartial:
			resp.SimilarCoverage = "partial"
		default:
			resp.SimilarCoverage = "complete"
		}
	}
	if resp.ContinuationAvailable {
		resp.NextCursor = signCursor(map[string]any{"s": sid, "o": end}, e.base.Secret)
	}
	return resp
}

// ---------- فیلتر دامنه در سطح سند (rowid range) ----------

type docFilter struct {
	all     bool
	allowed map[int64]bool
	byShard map[int][][2]int64
}

func (e *FTS5Engine) newDocFilter(rel *ftsRelease, req *Request) *docFilter {
	sc := req.Scope
	restrict := (sc.Target == "work" && sc.WorkUID != nil) || len(sc.DocumentUIDs) > 0 ||
		(sc.Language != nil && *sc.Language != "") || len(sc.CollectionUIDs) > 0 ||
		(sc.Author != nil && *sc.Author != "")
	f := &docFilter{byShard: map[int][][2]int64{}}
	if !restrict {
		f.all = true
		return f
	}
	if sc.Target == "work" && sc.WorkUID == nil {
		f.allowed = map[int64]bool{}
		return f
	}
	docSet := map[string]bool{}
	for _, d := range sc.DocumentUIDs {
		docSet[d] = true
	}
	colSet := map[string]bool{}
	for _, c := range sc.CollectionUIDs {
		colSet[c] = true
	}
	authorFold := ""
	if sc.Author != nil && *sc.Author != "" {
		authorFold = norm.Fold(*sc.Author)
	}
	f.allowed = map[int64]bool{}
	for i := range rel.docs {
		d := &rel.docs[i]
		if sc.Target == "work" && sc.WorkUID != nil && d.WorkUID != *sc.WorkUID {
			continue
		}
		if len(docSet) > 0 && !docSet[d.UID] {
			continue
		}
		if sc.Language != nil && *sc.Language != "" && d.Language != *sc.Language {
			continue
		}
		if len(colSet) > 0 && !colSet[d.Collection] {
			continue
		}
		if authorFold != "" && e.base != nil && e.base.catalog != nil {
			_, _, author, ok := e.base.catalog.WorkTitle(d.WorkUID)
			if !ok || !strings.Contains(norm.Fold(author), authorFold) {
				continue
			}
		}
		f.allowed[d.Ord] = true
	}
	// بازه‌های rowid هر شارد: اسناد مجاز پیاپیِ همان شارد ادغام می‌شوند
	lastAllowed := map[int]bool{}
	for i := range rel.docs {
		d := &rel.docs[i]
		if !f.allowed[d.Ord] {
			lastAllowed[d.Shard] = false
			continue
		}
		rs := f.byShard[d.Shard]
		if lastAllowed[d.Shard] && len(rs) > 0 {
			rs[len(rs)-1][1] = d.SeqHi
		} else {
			rs = append(rs, [2]int64{d.SeqLo, d.SeqHi})
		}
		f.byShard[d.Shard] = rs
		lastAllowed[d.Shard] = true
	}
	return f
}

func (f *docFilter) ok(rel *ftsRelease, doc int64) bool {
	if f == nil || f.all {
		return true
	}
	return f.allowed[doc]
}

// ranges بازه‌های rowid شارد؛ برای بیش از ۶۴ بازه یک بازهٔ کامل و فیلتر در verifier.
func (f *docFilter) ranges(rel *ftsRelease, shard int) [][2]int64 {
	full := [][2]int64{{1, 1 << 62}}
	if f == nil || f.all {
		return full
	}
	rs := f.byShard[shard]
	if len(rs) > 64 {
		return full
	}
	return rs
}

// ---------- کش نتایج ----------

type resultCache struct {
	mu    sync.Mutex
	max   int
	order []string
	items map[string]*execOutcome
}

func newResultCache(max int) *resultCache {
	return &resultCache{max: max, items: map[string]*execOutcome{}}
}

func (c *resultCache) get(k string) (*execOutcome, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	v, ok := c.items[k]
	if ok {
		for i, x := range c.order {
			if x == k {
				c.order = append(c.order[:i], c.order[i+1:]...)
				break
			}
		}
		c.order = append(c.order, k)
	}
	return v, ok
}

func (c *resultCache) put(k string, v *execOutcome) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, ok := c.items[k]; ok {
		return
	}
	c.items[k] = v
	c.order = append(c.order, k)
	for len(c.order) > c.max {
		delete(c.items, c.order[0])
		c.order = c.order[1:]
	}
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
