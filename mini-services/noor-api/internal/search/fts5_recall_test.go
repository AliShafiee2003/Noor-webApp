package search

// آزمون بازیابی (recall) روی پیکرهٔ مصنوعی با اختلال‌های کنترل‌شده — §۲۰/§۲۳.
// برای هر اختلال، درصد پرسش‌هایی که قطعهٔ منبع را در ۵ نتیجهٔ نخست بازیابی می‌کنند
// گزارش و با آستانهٔ کمینه سنجیده می‌شود؛ مجموعهٔ منفی نیز نباید هیچ نتیجه‌ای بدهد.
// اجرا: go test ./internal/search -run TestFTS5Recall -v

import (
	"context"
	"fmt"
	"math/rand"
	"os"
	"sort"
	"strings"
	"testing"
	"time"
)

const (
	recallLetters = "تثجحخدذرزسشصضطظعغقمنهي"
	recallMarks   = "\u064E\u064F\u0650\u0652" // فتحه، ضمه، کسره، سکون
)

func genWord(r *rand.Rand) string {
	n := 3 + r.Intn(4)
	lr := []rune(recallLetters)
	var b strings.Builder
	if r.Intn(10) == 0 {
		b.WriteRune('أ')
		n--
	}
	for i := 0; i < n; i++ {
		b.WriteRune(lr[r.Intn(len(lr))])
	}
	w := b.String()
	if r.Intn(7) == 0 {
		w += "ة"
	}
	if r.Intn(5) == 0 {
		w = "ال" + w
	}
	return w
}

type recallCorpus struct {
	vocab []string
	docs  []testDoc
	words map[string][][]string // doc → passages → words
}

func genRecallCorpus(seed int64, nDocs, nItems, nWords int) *recallCorpus {
	r := rand.New(rand.NewSource(seed))
	c := &recallCorpus{words: map[string][][]string{}}
	seen := map[string]bool{}
	for len(c.vocab) < 1500 {
		w := genWord(r)
		if !seen[w] {
			seen[w] = true
			c.vocab = append(c.vocab, w)
		}
	}
	for d := 0; d < nDocs; d++ {
		doc := testDoc{Collection: fmt.Sprintf("c-%d", d%3), Work: fmt.Sprintf("w-%02d", d), Doc: fmt.Sprintf("d-%02d", d), Lang: "ar"}
		for it := 0; it < nItems; it++ {
			ws := make([]string, nWords)
			var b strings.Builder
			for i := range ws {
				ws[i] = c.vocab[r.Intn(len(c.vocab))]
				if i > 0 {
					b.WriteByte(' ')
				}
				if r.Intn(9) == 0 {
					ws[i] += "،" // واژهٔ سطحی با نشانه، تا رونوشت عین متن واقعاً عین متن باشد
				}
				b.WriteString(ws[i])
			}
			c.words[doc.Doc] = append(c.words[doc.Doc], ws)
			doc.Items = append(doc.Items, "<p>"+b.String()+".</p>")
		}
		c.docs = append(c.docs, doc)
	}
	return c
}

type perturbation struct {
	name    string
	minRate float64
	layers  string // لایه‌های مجاز برای نتیجهٔ منبع (مثلاً "L1" یا "L2,L3")
	fn      func(r *rand.Rand, ws []string, vocab []string) []string
}

func cp(ws []string) []string { return append([]string(nil), ws...) }

func replaceInOne(ws []string, from, to string) ([]string, bool) {
	out := cp(ws)
	for i, w := range out {
		if strings.Contains(w, from) {
			out[i] = strings.Replace(w, from, to, 1)
			return out, true
		}
	}
	return out, false
}

