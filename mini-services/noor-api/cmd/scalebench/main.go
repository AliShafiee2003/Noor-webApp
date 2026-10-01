// scalebench — بنچمارک موتور جست‌وجو روی «کورپوس مقیاس مصنوعی» (round14-B).
// همان باتری پرس‌وجو روی موتور محلی یا OpenSearch اجرا می‌شود و زمان دیواری
// هر پرس‌وجو (پس از یک دور گرم‌کردن) با p50/p95 گزارش می‌شود؛ شمارش‌های
// «تأییدشده» هم ثبت می‌شوند تا پاریتی دو موتور بعداً سنجیده شود.
//
// صداقت اندازه‌گیری: یک دور گرم‌کردن قبل از اندازه‌گیری؛ time.Now() دور
// engine.Search؛ نمونه‌ها به‌صورت خام هم چاپ می‌شوند (n کوچک = p95 ≈ max).
//
// اجرا از ریشهٔ mini-services/noor-api:
//
//	go run ./cmd/scalebench -db data/index-scale.sqlite -rounds 3 -engine local
//	go run ./cmd/scalebench -engine opensearch -os-url http://127.0.0.1:9200 -os-index noor-scale
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"runtime"
	"sort"
	"strings"
	"time"

	"noor/internal/search"

	_ "modernc.org/sqlite"
)

// scaleMeta آداپتور ابرداده از خود نمایهٔ مقیاس (عنوان‌ها و نقشهٔ سند→اثر) —
// معادل کاتالوگ تولیدی در cmd/api؛ برای این‌که شمارش کتاب‌ها/عنوان‌ها واقعی بماند.
type scaleMeta struct {
	titles  map[string][3]string // work_uid → (title, short, author)
	docWork map[string][2]string // document_uid → (work_uid, label)
}

func (m *scaleMeta) WorkTitle(uid string) (title, short, author string, ok bool) {
	if v, ok2 := m.titles[uid]; ok2 {
		return v[0], v[1], v[2], true
	}
	return "", "", "", false
}

func (m *scaleMeta) DocumentMeta(uid string) (workUID, label string, ok bool) {
	if v, ok2 := m.docWork[uid]; ok2 {
		return v[0], v[1], true
	}
	return "", "", false
}

func (m *scaleMeta) SectionTitle(docUID, secUID string) (string, bool) {
	return "", false // سکشن‌های fixture در کاتالوگ مقیاس نیستند — صادقانه «نیست»
}

// benchCase یک پرس‌وجوی باتری.
type benchCase struct {
	id   string
	note string
	req  *search.Request
}

// sample خروجی هر پرس‌وجو در باتری.
type sample struct {
	ID            string    `json:"id"`
	Note          string    `json:"note"`
	Mode          string    `json:"mode"`
	Candidates    int64     `json:"candidates"` // محلی: شمار کاندید prefilter؛ OS: -1 (در دسترس نیست)
	Selectivity   float64   `json:"selectivity_pct"`
	Occurrences   int       `json:"verified_occurrences"`
	Books         int       `json:"verified_books"`
	CountRelation string    `json:"count_relation"`
	P50MS         float64   `json:"p50_ms"`
	P95MS         float64   `json:"p95_ms"`
	SamplesMS     []float64 `json:"samples_ms"`
}

type heapInfo struct {
	HeapAllocMB float64 `json:"heap_alloc_mb"`
	HeapSysMB   float64 `json:"heap_sys_mb"`
	HeapObjects uint64  `json:"heap_objects"`
	SysMB       float64 `json:"sys_mb"`
	NumGC       uint32  `json:"num_gc"`
}

