package search

import (
	"context"
	"math/rand"
	"reflect"
	"testing"
)

// TestWindowPassagesMatchesPerWindowQuery پرس‌وجوی خوشه‌ای پنجره‌ها باید دقیقاً همان seqهای
// پرس‌وجوی قدیمی تک‌پنجره (stream_end > start AND stream_start < end ORDER BY stream_start) را بدهد.
func TestWindowPassagesMatchesPerWindowQuery(t *testing.T) {
	c := genZipfCorpus(5, 6, 25, 60)
	e, _ := newTestEngine(t, c.docs)
	rel, err := e.acquireCurrent()
	if err != nil {
		t.Fatal(err)
	}
	defer rel.releaseRef()
	ctx := context.Background()
	r := rand.New(rand.NewSource(9))
	var wins []simWindow
	for i := 0; i < 400; i++ {
		d := rel.docs[r.Intn(len(rel.docs))]
		n := d.StreamLen
		s := r.Intn(n+20) - 10
		w := simWindow{doc: d.Ord, start: s, end: s + 1 + r.Intn(120)}
		if r.Intn(5) == 0 {
			w.start = w.end // پنجرهٔ تهی
		}
		wins = append(wins, w)
	}
	got, err := windowPassages(ctx, rel.main, wins)
	if err != nil {
		t.Fatal(err)
	}
	for i, w := range wins {
		rows, err := rel.main.QueryContext(ctx, `SELECT seq FROM passages WHERE doc_ord = ? AND stream_end > ? AND stream_start < ? ORDER BY stream_start`, w.doc, w.start, w.end)
		if err != nil {
			t.Fatal(err)
		}
		var want []int64
		for rows.Next() {
			var s int64
			_ = rows.Scan(&s)
			want = append(want, s)
		}
		rows.Close()
		if !reflect.DeepEqual(got[i], want) {
			t.Fatalf("window %+v: got %v want %v", w, got[i], want)
		}
	}
}
