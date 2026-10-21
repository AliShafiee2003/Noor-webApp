package search

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"noor/internal/index"
	"noor/internal/norm"
	"noor/internal/xmlparse"
)

type dummyMeta struct{}

func (d dummyMeta) WorkTitle(uid string) (string, string, string, bool) {
	return "بحار الأنوار", "بحار", "العلامة المجلسي", true
}
func (d dummyMeta) DocumentMeta(uid string) (string, string, bool) {
	return "w-" + strings.TrimPrefix(uid, "d-"), "جلد ۱", true
}
func (d dummyMeta) SectionTitle(docUID, secUID string) (string, bool) {
	return "باب", true
}

// testDoc سند آزمونی: هر عنصر Items یک item XML است.
type testDoc struct {
	Collection, Work, Doc, Lang string
	Items                       []string
}

var engineCorpus = []testDoc{
	{"c-01", "w-01", "d-01", "ar", []string{
		`<hadith id="h-101" revayatindex="112"><sanadHadith>عن أبي <G n="أبيه">أبيه</G> قال</sanadHadith><p>قَالَ‌ رَسُولُ‌ اللَّهِ‌: إِيَّاكُمْ‌ وَ مُحَدَّثَاتِ‌ الأُمُورِ فَإِنَّ‌ كُلَّ‌ مُحْدَثَةٍ‌ بِدْعَةٌ‌ وَ كُلَّ‌ بِدْعَةٍ‌ ضَلاَلَةٌ‌</p></hadith>`,
	}},
	{"c-01", "w-02", "d-02", "fa", []string{
		`<p>علامه مجلسی در شرح این حدیث شریف می‌گوید که بدعت در دین گمراهی است و پیامبر اکرم پیروان خود را از نوآوری‌های باطل برحذر داشته است.</p>`,
	}},
	{"c-02", "w-03", "d-03", "ar", []string{
		`<p>قال أمير المؤمنين عليه السلام: العلم خير من المال، العلم يحرسك وأنت تحرس المال.</p>`,
		`<p>وقال في موضع آخر: العِلْمُ خَيْرٌ مِنَ المَالِ لأن المال تنقصه النفقة.</p>`,
		`<p>ثم قال: فالعلم خير من المال والعلم حاكم والمال محكوم عليه.</p>`,
		`<p>قال الله تعالى: وَأَقِيمُوا الصَّلَوٰةَ وَآتُوا الزَّكَوٰةَ وَارْكَعُوا مَعَ الرَّاكِعِينَ.</p>`,
		`<p>قال الشيخ: هذه المسألة مهمة جدا عند الفقهاء.</p>`,
	}},
	{"c-02", "w-04", "d-04", "ar", []string{
		`<p>قال الإمام الصادق عليه السلام: إن العالم إذا لم يعمل بعلمه زلت موعظته عن القلوب كما يزل المطر عن الصفا، وإن الجاهل إذا عمل بغير علم كان ما يفسد أكثر مما يصلح، فاطلبوا العلم من معادنه وخذوا الحكمة من أهلها.</p>`,
		`<p>قال: قال: قال: قال: قال: قال: قال الراوي ذلك.</p>`,
	}},
}

func buildEngineRelease(t *testing.T, dir, rel string, docs []testDoc, shards int) {
	t.Helper()
	w, err := index.NewFTSIndexWriter(index.FTSShardOptions{ReleaseUID: rel, OutputDir: dir, NumShards: shards})
	if err != nil {
		t.Fatalf("NewFTSIndexWriter: %v", err)
	}
	defer w.Close()
	var titles []index.TitleRow
	for _, d := range docs {
		var items []xmlparse.ItemInput
		for i, x := range d.Items {
			items = append(items, xmlparse.ItemInput{ID: int64(i + 1), XML: x})
		}
		m, err := xmlparse.ParseItems(d.Doc, items)
		if err != nil {
			t.Fatalf("ParseItems %s: %v", d.Doc, err)
		}
		if _, err := w.WriteDocument(rel, d.Collection, d.Work, d.Doc, d.Lang, m); err != nil {
			t.Fatalf("WriteDocument %s: %v", d.Doc, err)
		}
		titles = append(titles, index.TitleRow{WorkUID: d.Work, Title: "بحار الأنوار " + d.Work, ShortTitle: "بحار", Author: "المجلسي", Language: d.Lang})
	}
	if err := w.Finalize(titles); err != nil {
		t.Fatalf("Finalize: %v", err)
	}
}

