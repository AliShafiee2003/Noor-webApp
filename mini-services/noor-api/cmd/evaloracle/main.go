// Package main — ارزیابی خودکار موتور FTS5 در برابر مجموعهٔ طلایی اوراکل ۱۱۴تایی (§۲۵/§۲۶).
//
// دو معیار گزارش می‌شود:
//   - «قبولی پرسش» (معیار قدیمی): دست‌کم یک نتیجهٔ مطابق در صفحهٔ اول.
//   - recall واقعی سطح وقوع: از همهٔ وقوع‌های مورد انتظار اوراکل، چند درصد در کل نتایج نشست
//     (همهٔ صفحه‌ها با Continue) یافت شده‌اند. تطبیق: همان سند و شمول متن N1 تطبیق در snippet.
//
// هشدار استقلال: oraclegen از همان بستهٔ norm تولید استفاده می‌کند؛ این ارزیابی برای سنجش
// پسرفت مفید است اما جایگزین برچسب‌گذاری مستقل انسانی نیست.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"noor/internal/norm"
	"noor/internal/search"
)

type OracleExpectedMatch struct {
	DocumentUID  string `json:"document_uid"`
	Filename     string `json:"filename"`
	DocItemID    int    `json:"doc_item_id"`
	Role         string `json:"role"`
	ExactSnippet string `json:"exact_snippet"`
}

type OracleQuery struct {
	ID              string                `json:"id"`
	Category        string                `json:"category"`
	Query           string                `json:"query"`
	Language        string                `json:"language"`
	Description     string                `json:"description"`
	ScopeDocUID     string                `json:"scope_doc_uid"`
	RequiredRole    string                `json:"required_role"`
	ExpectedMatches []OracleExpectedMatch `json:"expected_matches"`
}

type OracleSuite struct {
	Version      string         `json:"version"`
	CorpusFile   string         `json:"corpus_file"`
	TotalQueries int            `json:"total_queries"`
	Categories   map[string]int `json:"categories"`
	Queries      []OracleQuery  `json:"queries"`
}

type QueryEvalResult struct {
	ID           string `json:"id"`
	Category     string `json:"category"`
	Query        string `json:"query"`
	ExpectedHits int    `json:"expected_hits"`
	ActualHits   int    `json:"actual_hits"`
	FoundHits    int    `json:"found_expected_hits"`
	TotalResults int    `json:"total_results"`
	RecallPassed bool   `json:"recall_passed"`
	PrecisionOK  bool   `json:"precision_ok"`
	DurationMs   int64  `json:"duration_ms"`
	FirstSnippet string `json:"first_snippet,omitempty"`
	MatchType    string `json:"match_type,omitempty"`
	Error        string `json:"error,omitempty"`
}

type CategoryStats struct {
	TotalQueries  int     `json:"total_queries"`
	PassedQueries int     `json:"passed_queries"`
	SuccessRate   float64 `json:"success_rate"`
	AvgDurationMs float64 `json:"avg_duration_ms"`
}

type EvalReport struct {
	TotalQueries     int                      `json:"total_queries"`
	TotalPassed      int                      `json:"total_passed"`
	OverallRecall    float64                  `json:"overall_recall"`
	OccurrenceRecall float64                  `json:"occurrence_recall"`
	ExpectedTotal    int                      `json:"expected_total"`
	ExpectedFound    int                      `json:"expected_found"`
	CategoryStats    map[string]CategoryStats `json:"category_stats"`
	TotalDurationSec float64                  `json:"total_duration_sec"`
	Results          []QueryEvalResult        `json:"results"`
	GeneratedAt      string                   `json:"generated_at"`
}

type evalMeta struct{}

func (evalMeta) WorkTitle(uid string) (string, string, string, bool) {
	return "کتاب پایلوت", "کتاب", "مؤلف", true
}
func (evalMeta) DocumentMeta(uid string) (string, string, bool) {
	return uid, "جلد", true
}
func (evalMeta) SectionTitle(docUID, secUID string) (string, bool) {
	return "بخش", true
}