var perturbations = []perturbation{
	{"exact", 1, "L1", func(r *rand.Rand, ws, _ []string) []string { return cp(ws) }},
	{"diacritics", 1, "L2", func(r *rand.Rand, ws, _ []string) []string {
		out := cp(ws)
		mk := []rune(recallMarks)
		for i, w := range out {
			var b strings.Builder
			for _, ch := range w {
				b.WriteRune(ch)
				if r.Intn(2) == 0 {
					b.WriteRune(mk[r.Intn(len(mk))])
				}
			}
			out[i] = b.String()
		}
		return out
	}},
	{"punctuation", 1, "L1,L2", func(r *rand.Rand, ws, _ []string) []string {
		out := cp(ws)
		p := []string{"،", ".", "؛", ":", "!", "؟"}
		for i := range out {
			if r.Intn(3) == 0 {
				out[i] += p[r.Intn(len(p))]
			}
		}
		out[0] = "«" + out[0]
		out[len(out)-1] += "»"
		return out
	}},
	{"yeh_kaf_persian", 1, "L2", func(r *rand.Rand, ws, _ []string) []string {
		out := cp(ws)
		for i := range out {
			out[i] = strings.ReplaceAll(out[i], "ي", "ی")
		}
		return out
	}},
	{"hamza", 1, "L3", func(r *rand.Rand, ws, _ []string) []string {
		out, _ := replaceInOne(ws, "أ", "ا")
		return out
	}},
	{"ta_marbuta", 1, "L3", func(r *rand.Rand, ws, _ []string) []string {
		out, _ := replaceInOne(ws, "ة", "ه")
		return out
	}},
	{"waw_proclitic", 1, "L3", func(r *rand.Rand, ws, _ []string) []string {
		out := cp(ws)
		i := 1 + r.Intn(len(out)-2)
		out[i] = "و" + out[i]
		return out
	}},
	{"typo_1_letter", 0.95, "L4", func(r *rand.Rand, ws, _ []string) []string {
		out := cp(ws)
		i := r.Intn(len(out))
		rs := []rune(out[i])
		j := len(rs) - 1 - r.Intn(2)
		lr := []rune(recallLetters)
		for {
			c := lr[r.Intn(len(lr))]
			if c != rs[j] {
				rs[j] = c
				break
			}
		}
		out[i] = string(rs)
		return out
	}},
	{"substitute_1", 0.95, "L4", func(r *rand.Rand, ws, v []string) []string {
		out := cp(ws)
		out[r.Intn(len(out))] = v[r.Intn(len(v))]
		return out
	}},
	{"substitute_2", 0.9, "L4", func(r *rand.Rand, ws, v []string) []string {
		out := cp(ws)
		for _, i := range r.Perm(len(out))[:2] {
			out[i] = v[r.Intn(len(v))]
		}
		return out
	}},
	{"substitute_3", 0.8, "L4", func(r *rand.Rand, ws, v []string) []string {
		out := cp(ws)
		for _, i := range r.Perm(len(out))[:3] {
			out[i] = v[r.Intn(len(v))]
		}
		return out
	}},
	{"delete_1", 0.95, "L4", func(r *rand.Rand, ws, _ []string) []string {
		i := 1 + r.Intn(len(ws)-2)
		return append(cp(ws[:i]), ws[i+1:]...)
	}},
	{"insert_1", 0.95, "L4", func(r *rand.Rand, ws, v []string) []string {
		i := 1 + r.Intn(len(ws)-2)
		out := append(cp(ws[:i]), v[r.Intn(len(v))])
		return append(out, ws[i:]...)
	}},
	{"swap_adjacent", 0.95, "L4", func(r *rand.Rand, ws, _ []string) []string {
		out := cp(ws)
		i := r.Intn(len(out) - 1)
		out[i], out[i+1] = out[i+1], out[i]
		return out
	}},
	{"block_move_3", 0.9, "L4", func(r *rand.Rand, ws, _ []string) []string {
		// بلوک ۳ واژه‌ای از ابتدا به انتها
		out := append(cp(ws[3:]), ws[:3]...)
		return out
	}},
	{"mixed_norm_and_edit", 0.9, "L4", func(r *rand.Rand, ws, v []string) []string {
		out := cp(ws)
		out[r.Intn(len(out))] = v[r.Intn(len(v))]
		for i := range out {
			out[i] = strings.ReplaceAll(out[i], "ي", "ی")
		}
		out[2] += "،"
		return out
	}},
}