func newTestEngine(t *testing.T, docs []testDoc) (*FTS5Engine, string) {
	t.Helper()
	dir := t.TempDir()
	rel := "rel-test-e2e"
	buildEngineRelease(t, dir, rel, docs, 2)
	base := NewLocal(filepath.Join(dir, "none.sqlite"), []byte("test-secret-key-32-bytes-long!!"), dummyMeta{})
	e, err := OpenFTS5Release(base, dir, rel)
	if err != nil {
		t.Fatalf("OpenFTS5Release: %v", err)
	}
	t.Cleanup(func() { _ = e.Close() })
	return e, rel
}

func search(t *testing.T, e *FTS5Engine, req Request) *Response {
	t.Helper()
	resp, err := e.Search(context.Background(), &req, "")
	if err != nil {
		t.Fatalf("Search(%q, %s): %v", req.Query, req.Mode, err)
	}
	return resp
}

func docsOf(resp *Response) map[string]int {
	m := map[string]int{}
	for _, r := range resp.Results {
		m[r.Document.UID]++
	}
	return m
}

func layersOf(resp *Response) map[string]int {
	m := map[string]int{}
	for _, r := range resp.Results {
		m[r.Layer]++
	}
	return m
}

func TestFTS5EngineEndToEnd(t *testing.T) {
	e, rel := newTestEngine(t, engineCorpus)

	t.Run("normalized bigram phrase", func(t *testing.T) {
		resp := search(t, e, Request{Query: "رسول الله", Mode: NormalizedPhrase})
		if resp.VerifiedOccurrences != 1 || len(resp.Results) != 1 {
			t.Fatalf("want 1 result, got %d (%+v)", resp.VerifiedOccurrences, docsOf(resp))
		}
		r := resp.Results[0]
		if r.Document.UID != "d-01" || !strings.Contains(norm.Fold(r.Snippet), "رسول") {
			t.Errorf("bad result: %+v", r)
		}
		if resp.ReleaseUID != rel || !strings.HasPrefix(resp.Engine, "fts5 ") {
			t.Errorf("release/engine: %q %q", resp.ReleaseUID, resp.Engine)
		}
	})

	t.Run("strict with diacritics", func(t *testing.T) {
		resp := search(t, e, Request{Query: "قَالَ‌ رَسُولُ‌ اللَّهِ‌", Mode: StrictPhrase})
		if len(resp.Results) != 1 {
			t.Fatalf("strict: want 1, got %d", len(resp.Results))
		}
		// strict بدون اعراب نباید متن اعراب‌دار را «عین متن» بداند
		resp = search(t, e, Request{Query: "قال رسول الله", Mode: StrictPhrase})
		if len(resp.Results) != 0 {
			t.Errorf("strict without diacritics should not match vocalized text, got %d", len(resp.Results))
		}
	})

	t.Run("Persian ZWNJ variants", func(t *testing.T) {
		for _, q := range []string{"می گوید که بدعت", "میگوید که بدعت", "می‌گوید که بدعت"} {
			resp := search(t, e, Request{Query: q, Mode: NormalizedPhrase})
			if docsOf(resp)["d-02"] != 1 {
				t.Errorf("%q: want d-02, got %+v", q, docsOf(resp))
			}
		}
	})

	t.Run("linguistic L3: proclitic, hamza, ta marbuta, Quranic", func(t *testing.T) {
		resp := search(t, e, Request{Query: "اقیموا الصلاة", Mode: Linguistic})
		if docsOf(resp)["d-03"] != 1 {
			t.Fatalf("Quranic spelling: got %+v", docsOf(resp))
		}
		if resp.Results[0].Layer != "L3" || len(resp.Results[0].Diffs) == 0 {
			t.Errorf("want L3 with diffs, got %s %v", resp.Results[0].Layer, resp.Results[0].Diffs)
		}
		resp = search(t, e, Request{Query: "هذه المساله مهمه", Mode: Linguistic})
		if docsOf(resp)["d-03"] != 1 {
			t.Errorf("hamza/ة: got %+v", docsOf(resp))
		}
		// normalized نباید همزه/ة را یکسان بگیرد (L2 فقط)
		resp = search(t, e, Request{Query: "هذه المساله مهمه", Mode: StrictPhrase})
		if len(resp.Results) != 0 {
			t.Errorf("strict must not fold hamza: %d", len(resp.Results))
		}
	})

	t.Run("tiered layers and counts", func(t *testing.T) {
		resp := search(t, e, Request{Query: "العلم خير من المال", Mode: Tiered})
		lc := layersOf(resp)
		if lc["L1"] < 1 || lc["L2"] < 1 || lc["L3"] < 1 {
			t.Fatalf("want L1, L2, L3 hits; got %+v (%+v)", lc, resp.LayerCounts)
		}
		for l, n := range lc {
			if resp.LayerCounts[l] != n {
				t.Errorf("layer_counts[%s]=%d; results=%d", l, resp.LayerCounts[l], n)
			}
		}
		if resp.Results[0].Layer != "L1" {
			t.Errorf("L1 should rank first, got %s", resp.Results[0].Layer)
		}
		var l3 *Result
		for i := range resp.Results {
			if resp.Results[i].Layer == "L3" {
				l3 = &resp.Results[i]
			}
		}
		if l3 == nil || !strings.Contains(strings.Join(l3.Diffs, " "), "ف") {
			t.Errorf("L3 diff should mention proclitic ف: %+v", l3)
		}
		if resp.VerifiedOccurrences != lc["L1"]+lc["L2"]+lc["L3"] {
			t.Errorf("verified_occurrences=%d must count only L1–L3", resp.VerifiedOccurrences)
		}
	})

	t.Run("L4 similar quote with edits", func(t *testing.T) {
		// حذف «عليه السلام»، جانشینی «يعمل»→«يعمر»، جابه‌جایی دو واژه
		q := "إن العالم إذا لم يعمر بعلمه زلت موعظته عن القلوب يزل كما المطر عن الصفا"
		resp := search(t, e, Request{Query: q, Mode: SimilarQuote})
		var hit *Result
		for i := range resp.Results {
			if resp.Results[i].Document.UID == "d-04" {
				hit = &resp.Results[i]
				break
			}
		}
		if hit == nil {
			t.Fatalf("L4: d-04 not found: %+v", docsOf(resp))
		}
		if hit.Layer != "L4" || hit.Similarity == nil {
			t.Fatalf("want L4 with similarity, got %s %+v", hit.Layer, hit.Similarity)
		}
		s := hit.Similarity
		if s.Score < 0.7 || s.Score >= 1 || len(s.Diffs) == 0 || s.Counts.Total() == 0 {
			t.Errorf("similarity: %+v", s)
		}
		if resp.SimilarOccurrences == 0 || resp.VerifiedOccurrences != 0 {
			t.Errorf("L4 must be counted separately: verified=%d similar=%d", resp.VerifiedOccurrences, resp.SimilarOccurrences)
		}
		if resp.SimilarCoverage == "" {
			t.Error("similar_coverage missing")
		}
	})

	t.Run("L5 near spelling only on opt-in", func(t *testing.T) {
		resp := search(t, e, Request{Query: "محدثاث", Mode: Tiered})
		if len(resp.Results) != 0 {
			t.Fatalf("without near_spelling: want 0, got %d", len(resp.Results))
		}
		resp = search(t, e, Request{Query: "محدثاث", Mode: Tiered, NearSpelling: true})
		if len(resp.Results) == 0 || resp.Results[0].Layer != "L5" {
			t.Fatalf("near_spelling: want L5, got %+v", layersOf(resp))
		}
		if resp.VerifiedOccurrences != 0 || resp.SimilarOccurrences == 0 {
			t.Errorf("L5 must not be counted as certain: %d/%d", resp.VerifiedOccurrences, resp.SimilarOccurrences)
		}
	})

	t.Run("prefix query", func(t *testing.T) {
		resp := search(t, e, Request{Query: "محدث*", Mode: NormalizedPhrase})
		if docsOf(resp)["d-01"] < 1 {
			t.Errorf("prefix: got %+v", docsOf(resp))
		}
	})

	t.Run("diacritics respect", func(t *testing.T) {
		resp := search(t, e, Request{Query: "رَسُولُ اللَّهِ", Mode: NormalizedPhrase, Diacritics: "respect"})
		if len(resp.Results) != 1 {
			t.Errorf("compatible marks: want 1, got %d", len(resp.Results))
		}
		resp = search(t, e, Request{Query: "رَسُولَ اللَّهِ", Mode: NormalizedPhrase, Diacritics: "respect"})
		if len(resp.Results) != 0 {
			t.Errorf("conflicting marks: want 0, got %d", len(resp.Results))
		}
		resp = search(t, e, Request{Query: "رَسُولَ اللَّهِ", Mode: NormalizedPhrase})
		if len(resp.Results) != 1 {
			t.Errorf("ignore: want 1, got %d", len(resp.Results))
		}
	})

	t.Run("any_words and all_words", func(t *testing.T) {
		resp := search(t, e, Request{Query: "ضلالة الراکعین", Mode: AnyWords})
		d := docsOf(resp)
		if d["d-01"] == 0 || d["d-03"] == 0 {
			t.Errorf("any_words: got %+v", d)
		}
		resp = search(t, e, Request{Query: "ضلالة الراکعین", Mode: AllWords})
		if len(resp.Results) != 0 {
			t.Errorf("all_words across docs: want 0, got %+v", docsOf(resp))
		}
		resp = search(t, e, Request{Query: "المال العلم", Mode: AllWords})
		if docsOf(resp)["d-03"] == 0 {
			t.Errorf("all_words same passage: got %+v", docsOf(resp))
		}
	})

	t.Run("scope filters", func(t *testing.T) {
		w := "w-03"
		resp := search(t, e, Request{Query: "قال", Mode: NormalizedPhrase, PageSize: 50, Scope: Scope{Target: "work", WorkUID: &w}})
		for doc := range docsOf(resp) {
			if doc != "d-03" {
				t.Errorf("work scope leaked %s", doc)
			}
		}
		if len(resp.Results) == 0 {
			t.Error("work scope: no results")
		}
		resp = search(t, e, Request{Query: "قال", Mode: NormalizedPhrase, PageSize: 50, Scope: Scope{Target: "collection", CollectionUIDs: []string{"c-01"}}})
		for doc := range docsOf(resp) {
			if doc != "d-01" {
				t.Errorf("collection scope leaked %s", doc)
			}
		}
	})

	t.Run("pagination and books from same release", func(t *testing.T) {
		resp := search(t, e, Request{Query: "قال", Mode: NormalizedPhrase, PageSize: 5})
		if !resp.ContinuationAvailable || resp.NextCursor == "" {
			t.Fatalf("expected continuation; total=%d", resp.TotalResults)
		}
		seen := map[string]bool{}
		for _, r := range resp.Results {
			seen[fmt.Sprint(r.PassageUID, r.MatchRange)] = true
		}
		next, err := e.Continue(context.Background(), resp.SessionUID, resp.NextCursor, "")
		if err != nil {
			t.Fatalf("Continue: %v", err)
		}
		if next.ReleaseUID != resp.ReleaseUID || len(next.Results) == 0 {
			t.Fatalf("Continue: release %s results %d", next.ReleaseUID, len(next.Results))
		}
		for _, r := range next.Results {
			if seen[fmt.Sprint(r.PassageUID, r.MatchRange)] {
				t.Errorf("duplicate across pages: %s", r.PassageUID)
			}
		}
		books, err := e.BooksGrouped(context.Background(), resp.SessionUID)
		if err != nil {
			t.Fatalf("BooksGrouped: %v", err)
		}
		total := 0
		for _, b := range books {
			for _, d := range b.Documents {
				total += d.VerifiedOccurrences
			}
		}
		if total != resp.VerifiedOccurrences {
			t.Errorf("books total %d ≠ verified %d", total, resp.VerifiedOccurrences)
		}
	})

	t.Run("negative query", func(t *testing.T) {
		for _, mode := range []string{NormalizedPhrase, Linguistic, Tiered} {
			resp := search(t, e, Request{Query: "اینترنت و وب‌اپلیکیشن در مریخ", Mode: mode})
			if len(resp.Results) != 0 {
				t.Errorf("%s: want 0, got %d", mode, len(resp.Results))
			}
		}
	})

	t.Run("titles", func(t *testing.T) {
		hits, err := e.SearchTitles(context.Background(), "بحار", 10)
		if err != nil || len(hits) == 0 {
			t.Fatalf("SearchTitles: %v %d", err, len(hits))
		}
	})

	t.Run("shard failure is an error, not partial results", func(t *testing.T) {
		e2, _ := newTestEngine(t, engineCorpus)
		_ = e2.cur.shards[1].Close()
		_ = e2.cur.shards[0].Close()
		req := Request{Query: "قال", Mode: NormalizedPhrase}
		if _, err := e2.Search(context.Background(), &req, ""); err == nil {
			t.Fatal("closed shards must produce an error")
		}
	})
}

