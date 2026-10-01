package search

// golden_test.go — اجرای مجموعهٔ طلایی روی موتور محلی (همیشه) و موتور OpenSearch
// (وقتی NOOR_GOLDEN_OS_URL تنظیم شده باشد) با همان فایل انتظارها — بند الف-۴ و ه-۱۳.

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"noor/internal/catalog"
	"noor/internal/index"
	"noor/internal/xmlparse"
)

const fixtureSources = "../../data/sources"
const goldenRelease = "rel-golden"
const goldenFile = "testdata/golden.json"

// catMeta آداپتور متادیتا برای آزمون (بدون وابستگی به httpapi).
type catMeta struct{ c *catalog.Service }

func (m catMeta) WorkTitle(uid string) (title, short, author string, ok bool) {
	w, ok2 := m.c.Work(uid)
	if !ok2 {
		return "", "", "", false
	}
	return w.Title, w.ShortTitle, w.Author, true
}

func (m catMeta) DocumentMeta(uid string) (workUID, label string, ok bool) {
	w, ok2 := m.c.WorkOfDocument(uid)
	if !ok2 {
		return "", "", false
	}
	d, ok3 := m.c.Document(uid)
	if !ok3 {
		return "", "", false
	}
	return w.UID, d.Label, true
}

func (m catMeta) SectionTitle(docUID, secUID string) (string, bool) {
	mm, err := m.c.Model(docUID)
	if err != nil {
		return "", false
	}
	var find func(secs []*xmlparse.SectionRec) (string, bool)
	find = func(secs []*xmlparse.SectionRec) (string, bool) {
		for _, sc := range secs {
			if sc.UID == secUID {
				return sc.Title, true
			}
			if t, ok2 := find(sc.Children); ok2 {
				return t, ok2
			}
		}
		return "", false
	}
	return find(mm.Sections)
}