func main() {
	dbPath := flag.String("db", "data/index-scale.sqlite", "مسیر نمایهٔ مقیاس SQLite")
	rounds := flag.Int("rounds", 3, "دورهای اندازه‌گیری پس از گرم‌کردن")
	engine := flag.String("engine", "local", "local | opensearch")
	osURL := flag.String("os-url", "http://127.0.0.1:9200", "آدرس OpenSearch")
	osIndex := flag.String("os-index", "noor-scale", "نام index در OpenSearch")
	osUser := flag.String("os-user", os.Getenv("NOOR_OS_USER"), "کاربر OpenSearch (اختیاری)")
	osPass := flag.String("os-pass", os.Getenv("NOOR_OS_PASS"), "رمز OpenSearch (اختیاری)")
	release := flag.String("release", "rel-scale", "release_uid مورد جست‌وجو")
	maxResults := flag.Int("max-results", 10000, "سقف کل نتایج (NOOR_MAX_RESULTS تولید)")
	jsonOut := flag.String("json-out", "", "مسیر اختیاری خروجی JSON برای پاریتی اسکریپت")
	flag.Parse()
	if *rounds < 1 {
		log.Fatal("rounds باید ≥ ۱ باشد")
	}

	// اتصال فقط‌خواندنی برای ابرداده و شمار کل (موتور خودش اتصال ro جدا می‌سازد)
	ro, err := sql.Open("sqlite", "file:"+*dbPath+"?mode=ro")
	if err != nil {
		log.Fatal(err)
	}
	defer ro.Close()
	var totalPassages, totalTitles int
	if err := ro.QueryRow(`SELECT COUNT(*) FROM passages WHERE release_uid=?`, *release).Scan(&totalPassages); err != nil {
		log.Fatal("شمار passages نمایهٔ مقیاس (release ", *release, "):", err)
	}
	if err := ro.QueryRow(`SELECT COUNT(*) FROM titles`).Scan(&totalTitles); err != nil {
		log.Fatal(err)
	}

	meta := &scaleMeta{titles: map[string][3]string{}, docWork: map[string][2]string{}}
	trows, err := ro.Query(`SELECT work_uid, title, short_title, author FROM titles`)
	if err != nil {
		log.Fatal(err)
	}
	for trows.Next() {
		var uid, t, s, a string
		if err := trows.Scan(&uid, &t, &s, &a); err != nil {
			log.Fatal(err)
		}
		meta.titles[uid] = [3]string{t, s, a}
	}
	trows.Close()
	drows, err := ro.Query(`SELECT DISTINCT document_uid, work_uid, page_label FROM passages WHERE release_uid=?`, *release)
	if err != nil {
		log.Fatal(err)
	}
	for drows.Next() {
		var d, w, l string
		if err := drows.Scan(&d, &w, &l); err != nil {
			log.Fatal(err)
		}
		meta.docWork[d] = [2]string{w, l}
	}
	drows.Close()

	// ساخت موتور مطابق cmd/api/main.go (NewLocal + WithLimits).
	// تفاوت اعلام‌شده: SessionStoreٔ SQLite به app.sqlite می‌نویسد که در این آزمون
	// محافظت‌شده است؛ مسیر fallback حافظهٔ خود موتور (سقف ۴۰۰ نشست) استفاده می‌شود —
	// برای مسیر Search/Continue رفتار یکسان است.
	local := search.NewLocal(*dbPath, []byte("scalebench-secret"), meta,
		search.WithLimits(*maxResults, 30*time.Minute))
	var eng search.Engine = local
	engineName := "local"
	if *engine == "opensearch" {
		osEng, err := search.NewOpenSearch(*osURL, *osUser, *osPass, *osIndex, local)
		if err != nil {
			log.Fatalf("موتور OpenSearch آماده نیست: %v", err)
		}
		eng = osEng
		engineName = "opensearch"
	}

	// نقل‌قول بلند: ۱۴ واژهٔ پیوسته از بلندترین passage کورپوس (از text_n1؛
	// نرمال idempotent است و مرزهای واژه حفظ می‌شود) — تعیین هویت و چاپ صریح
	var longQuote string
	if err := ro.QueryRow(`SELECT text_n1 FROM passages WHERE release_uid=? ORDER BY LENGTH(text_n1) DESC LIMIT 1`, *release).Scan(&longQuote); err != nil {
		log.Fatal("استخراج نقل بلند:", err)
	}
	lf := strings.Fields(longQuote)
	if len(lf) > 14 {
		lf = lf[:14]
	}
	longQuote = strings.Join(lf, " ")

	near := func(slop int, ordered bool) *struct {
		Slop    int  `json:"slop"`
		Ordered bool `json:"ordered"`
	} {
		return &struct {
			Slop    int  `json:"slop"`
			Ordered bool `json:"ordered"`
		}{Slop: slop, Ordered: ordered}
	}
	battery := []benchCase{
		{"q1", "عبارت طلایی «الكعبة بيت الله»", &search.Request{Query: "الكعبة بيت الله", Mode: search.StrictPhrase, Scope: search.Scope{Target: "library"}, PageSize: 20}},
		{"q2", "عبارت طلایی نرمال‌شده", &search.Request{Query: "الكعبة بيت الله", Mode: search.NormalizedPhrase, Scope: search.Scope{Target: "library"}, PageSize: 20}},
		{"q3", "همهٔ واژه‌ها «الكعبة بيت»", &search.Request{Query: "الكعبة بيت", Mode: search.AllWords, Scope: search.Scope{Target: "library"}, PageSize: 20}},
		{"q4", "نزدیکی «الكعبة بيت» slop=5", &search.Request{Query: "الكعبة بيت", Mode: search.Near, Scope: search.Scope{Target: "library"}, Near: near(5, false), PageSize: 20}},
		{"q5", "هر واژه «الكعبة»", &search.Request{Query: "الكعبة", Mode: search.AnyWords, Scope: search.Scope{Target: "library"}, PageSize: 20}},
		{"q6", "نقل بلند ۱۴واژه‌ای از کورپوس", &search.Request{Query: longQuote, Mode: search.LongQuote, Scope: search.Scope{Target: "library"}, PageSize: 20}},
		{"q7", "استناد صرف قرآنی البقرة ۲۱۳ (مطابق golden)", &search.Request{Query: "", Mode: search.NormalizedPhrase, Scope: search.Scope{Target: "library", Quran: &search.QuranRef{Sure: "2", Aya: "213"}}, PageSize: 20}},
		{"q8", "جست‌وجوی عنوان «الخصال»", &search.Request{Query: "الخصال", Mode: search.StrictPhrase, Scope: search.Scope{Target: "titles"}, PageSize: 20}},
	}

	ctx := context.Background()
	fmt.Printf("# آزمون مقیاس noor (round14-B) — engine=%s\n", engineName)
	fmt.Printf("db=%s release=%s rounds=%d max_results=%d\n", *dbPath, *release, *rounds, *maxResults)
	fmt.Printf("passages=%d titles=%d trigram_prefilter=on\n", totalPassages, totalTitles)
	fmt.Printf("long_quote=%q\n", longQuote)

	// گرم‌کردن: هر پرس‌وجو یک‌بار (نتیجه = انتظار پاریتی هم هست)
	scanBefore := local.FullScanCount()
	for _, bc := range battery {
		t0 := time.Now()
		resp, err := eng.Search(ctx, bc.req, *release)
		if err != nil {
			log.Fatalf("گرم‌کردن %s (%s): %v", bc.id, bc.note, err)
		}
		fmt.Printf("warmup %s: occ=%d books=%d rel=%s (%d ms)\n",
			bc.id, resp.VerifiedOccurrences, resp.VerifiedBooks, resp.CountRelation, time.Since(t0).Milliseconds())
	}
	scanAfter := local.FullScanCount()

	heap := func() heapInfo {
		var m runtime.MemStats
		runtime.ReadMemStats(&m)
		return heapInfo{
			HeapAllocMB: float64(m.HeapAlloc) / (1 << 20), HeapSysMB: float64(m.HeapSys) / (1 << 20),
			HeapObjects: m.HeapObjects, SysMB: float64(m.Sys) / (1 << 20), NumGC: m.NumGC,
		}
	}
	heapWarm := heap()

	// اندازه‌گیری
	// نکتهٔ ستون «کاندید» (فقط محلی): مقدار statCands موتور؛ در پرس‌وجوهای
	// سقف‌دار = کاندیدِ پیمایش‌شده تا لحظهٔ رسیدن به سقف، در بقیه = کل کاندیدهای
	// پیش‌فیلتر. مسیر titles از run نمی‌گذرد → صادقانه «—».
	results := make([]sample, 0, len(battery))
	for _, bc := range battery {
		s := sample{ID: bc.id, Note: bc.note, Mode: bc.req.Mode, Candidates: -1}
		if engineName == "local" && bc.req.Scope.Target != "titles" {
			s.Candidates = local.LastCandidateCount() // مقدار آخرین run؛ در حلقهٔ زیر تازه می‌شود
		}
		for r := 0; r < *rounds; r++ {
			t0 := time.Now()
			resp, err := eng.Search(ctx, bc.req, *release)
			ms := float64(time.Since(t0).Microseconds()) / 1000.0
			if err != nil {
				log.Fatalf("اندازه‌گیری %s: %v", bc.id, err)
			}
			s.SamplesMS = append(s.SamplesMS, ms)
			s.Occurrences = resp.VerifiedOccurrences
			s.Books = resp.VerifiedBooks
			s.CountRelation = resp.CountRelation
			if engineName == "local" && bc.req.Scope.Target != "titles" {
				s.Candidates = local.LastCandidateCount()
			}
		}
		if s.Candidates >= 0 && totalPassages > 0 {
			s.Selectivity = float64(s.Candidates) * 100 / float64(totalPassages)
		}
		sorted := append([]float64(nil), s.SamplesMS...)
		sort.Float64s(sorted)
		s.P50MS = pct(sorted, 0.50)
		s.P95MS = pct(sorted, 0.95)
		results = append(results, s)
	}
	heapFinal := heap()
	runtime.GC()
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	heapResidualMB := float64(m.HeapAlloc) / (1 << 20)

	// جدول markdown — خروجی اصلی
	fmt.Println()
	fmt.Println("| # | پرس‌وجو | حالت | کاندید | گزینش‌پذیری | مواضع تأیید | کتاب‌ها | count_relation | p50 (ms) | p95 (ms) |")
	fmt.Println("|---|---------|------|--------|-------------|-------------|---------|----------------|----------|----------|")
	for _, s := range results {
		cand := "—"
		if s.Candidates >= 0 {
			cand = fmt.Sprintf("%d", s.Candidates)
		}
		sel := "—"
		if s.Candidates >= 0 {
			sel = fmt.Sprintf("%.1f%%", s.Selectivity)
		}
		fmt.Printf("| %s | %s | %s | %s | %s | %s | %d | %s | %.1f | %.1f |\n",
			s.ID, s.Note, s.Mode, cand, sel,
			occStr(s), s.Books, s.CountRelation, s.P50MS, s.P95MS)
	}
	fmt.Println()
	fmt.Println("پانوشت: «کاندید» = شمار کاندیدهای prefilter موتور محلی؛ در سطرهای دارای «(سقف)» کاندیدِ پیمایش‌شده تا لحظهٔ سقف است (نه کل کاندیدها). در حالت OpenSearch شمار کاندید از آداپتور بیرون نمی‌آید → «—». گزینش‌پذیری = کاندید ÷ کل passages release. مسیر titles از run نمی‌گذرد و از پیش‌فیلتر trigram استفاده نمی‌کند (پویش خطی همهٔ titles).")
	fmt.Println()
	fmt.Printf("نمونه‌های خام (ms): \n")
	for _, s := range results {
		fmt.Printf("  %s [%s]: %s\n", s.ID, s.Mode, joinMS(s.SamplesMS))
	}
	fmt.Printf("حافظه پس از گرم‌کردن: HeapAlloc=%.1fMB HeapSys=%.1fMB HeapObjects=%d Sys=%.1fMB NumGC=%d\n",
		heapWarm.HeapAllocMB, heapWarm.HeapSysMB, heapWarm.HeapObjects, heapWarm.SysMB, heapWarm.NumGC)
	fmt.Printf("حافظه پس از اندازه‌گیری: HeapAlloc=%.1fMB HeapSys=%.1fMB — پس از GC اجباری: %.1fMB\n",
		heapFinal.HeapAllocMB, heapFinal.HeapSysMB, heapResidualMB)
	fmt.Printf("اسکن کامل strict (fallback بدون trigram): %d بار در کل باتری\n", scanAfter-scanBefore)

	// JSON برای پاریتی اسکریپت (محلی ↔ OpenSearch)
	if *jsonOut != "" {
		out := map[string]any{
			"meta": map[string]any{
				"engine": engineName, "db": *dbPath, "release": *release,
				"rounds": *rounds, "max_results": *maxResults,
				"total_passages": totalPassages, "total_titles": totalTitles,
				"long_quote": longQuote,
				"heap_warm":  heapWarm, "heap_final": heapFinal,
				"heap_residual_mb_after_gc": heapResidualMB,
				"strict_full_scans":         scanAfter - scanBefore,
			},
			"results": results,
		}
		b, err := json.MarshalIndent(out, "", "  ")
		if err != nil {
			log.Fatal(err)
		}
		if err := os.WriteFile(*jsonOut, b, 0o644); err != nil {
			log.Fatal("نوشتن JSON:", err)
		}
		fmt.Println("JSON:", *jsonOut)
	}
}

// occStr شمار مواضع با درج برچسب سقف — شفافیت count_relation.
func occStr(s sample) string {
	base := fmt.Sprintf("%d", s.Occurrences)
	if s.CountRelation == "lower_bound" {
		base += " (سقف)"
	}
	return base
}

// pct صدک نزدیک‌ترین رتبه روی نمونه‌های مرتب (n کوچک؛ p95 با ۳ نمونه = بیشینه).
func pct(sorted []float64, p float64) float64 {
	n := len(sorted)
	if n == 0 {
		return 0
	}
	idx := int(p*float64(n) + 0.9999)
	if idx < 1 {
		idx = 1
	}
	if idx > n {
		idx = n
	}
	return sorted[idx-1]
}

func joinMS(xs []float64) string {
	parts := make([]string, len(xs))
	for i, x := range xs {
		parts[i] = fmt.Sprintf("%.1f", x)
	}
	return strings.Join(parts, ", ")
}