func main() {
	oraclePath := flag.String("oracle", "data/pilot_oracle_100.json", "مسیر فایل مجموعهٔ طلایی اوراکل")
	dataDir := flag.String("data", "data/fts_pilot", "پوشهٔ شاردهای FTS5")
	outPath := flag.String("out", "data/pilot_oracle_eval_report.json", "مسیر گزارش خروجی ارزیابی")
	releaseUID := flag.String("release", "rel-pilot-100", "شناسهٔ نسل ایندکس")
	flag.Parse()

	data, err := os.ReadFile(*oraclePath)
	if err != nil {
		log.Fatalf("خطا در خواندن فایل اوراکل: %v", err)
	}

	var suite OracleSuite
	if err := json.Unmarshal(data, &suite); err != nil {
		log.Fatalf("خطا در پارس JSON اوراکل: %v", err)
	}

	log.Printf("بارگذاری موتور FTS5 از %s...", *dataDir)
	base := search.NewLocal("", []byte("eval-secret-32-bytes-long-key!"), evalMeta{})
	eng, err := search.OpenFTS5FromDir(base, *dataDir)
	if err != nil {
		log.Fatalf("خطا در بارگذاری موتور FTS5: %v", err)
	}
	defer eng.Close()

	log.Printf("شروع ارزیابی %d پرس‌وجوی اوراکل در ۸ دسته‌بندی...", len(suite.Queries))
	t0 := time.Now()
	ctx := context.Background()

	var results []QueryEvalResult
	catPassed := make(map[string]int)
	catTotals := make(map[string]int)
	catDuration := make(map[string]int64)

	totalPassed := 0
	expTotal, expFound := 0, 0

	for i, q := range suite.Queries {
		catTotals[q.Category]++

		cleanQ := strings.Trim(q.Query, "«»\"' \t\r\n")
		cleanQ = strings.ReplaceAll(cleanQ, "*", " ")
		req := search.Request{
			Query:    cleanQ,
			PageSize: 20,
		}

		if q.ScopeDocUID != "" {
			req.Scope.DocumentUIDs = []string{q.ScopeDocUID}
		}

		switch q.Category {
		case "diacritic":
			req.Mode = search.StrictPhrase
		case "role_ayah":
			req.Mode = search.NormalizedPhrase
			req.Scope.Roles = []string{"ayah", "ayah_quote", "ayah_text"}
		case "role_hadith":
			req.Mode = search.NormalizedPhrase
			req.Scope.Roles = []string{"G", "hadith", "body", "maasoom"}
		case "role_sanad":
			req.Mode = search.NormalizedPhrase
			req.Scope.Roles = []string{"sanad", "sanadHadith"}
		case "linguistic":
			req.Mode = search.Linguistic
		default:
			req.Mode = search.NormalizedPhrase
		}

		qStart := time.Now()
		resp, err := eng.Search(ctx, &req, *releaseUID)
		qDur := time.Since(qStart).Milliseconds()
		catDuration[q.Category] += qDur

		r := QueryEvalResult{
			ID:           q.ID,
			Category:     q.Category,
			Query:        q.Query,
			ExpectedHits: len(q.ExpectedMatches),
			DurationMs:   qDur,
		}

		if err != nil {
			r.Error = err.Error()
			results = append(results, r)
			continue
		}

		r.ActualHits = len(resp.Results)
		// همهٔ صفحه‌های نشست برای recall سطح وقوع
		all := append([]search.Result(nil), resp.Results...)
		for cur := resp; cur.ContinuationAvailable && cur.NextCursor != "" && len(all) < 20000; {
			next, err := eng.Continue(ctx, cur.SessionUID, cur.NextCursor, *releaseUID)
			if err != nil {
				r.Error = "Continue: " + err.Error()
				break
			}
			all = append(all, next.Results...)
			cur = next
		}
		r.TotalResults = len(all)
		if q.Category != "negative" {
			for _, em := range q.ExpectedMatches {
				expTotal++
				if expectedFound(em, all) {
					expFound++
					r.FoundHits++
				}
			}
		}
		if len(resp.Results) > 0 {
			r.FirstSnippet = resp.Results[0].Snippet
			r.MatchType = resp.Results[0].MatchType
		}

		if q.Category == "negative" {
			// آزمون منفی: باید صفر خروجی بدهد
			if r.ActualHits == 0 {
				r.RecallPassed = true
				r.PrecisionOK = true
				totalPassed++
				catPassed[q.Category]++
			}
		} else {
			// آزمون مثبت: باید حداقل ۱ تطبیق معتبر با رعایت سند، نوع تطبیق و نقش بیاورد
			if r.ActualHits > 0 {
				matchedExpected := false
				for _, res := range resp.Results {
					// چک سند در صورت مشخص بودن
					if q.ScopeDocUID != "" && res.Document.UID != q.ScopeDocUID {
						continue
					}
					// چک نوع تطبیق بر اساس دسته‌بندی
					if q.Category == "diacritic" && res.MatchType != "exact" {
						continue
					}
					if (q.Category == "normalized" || q.Category == "persian" || q.Category == "border_crossing") &&
						(res.MatchType != "normalized" && res.MatchType != "exact") {
						continue
					}
					// چک نقش در صورتی که تعریف شده باشد
					if q.RequiredRole != "" && !hasRole(res.Roles, q.RequiredRole) {
						continue
					}
					matchedExpected = true
					break
				}
				if matchedExpected {
					r.RecallPassed = true
					r.PrecisionOK = true
					totalPassed++
					catPassed[q.Category]++
				} else {
					r.Error = fmt.Sprintf("عدم تطابق معیارها: %d نتیجه یافت شد اما با شرط سند/نقش/نوع همخوانی نداشت (نوع اول: %s، نقش‌ها: %v)",
						r.ActualHits, r.MatchType, resp.Results[0].Roles)
				}
			}
		}

		results = append(results, r)

		if (i+1)%25 == 0 || i+1 == len(suite.Queries) {
			log.Printf("[%d/%d] ارزیابی شد — پاس‌شده: %d/%d (%.1f%%)",
				i+1, len(suite.Queries), totalPassed, i+1, float64(totalPassed)/float64(i+1)*100)
		}
	}

	totalDur := time.Since(t0).Seconds()
	overallRecall := float64(totalPassed) / float64(len(suite.Queries)) * 100
	occRecall := 0.0
	if expTotal > 0 {
		occRecall = float64(expFound) / float64(expTotal) * 100
	}

	catStats := make(map[string]CategoryStats)
	for cat, tot := range catTotals {
		pass := catPassed[cat]
		avgD := 0.0
		if tot > 0 {
			avgD = float64(catDuration[cat]) / float64(tot)
		}
		catStats[cat] = CategoryStats{
			TotalQueries:  tot,
			PassedQueries: pass,
			SuccessRate:   float64(pass) / float64(tot) * 100,
			AvgDurationMs: avgD,
		}
	}

	report := EvalReport{
		TotalQueries:     len(suite.Queries),
		TotalPassed:      totalPassed,
		OverallRecall:    overallRecall,
		OccurrenceRecall: occRecall,
		ExpectedTotal:    expTotal,
		ExpectedFound:    expFound,
		CategoryStats:    catStats,
		TotalDurationSec: totalDur,
		Results:          results,
		GeneratedAt:      time.Now().Format(time.RFC3339),
	}

	outJSON, _ := json.MarshalIndent(report, "", "  ")
	_ = os.WriteFile(*outPath, outJSON, 0o644)

	fmt.Println("\n========================================================")
	fmt.Printf("   گزارش نهایی ارزیابی مجموعهٔ طلایی اوراکل (FTS5 Engine)   \n")
	fmt.Println("========================================================")
	fmt.Printf("تعداد کل پرس‌وجوها:  %d\n", len(suite.Queries))
	fmt.Printf("تعداد کل پاس‌شده:    %d\n", totalPassed)
	fmt.Printf("نرخ قبولی پرسش (≥۱ نتیجهٔ مطابق در صفحهٔ اول): %.2f%%\n", overallRecall)
	fmt.Printf("Recall واقعی سطح وقوع (همهٔ صفحه‌ها): %d/%d = %.2f%%\n", expFound, expTotal, occRecall)
	fmt.Printf("زمان کل اجرا:        %.2f ثانیه (میانگین هر کوئری: %.1f میلی‌ثانیه)\n",
		totalDur, totalDur*1000/float64(len(suite.Queries)))
	fmt.Println("--------------------------------------------------------")
	fmt.Printf("%-18s | %-6s | %-6s | %-8s | %-10s\n", "دسته‌بندی", "کل", "موفق", "نرخ %", "زمان (ms)")
	fmt.Println("--------------------------------------------------------")
	for cat, st := range catStats {
		fmt.Printf("%-18s | %-6d | %-6d | %-7.1f%% | %-10.1f\n",
			cat, st.TotalQueries, st.PassedQueries, st.SuccessRate, st.AvgDurationMs)
	}
	fmt.Println("========================================================")
	fmt.Printf("گزارش تفصیلی در %s ذخیره شد.\n", *outPath)
}