// loadFixtureEngine نمایهٔ fixture را از صفر در پوشهٔ موقت می‌سازد (شامل trigram) —
// مستقل از index.sqlite زنده تا آزمون تکرارپذیر باشد.
func loadFixtureEngine(t *testing.T) (*LocalEngine, *catalog.Service) {
	t.Helper()
	cat, err := catalog.Load(fixtureSources)
	if err != nil {
		t.Fatalf("کاتالوگ fixture: %v", err)
	}
	path := filepath.Join(t.TempDir(), "index.sqlite")
	db, err := index.OpenWrite(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	w := &index.IndexWriter{DB: db}
	var docs []index.DocInput
	var titles []index.TitleRow
	seen := map[string]bool{}
	for _, wk := range cat.Works() {
		for _, d := range wk.Documents {
			m, err := cat.Model(d.UID)
			if err != nil {
				t.Fatalf("مدل سند %s: %v", d.UID, err)
			}
			docs = append(docs, index.DocInput{CollectionUID: "col-fixture", WorkUID: wk.UID, DocumentUID: d.UID, Language: d.Language, Model: m})
			if !seen[wk.UID] {
				seen[wk.UID] = true
				pub := ""
				if wk.Publisher != nil {
					pub = *wk.Publisher
				}
				titles = append(titles, index.TitleRow{WorkUID: wk.UID, Title: wk.Title, ShortTitle: wk.ShortTitle, Author: wk.Author, Publisher: pub, Language: wk.Language, Topics: wk.Topics})
			}
		}
	}
	n, err := w.Rebuild(goldenRelease, docs, titles, nil)
	if err != nil {
		t.Fatal(err)
	}
	if n < 50 {
		t.Fatalf("fixture باید ≥۵۰ passage بدهد؛ %d", n)
	}
	return NewLocal(path, []byte("golden-secret"), catMeta{cat}), cat
}

func runGolden(t *testing.T, eng Engine, c GoldenCase) *Response {
	t.Helper()
	resp, err := eng.Search(context.Background(), c.Request, goldenRelease)
	if err != nil {
		t.Fatalf("%s (%s): جست‌وجو شکست خورد: %v", c.ID, c.Note, err)
	}
	return resp
}

func expectOf(resp *Response) *GoldenExpect {
	e := &GoldenExpect{
		Occurrences:   resp.VerifiedOccurrences,
		Books:         resp.VerifiedBooks,
		Passages:      resp.VerifiedPassages,
		CountRelation: resp.CountRelation,
	}
	for i, r := range resp.Results {
		if i >= 3 {
			break
		}
		page := ""
		if r.Page.UID != "" {
			page = r.Page.UID
		} else {
			page = r.Page.Label
		}
		e.First = append(e.First, GoldenFirst{Doc: r.Document.UID, Match: r.MatchRange, Page: page})
	}
	return e
}

func loadGoldenFile(t *testing.T) []GoldenCase {
	t.Helper()
	raw, err := os.ReadFile(goldenFile)
	if err != nil {
		t.Fatalf("فایل طلایی نیست: %v — با cmd/goldengen بسازید", err)
	}
	var cs []GoldenCase
	if err := json.Unmarshal(raw, &cs); err != nil {
		t.Fatalf("golden.json نامعتبر: %v", err)
	}
	return cs
}

// TestGoldenSetLocal مجموعهٔ طلایی را روی موتور محلی می‌سنجد (ه-۱۳).
func TestGoldenSetLocal(t *testing.T) {
	cs := loadGoldenFile(t)
	if len(cs) < 100 {
		t.Fatalf("مجموعهٔ طلایی باید ≥۱۰۰ پرس‌وجو باشد؛ %d", len(cs))
	}
	groups := map[string]bool{}
	for _, c := range cs {
		groups[c.Group] = true
	}
	for _, g := range []string{"strict", "normalized", "all_words", "any_words", "near", "linguistic", "long_quote", "quran", "roles", "scope", "paging"} {
		if !groups[g] {
			t.Errorf("گروه %s در مجموعهٔ طلایی نیست", g)
		}
	}
	eng, _ := loadFixtureEngine(t)
	bad := 0
	for _, c := range cs {
		if c.Expect == nil {
			t.Errorf("%s بدون انتظار است", c.ID)
			continue
		}
		resp := runGolden(t, eng, c)
		got := expectOf(resp)
		if got.Occurrences != c.Expect.Occurrences {
			t.Errorf("%s (%s): مواضع=%d انتظار=%d", c.ID, c.Note, got.Occurrences, c.Expect.Occurrences)
			bad++
		}
		if got.Books != c.Expect.Books {
			t.Errorf("%s (%s): کتاب‌ها=%d انتظار=%d", c.ID, c.Note, got.Books, c.Expect.Books)
			bad++
		}
		if got.CountRelation != c.Expect.CountRelation {
			t.Errorf("%s (%s): count_relation=%s انتظار=%s", c.ID, c.Note, got.CountRelation, c.Expect.CountRelation)
			bad++
		}
		if len(got.First) != len(c.Expect.First) {
			t.Errorf("%s (%s): شمار شاهدها=%d انتظار=%d", c.ID, c.Note, len(got.First), len(c.Expect.First))
			bad++
		} else {
			for i := range got.First {
				if got.First[i] != c.Expect.First[i] {
					t.Errorf("%s (%s): شاهد %d = %+v انتظار %+v", c.ID, c.Note, i, got.First[i], c.Expect.First[i])
					bad++
				}
			}
		}
		if bad > 15 {
			t.Fatal("خطاهای بیش از حد — توقف زودهنگام")
		}
	}
}

// TestGoldenSetOpenSearchParity همان فایل را روی OpenSearch می‌سنجد (الف-۴).
// اجرا: NOOR_GOLDEN_OS_URL=http://127.0.0.1:9200 go test ./internal/search/ -run TestGoldenSetOpenSearchParity -v
func TestGoldenSetOpenSearchParity(t *testing.T) {
	osURL := os.Getenv("NOOR_GOLDEN_OS_URL")
	if osURL == "" {
		t.Skip("NOOR_GOLDEN_OS_URL تنظیم نشده — پاریتی OpenSearch حذف شد")
	}
	cs := loadGoldenFile(t)
	eng, _ := loadFixtureEngine(t)
	osEng, err := NewOpenSearch(osURL, os.Getenv("NOOR_GOLDEN_OS_USER"), os.Getenv("NOOR_GOLDEN_OS_PASS"), "noor-passages", eng)
	if err != nil {
		t.Fatalf("OpenSearch در %s در دسترس نیست: %v", osURL, err)
	}
	diff := 0
	for _, c := range cs {
		if c.Expect == nil {
			continue
		}
		resp, err := runGoldenSafe(osEng, c)
		if err != nil {
			t.Errorf("%s (%s): OpenSearch خطا داد: %v", c.ID, c.Note, err)
			diff++
			continue
		}
		got := expectOf(resp)
		// تطبیق مواضع/کتاب‌ها و شاهدها — تفاوت مجاز: هیچ (هر دو موتور باید یکی بدهند)
		if got.Occurrences != c.Expect.Occurrences || got.Books != c.Expect.Books {
			t.Errorf("پاریتی %s (%s): OS=%d/%d محلی=%d/%d", c.ID, c.Note,
				got.Occurrences, got.Books, c.Expect.Occurrences, c.Expect.Books)
			diff++
		} else if len(got.First) != len(c.Expect.First) {
			t.Errorf("پاریتی شاهدها %s (%s): OS=%d محلی=%d", c.ID, c.Note, len(got.First), len(c.Expect.First))
			diff++
		} else {
			for i := range got.First {
				if got.First[i].Doc != c.Expect.First[i].Doc || got.First[i].Match != c.Expect.First[i].Match {
					t.Errorf("پاریتی شاهد %s(%d): OS=%+v محلی=%+v", c.ID, i, got.First[i], c.Expect.First[i])
					diff++
				}
			}
		}
		if diff > 20 {
			t.Fatal("تفاوت‌های بیش از حد — توقف زودهنگام")
		}
	}
	if diff == 0 {
		t.Logf("پاریتی کامل: هر %d پرس‌وجوی طلایی در دو موتور یکسان است", len(cs))
	}
}

func runGoldenSafe(eng Engine, c GoldenCase) (*Response, error) {
	return eng.Search(context.Background(), c.Request, goldenRelease)
}

var _ = fmt.Sprintf