func TestFTS5OpenRejectsCorruptRelease(t *testing.T) {
	dir := t.TempDir()
	rel := "rel-bad"
	buildEngineRelease(t, dir, rel, engineCorpus[:1], 2)
	if err := os.Truncate(filepath.Join(dir, index.FTSShardFile(rel, 1)), 512); err != nil {
		t.Fatal(err)
	}
	base := NewLocal(filepath.Join(dir, "none.sqlite"), []byte("test-secret-key-32-bytes-long!!"), dummyMeta{})
	if _, err := OpenFTS5Release(base, dir, rel); err == nil {
		t.Fatal("opening a truncated shard must fail")
	}
}

func TestFTS5ReleaseSwitchAndRollback(t *testing.T) {
	data := t.TempDir()
	docA := []testDoc{{"c-01", "w-01", "d-01", "ar", []string{`<p>قال الراوي حدثنا أبو بصير في الكوفة</p>`}}}
	docB := []testDoc{{"c-01", "w-01", "d-01", "ar", []string{`<p>قال الراوي حدثنا زرارة في المدينة</p>`}}}
	for rel, docs := range map[string][]testDoc{"rel-a": docA, "rel-b": docB} {
		buildEngineRelease(t, index.FTSBuildingDir(data, rel), rel, docs, 2)
		if err := index.CommitFTSBuild(data, rel); err != nil {
			t.Fatal(err)
		}
	}
	if err := index.PublishFTSRelease(data, "rel-a", 2); err != nil {
		t.Fatal(err)
	}
	base := NewLocal(filepath.Join(data, "none.sqlite"), []byte("test-secret-key-32-bytes-long!!"), dummyMeta{})
	e, err := OpenFTS5FromDir(base, data)
	if err != nil {
		t.Fatal(err)
	}
	defer e.Close()
	ctx := context.Background()
	req := Request{Query: "قال", Mode: NormalizedPhrase, PageSize: 5}
	ra, err := e.Search(ctx, &req, "")
	if err != nil || ra.ReleaseUID != "rel-a" {
		t.Fatalf("search on rel-a: %v %+v", err, ra)
	}
	if err := index.PublishFTSRelease(data, "rel-b", 2); err != nil {
		t.Fatal(err)
	}
	e.mu.Lock()
	e.lastCheck = time.Time{}
	e.mu.Unlock()
	req2 := Request{Query: "زرارة", Mode: NormalizedPhrase}
	rb, err := e.Search(ctx, &req2, "")
	if err != nil || rb.ReleaseUID != "rel-b" || len(rb.Results) != 1 {
		t.Fatalf("after publish: %v release=%s n=%d", err, rb.ReleaseUID, len(rb.Results))
	}
	// نشست پیشین همچنان روی نسل خودش (rel-a) پاسخ می‌دهد
	books, err := e.BooksGrouped(ctx, ra.SessionUID)
	if err != nil || len(books) != 1 {
		t.Fatalf("old session books: %v %d", err, len(books))
	}
	// نسل حذف‌شده → Gone (۴۱۰)، نه نتایج نسل دیگر
	e.mu.Lock()
	if e.prev != nil {
		e.prev.retire()
		e.prev = nil
	}
	e.mu.Unlock()
	if err := os.RemoveAll(index.FTSReleaseDir(data, "rel-a")); err != nil {
		t.Fatal(err)
	}
	_, err = e.BooksGrouped(ctx, ra.SessionUID)
	var gone *GoneError
	if !errors.As(err, &gone) {
		t.Fatalf("missing release must be Gone, got %v", err)
	}
	// rollback به نسل پیشین (اگر هنوز وجود داشته باشد) — اینجا حذف شده و باید خطا بدهد یا rel-a برگردد
	if prev, err := index.RollbackFTSRelease(data); err == nil && prev == "rel-a" {
		if _, statErr := os.Stat(index.FTSReleaseDir(data, "rel-a")); statErr != nil {
			t.Error("rollback must not point ACTIVE to a missing release")
		}
	}
}