// expectedFound آیا وقوع مورد انتظار در نتایج هست؟ همان سند + متن تطبیق (N1) در snippet.
func expectedFound(em OracleExpectedMatch, results []search.Result) bool {
	want := norm.Fold(strings.TrimSpace(em.ExactSnippet))
	for _, res := range results {
		if em.DocumentUID != "" && res.Document.UID != em.DocumentUID {
			continue
		}
		if want == "" {
			return true
		}
		got := norm.Fold(res.Snippet)
		if strings.Contains(got, want) || (len([]rune(got)) > 8 && strings.Contains(want, got)) {
			return true
		}
	}
	return false
}

func hasRole(roles []string, target string) bool {
	targetLower := strings.ToLower(target)
	for _, r := range roles {
		rLower := strings.ToLower(r)
		if rLower == targetLower {
			return true
		}
		if (targetLower == "hadith" || targetLower == "hadith_body" || targetLower == "g") &&
			(rLower == "g" || rLower == "hadith" || rLower == "body" || rLower == "maasoom") {
			return true
		}
		if (targetLower == "sanad" || targetLower == "sanadhadith") &&
			(rLower == "sanad" || rLower == "sanadhadith") {
			return true
		}
		if (targetLower == "ayah" || targetLower == "ayah_text" || targetLower == "ayah_quote") &&
			(rLower == "ayah" || rLower == "ayah_text" || rLower == "ayah_quote") {
			return true
		}
	}
	return false
}
