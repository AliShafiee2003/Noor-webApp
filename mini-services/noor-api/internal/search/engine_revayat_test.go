package search

// آزمون انتقال revayat_index از مدل سند تا Result جست‌وجو (HAD-08):
// - بلوک دارای HadithUID و RevayatIndex باید شمارهٔ روایت را در نتیجه برگرداند؛
// - passage بدون روایت نباید revayat_index داشته باشد (omitempty).
// رگرسیون: ستون تازهٔ جدول passages نباید اسکن کاندیدها را بشکند
// (SELECT صریح ستون‌ها — نه ترتیب فیزیکی جدول).

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"

	"noor/internal/index"
	"noor/internal/xmlparse"
)

func buildRevayatTestIndex(t *testing.T) (*LocalEngine, func()) {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "idx.sqlite")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("بازکردن نمایه: %v", err)
	}
	hadith := "كانت الأنبياء أرسلوا للناس وأن الرسول ما الرسول وما النبي فرقٌ بينهما في القول."
	essay := "في كتابِ الحجِّ نُقلَ أنَّ الكعبة بيت الله قبلة الناس."
	model := &xmlparse.DocModel{
		DocumentUID: "d-t",
		Text:        hadith + "\n" + essay,
		Blocks: []xmlparse.Block{
			{ID: "b-1", Type: "hadith_body", Text: hadith, HadithUID: "h-9", RevayatIndex: "۱۱۲", SourceOffsets: [2]int{0, len([]rune(hadith))}},
			{ID: "b-2", Type: "p", Text: essay, SourceOffsets: [2]int{len([]rune(hadith)) + 1, len([]rune(hadith)) + 1 + len([]rune(essay))}},
		},
		// دو صفحهٔ جدا تا دو passage جدا ساخته شود (تجمیع صفحه‌ای نقض می‌شود وگرنه)
		Pages: []xmlparse.PageRec{
			{UID: "p-1", Label: "۱", Serial: 0, StartBlock: 0, EndBlock: 0},
			{UID: "p-2", Label: "۲", Serial: 1, StartBlock: 1, EndBlock: 1},
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

func TestResultCarriesRevayatIndex(t *testing.T) {
	eng, cleanup := buildRevayatTestIndex(t)
	defer cleanup()

	// تطبیق درون روایت: revayat_index باید «۱۱۲» باشد
	resp, err := eng.Search(context.Background(), &Request{
		Query: "وأن الرسول ما الرسول", Mode: NormalizedPhrase,
		Scope: Scope{Target: "library"}, PageSize: 10,
	}, "rel-t")
	if err != nil {
		t.Fatalf("جست‌وجوی درون روایت: %v", err)
	}
	if resp.VerifiedOccurrences != 1 {
		t.Fatalf("انتظار ۱ تطبیق درون روایت؛ گرفت %d", resp.VerifiedOccurrences)
	}
	if resp.Results[0].RevayatIndex != "۱۱۲" {
		t.Errorf("revayat_index نتیجه باید «۱۱۲» باشد؛ گرفت %q", resp.Results[0].RevayatIndex)
	}
	if resp.Results[0].LocalHadith != "d-t:h-9" {
		t.Errorf("local_hadith_uid باید «d-t:h-9» باشد؛ گرفت %q", resp.Results[0].LocalHadith)
	}

	// تطبیق بیرون روایت: revayat_index نباید باشد
	resp2, err := eng.Search(context.Background(), &Request{
		Query: "الكعبة بيت الله", Mode: NormalizedPhrase,
		Scope: Scope{Target: "library"}, PageSize: 10,
	}, "rel-t")
	if err != nil {
		t.Fatalf("جست‌وجوی بیرون روایت: %v", err)
	}
	if resp2.VerifiedOccurrences != 1 {
		t.Fatalf("انتظار ۱ تطبیق بیرون روایت؛ گرفت %d", resp2.VerifiedOccurrences)
	}
	if resp2.Results[0].RevayatIndex != "" {
		t.Errorf("passage بدون روایت نباید revayat_index داشته باشد؛ گرفت %q", resp2.Results[0].RevayatIndex)
	}
}
