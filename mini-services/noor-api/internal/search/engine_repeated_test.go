package search

// آزمون یکپارچگی موتور روی نمایهٔ واقعی (بدون سرویس HTTP):
// - عبارت دارای واژهٔ تکراری («وأن الرسول ما الرسول») باید تطبیق بدهد —
//   رگرسیون باگ پیش‌فیلتر کاندید (COUNT(DISTINCT) در برابر توکن‌های تکراری).
// - تطبیق باید روی متن واقعی همان نسخه تأیید شود (§۴۴) و هایلایت درست باشد.

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"

	"noor/internal/index"
	"noor/internal/xmlparse"
)

type fakeMeta struct{}

func (fakeMeta) WorkTitle(uid string) (title, short, author string, ok bool) {
	if uid == "w-t" {
		return "کار آزمون", "کار", "مؤلف آزمون", true
	}
	return "", "", "", false
}

func (fakeMeta) DocumentMeta(uid string) (workUID, label string, ok bool) {
	if uid == "d-t" {
		return "w-t", "ج ۱", true
	}
	return "", "", false
}

func (fakeMeta) SectionTitle(docUID, secUID string) (string, bool) { return "", false }

func buildTestIndex(t *testing.T) (*LocalEngine, func()) {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "idx.sqlite")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("بازکردن نمایه: %v", err)
	}
	body := "كانت الأنبياء أرسلوا للناس وأن الرسول ما الرسول وما النبي فرقٌ بينهما في القول."
	model := &xmlparse.DocModel{
		DocumentUID: "d-t",
		Text:        body,
		Blocks: []xmlparse.Block{
			{ID: "b-1", Type: "hadith_body", Text: body, SourceOffsets: [2]int{0, len([]rune(body))}},
		},
	}
	w := &index.IndexWriter{DB: db}
	if _, err := w.Rebuild("rel-t", []index.DocInput{{
		CollectionUID: "c-t", WorkUID: "w-t", DocumentUID: "d-t", Language: "ar", Model: model,
	}}, []index.TitleRow{{WorkUID: "w-t", Title: "کار آزمون", ShortTitle: "کار", Author: "مؤلف آزمون", Language: "ar"}}, nil); err != nil {
		t.Fatalf("ساخت نمایه: %v", err)
	}
	eng := NewLocal(path, []byte("test-secret"), fakeMeta{})
	cleanup := func() { _ = db.Close() }
	return eng, cleanup
}

func runSearch(t *testing.T, eng *LocalEngine, query, mode string) *Response {
	t.Helper()
	resp, err := eng.Search(context.Background(), &Request{
		Query:    query,
		Mode:     mode,
		Scope:    Scope{Target: "library"},
		PageSize: 10,
	}, "rel-t")
	if err != nil {
		t.Fatalf("جست‌وجو: %v", err)
	}
	return resp
}

func TestPhraseWithRepeatedWord(t *testing.T) {
	eng, cleanup := buildTestIndex(t)
	defer cleanup()

	// رگرسیون باگ پیش‌فیلتر: واژهٔ «الرسول» در عبارت دو بار آمده است
	resp := runSearch(t, eng, "وأن الرسول ما الرسول", NormalizedPhrase)
	if resp.VerifiedOccurrences != 1 {
		t.Errorf("عبارت با واژهٔ تکراری باید ۱ تطبیق بدهد؛ گرفت %d", resp.VerifiedOccurrences)
	}

	// کل بدنهٔ روایت (شامل واژهٔ تکراری) نیز باید تطبیق بدهد
	full := "كانت الأنبياء أرسلوا للناس وأن الرسول ما الرسول وما النبي فرقٌ بينهما في القول."
	resp = runSearch(t, eng, full, NormalizedPhrase)
	if resp.VerifiedOccurrences != 1 {
		t.Errorf("بدنهٔ کامل باید ۱ تطبیق بدهد؛ گرفت %d", resp.VerifiedOccurrences)
	}

	// هایلایت باید دقیقاً روی خود عبارت بیفتد (code point در متن اصل)
	if len(resp.Results) == 1 {
		hl := resp.Results[0].Highlight
		if len(hl) == 0 {
			t.Fatal("هایلایت نباید خالی باشد")
		}
		orig := []rune(resp.Results[0].Snippet)
		if hl[0].Start < 0 || hl[0].End > len(orig) || hl[0].End <= hl[0].Start {
			t.Fatalf("بازهٔ هایلایت نامعتبر: %+v (طول %d)", hl, len(orig))
		}
		got := string(orig[hl[0].Start:hl[0].End])
		if got != full {
			t.Errorf("هایلایت باید خود عبارت باشد؛ گرفت %q", got)
		}
	}
}

func TestAllWordsWithRepeatedToken(t *testing.T) {
	eng, cleanup := buildTestIndex(t)
	defer cleanup()
	// حالت all_words با توکن تکراری هم نباید بی‌نتیجه بماند
	resp := runSearch(t, eng, "الرسول الرسول", AllWords)
	if resp.VerifiedOccurrences != 1 {
		t.Errorf("all_words با توکن تکراری باید ۱ تطبیق بدهد؛ گرفت %d", resp.VerifiedOccurrences)
	}
}