func TestFTS5RecallPerturbations(t *testing.T) {
	if testing.Short() {
		t.Skip("short mode")
	}
	c := genRecallCorpus(7, 36, 3, 70)
	e, _ := newTestEngine(t, c.docs)
	ctx := context.Background()
	r := rand.New(rand.NewSource(42))
	const perPert = 30
	const qLen = 12

	type sample struct {
		doc   string
		words []string
	}
	samples := make([]sample, perPert)
	for i := range samples {
		d := c.docs[r.Intn(len(c.docs))].Doc
		ps := c.words[d]
		p := ps[r.Intn(len(ps))]
		off := 2 + r.Intn(len(p)-qLen-4)
		samples[i] = sample{d, p[off : off+qLen]}
	}
	var report []string
	for _, pt := range perturbations {
		found, fp, badLayer := 0, 0, 0
		var misses []string
		for _, s := range samples {
			q := strings.Join(pt.fn(r, s.words, c.vocab), " ")
			allowed := pt.layers
			if q == strings.Join(s.words, " ") {
				allowed = "L1" // اختلال روی این نمونه اثری نداشت (مثلاً واژهٔ همزه‌دار نداشت)
			}
			req := Request{Query: q, Mode: Tiered, PageSize: 5}
			resp, err := e.Search(ctx, &req, "")
			if err != nil {
				t.Fatalf("%s: %v", pt.name, err)
			}
			ok := false
			for i, res := range resp.Results {
				if res.Document.UID == s.doc && i < 5 {
					if !ok && !strings.Contains(allowed, res.Layer) {
						badLayer++
						if len(misses) < 2 {
							misses = append(misses, "layer "+res.Layer+": "+q)
						}
					}
					ok = true
				}
				if res.Document.UID != s.doc {
					fp++
				}
			}
			if ok {
				found++
			} else if len(misses) < 2 {
				misses = append(misses, q)
			}
		}
		rate := float64(found) / float64(len(samples))
		line := fmt.Sprintf("%-20s recall@5=%5.1f%%  نتایج نادرست=%d", pt.name, 100*rate, fp)
		report = append(report, line)
		if rate < pt.minRate {
			t.Errorf("%s: recall %.2f < %.2f; نمونهٔ ازدست‌رفته: %q", pt.name, rate, pt.minRate, misses)
		}
		if badLayer > 0 {
			t.Errorf("%s: %d نتیجه با لایهٔ نادرست (مجاز: %s): %q", pt.name, badLayer, pt.layers, misses)
		}
		if fp > 0 {
			t.Errorf("%s: %d نتیجهٔ نادرست از اسناد دیگر", pt.name, fp)
		}
	}
	// مجموعهٔ منفی: ۱۲ واژهٔ تصادفی از همان واژگان — نباید هیچ نتیجه‌ای (حتی L4) بدهد
	neg := 0
	for i := 0; i < perPert; i++ {
		ws := make([]string, qLen)
		for j := range ws {
			ws[j] = c.vocab[r.Intn(len(c.vocab))]
		}
		req := Request{Query: strings.Join(ws, " "), Mode: Tiered}
		resp, err := e.Search(ctx, &req, "")
		if err != nil {
			t.Fatal(err)
		}
		neg += len(resp.Results)
	}
	report = append(report, fmt.Sprintf("%-20s نتایج (باید ۰ باشد)=%d", "negative", neg))
	if neg > 0 {
		t.Errorf("negative set produced %d results", neg)
	}
	t.Log("\n" + strings.Join(report, "\n"))
}

// TestFTS5LatencySynthetic سنجش تقریبی تأخیر روی پیکرهٔ مصنوعی بزرگ‌تر (فقط با NOOR_BENCH=1).
// عدد واقعی باید روی پیکرهٔ واقعی (~۶۰۰۰ جلد) و سخت‌افزار تولید سنجیده شود.
func TestFTS5LatencySynthetic(t *testing.T) {
	if os.Getenv("NOOR_BENCH") != "1" {
		t.Skip("NOOR_BENCH=1 برای اجرا")
	}
	nDocs, nItems, nWords := 400, 25, 80
	if os.Getenv("NOOR_BENCH_SMALL") == "1" {
		nDocs = 100
	}
	t0 := time.Now()
	c := genRecallCorpus(11, nDocs, nItems, nWords)
	e, _ := newTestEngine(t, c.docs)
	t.Logf("build: %d docs × %d passages × %d words = %d words in %v", nDocs, nItems, nWords, nDocs*nItems*nWords, time.Since(t0).Round(time.Millisecond))
	r := rand.New(rand.NewSource(5))
	ctx := context.Background()
	modes := []string{NormalizedPhrase, Linguistic, Tiered, AnyWords, AllWords}
	if m := os.Getenv("NOOR_BENCH_MODE"); m != "" {
		modes = []string{m}
	}
	for _, mode := range modes {
		var ds []time.Duration
		totalRes := 0
		for i := 0; i < 40; i++ {
			d := c.docs[r.Intn(len(c.docs))].Doc
			ps := c.words[d]
			p := ps[r.Intn(len(ps))]
			n := 3
			if mode == Tiered {
				n = 12
			}
			off := r.Intn(len(p) - n)
			ws := cp(p[off : off+n])
			if mode == Tiered {
				ws[r.Intn(n)] = c.vocab[r.Intn(len(c.vocab))]
			}
			req := Request{Query: strings.Join(ws, " "), Mode: mode, PageSize: 20}
			st := time.Now()
			resp, err := e.Search(ctx, &req, "")
			if err != nil {
				t.Fatal(err)
			}
			ds = append(ds, time.Since(st))
			totalRes += resp.TotalResults
		}
		sort.Slice(ds, func(i, j int) bool { return ds[i] < ds[j] })
		t.Logf("%-18s p50=%v p95=%v max=%v  (میانگین نتایج: %d)", mode, ds[len(ds)/2].Round(time.Microsecond), ds[len(ds)*95/100].Round(time.Microsecond), ds[len(ds)-1].Round(time.Microsecond), totalRes/len(ds))
	}
}
