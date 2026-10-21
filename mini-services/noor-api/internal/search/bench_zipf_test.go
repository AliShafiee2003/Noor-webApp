package search

// سنجش تأخیر روی پیکرهٔ مصنوعی با توزیع Zipf (فقط با NOOR_BENCH=1).
//
// پیکرهٔ یکنواخت (TestFTS5LatencySynthetic) واژهٔ پرتکرار ندارد و بدترین حالت واقعی —
// «و/في/من/قال» با صدها هزار کاندید — را نمی‌سنجد. این سنجه همان موتور را با بسامد
// واقع‌گرایانه، کش نتایج خاموش و دسته‌های جدای طول/بسامد پرسش می‌سنجد.
//
//	NOOR_BENCH=1 NOOR_BENCH_DIR=/tmp/zipf go test ./internal/search -run TestZipfLatency -v
//
// NOOR_BENCH_DIR اختیاری است؛ اگر داده شود، نمایه یک بار ساخته و دفعات بعد بازخوانی می‌شود.

import (
	"context"
	"fmt"
	"math/rand"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"
)

type zipfCorpus struct {
	docs  []testDoc
	words map[string][][]string
	vocab []string
}

func genZipfCorpus(seed int64, nDocs, nItems, nWords int) *zipfCorpus {
	r := rand.New(rand.NewSource(seed))
	c := &zipfCorpus{words: map[string][][]string{}}
	c.vocab = []string{"و", "في", "من", "الله", "قال", "عن", "على", "ما", "لا", "أن", "عليه", "السلام", "رسول", "إلى", "هو"}
	seen := map[string]bool{}
	for _, w := range c.vocab {
		seen[w] = true
	}
	for len(c.vocab) < 20000 {
		w := genWord(r)
		if !seen[w] {
			seen[w] = true
			c.vocab = append(c.vocab, w)
		}
	}
	z := rand.NewZipf(r, 1.07, 2, uint64(len(c.vocab)-1))
	for d := 0; d < nDocs; d++ {
		doc := testDoc{Collection: fmt.Sprintf("c-%d", d%3), Work: fmt.Sprintf("w-%03d", d), Doc: fmt.Sprintf("d-%03d", d), Lang: "ar"}
		for it := 0; it < nItems; it++ {
			ws := make([]string, nWords)
			var b strings.Builder
			for i := range ws {
				ws[i] = c.vocab[z.Uint64()]
				if i > 0 {
					b.WriteByte(' ')
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

func openZipfEngine(t *testing.T, c *zipfCorpus) *FTS5Engine {
	dir := os.Getenv("NOOR_BENCH_DIR")
	if dir == "" {
		dir = t.TempDir()
	}
	const rel = "rel-zipf"
	if _, err := os.Stat(filepath.Join(dir, "library_index_"+rel+".sqlite")); err != nil {
		t0 := time.Now()
		buildEngineRelease(t, dir, rel, c.docs, 4)
		t.Logf("build: %v", time.Since(t0).Round(time.Millisecond))
	}
	base := NewLocal(filepath.Join(dir, "none.sqlite"), []byte("test-secret-key-32-bytes-long!!"), dummyMeta{})
	e, err := OpenFTS5Release(base, dir, rel)
	if err != nil {
		t.Fatalf("OpenFTS5Release: %v", err)
	}
	t.Cleanup(func() { _ = e.Close() })
	e.cache = newResultCache(0) // سنجش بدون کش نتایج
	return e
}

type zipfCase struct {
	name string
	gen  func(r *rand.Rand) Request
}

func TestZipfLatency(t *testing.T) {
	if os.Getenv("NOOR_BENCH") != "1" {
		t.Skip("NOOR_BENCH=1 برای اجرا")
	}
	nDocs := 160
	c := genZipfCorpus(17, nDocs, 30, 220)
	e := openZipfEngine(t, c)
	pick := func(r *rand.Rand, n int) []string {
		for {
			d := c.docs[r.Intn(len(c.docs))].Doc
			ps := c.words[d]
			p := ps[r.Intn(len(ps))]
			if len(p) > n {
				off := r.Intn(len(p) - n)
				return cp(p[off : off+n])
			}
		}
	}
	mid := func(r *rand.Rand) string { return c.vocab[200+r.Intn(1800)] }
	cases := []zipfCase{
		{"text/written 1w common", func(r *rand.Rand) Request {
			return Request{Query: c.vocab[3+r.Intn(10)], Mode: NormalizedPhrase}
		}},
		{"text/written 1w mid", func(r *rand.Rand) Request { return Request{Query: mid(r), Mode: NormalizedPhrase} }},
		{"text/exact 4w", func(r *rand.Rand) Request { return Request{Query: strings.Join(pick(r, 4), " "), Mode: StrictPhrase} }},
		{"text/written 3w", func(r *rand.Rand) Request {
			return Request{Query: strings.Join(pick(r, 3), " "), Mode: NormalizedPhrase}
		}},
		{"text/spelling 3w", func(r *rand.Rand) Request { return Request{Query: strings.Join(pick(r, 3), " "), Mode: Linguistic} }},
		{"text/similar 1w mid", func(r *rand.Rand) Request { return Request{Query: mid(r), Mode: Tiered} }},
		{"text/similar 3w", func(r *rand.Rand) Request { return Request{Query: strings.Join(pick(r, 3), " "), Mode: Tiered} }},
		{"text/similar 12w+1sub", func(r *rand.Rand) Request {
			ws := pick(r, 12)
			ws[r.Intn(12)] = c.vocab[r.Intn(len(c.vocab))]
			return Request{Query: strings.Join(ws, " "), Mode: Tiered}
		}},
		{"text/similar 40w+2del", func(r *rand.Rand) Request {
			ws := pick(r, 42)
			ws = append(ws[:10], ws[11:]...)
			ws = append(ws[:25], ws[26:]...)
			return Request{Query: strings.Join(ws, " "), Mode: Tiered}
		}},
		{"words/all 3w", func(r *rand.Rand) Request {
			return Request{Query: mid(r) + " " + mid(r) + " " + mid(r), Mode: AllWords}
		}},
		{"words/any 3w", func(r *rand.Rand) Request {
			return Request{Query: mid(r) + " " + mid(r) + " " + mid(r), Mode: AnyWords}
		}},
	}
	only := os.Getenv("NOOR_BENCH_CASE")
	iters := 25
	ctx := context.Background()
	for ci, cs := range cases {
		if only != "" && !strings.Contains(cs.name, only) {
			continue
		}
		r := rand.New(rand.NewSource(int64(100 + ci)))
		// گرم‌کردن (page cache و آماده‌سازی دستورها)
		for i := 0; i < 2; i++ {
			req := cs.gen(r)
			req.PageSize = 20
			req.Scope.Target = "library"
			if _, err := e.Search(ctx, &req, ""); err != nil {
				t.Fatal(err)
			}
		}
		var ds []time.Duration
		tot := 0
		for i := 0; i < iters; i++ {
			req := cs.gen(r)
			req.PageSize = 20
			req.Scope.Target = "library"
			st := time.Now()
			resp, err := e.Search(ctx, &req, "")
			if err != nil {
				t.Fatalf("%s: %v", cs.name, err)
			}
			ds = append(ds, time.Since(st))
			tot += resp.TotalResults
		}
		sort.Slice(ds, func(i, j int) bool { return ds[i] < ds[j] })
		pct := func(p int) time.Duration { return ds[(len(ds)-1)*p/100].Round(100 * time.Microsecond) }
		t.Logf("%-24s p50=%-9v p95=%-9v max=%-9v avg_results=%d", cs.name, pct(50), pct(95), ds[len(ds)-1].Round(100*time.Microsecond), tot/len(ds))
	}
}
