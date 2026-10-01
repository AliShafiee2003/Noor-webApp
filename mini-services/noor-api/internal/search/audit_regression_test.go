package search

// رگرسیون یافته‌های ممیزی نسخهٔ ۲ که در round-16 رفع شدند — انتظار: رفتار مطلوب.

import (
	"context"
	"strings"
	"testing"
	"time"

	"noor/internal/index"
	"noor/internal/xmlparse"
)

// E3/SEARCH-03: بازهٔ آیه با مقایسهٔ عددی (قبلاً لغوی بود و ۲..۱۰ می‌شکست).
func TestAuditE3NumericRange(t *testing.T) {
	if !between("2", "10", "2") || !between("2", "10", "9") || !between("2", "10", "10") {
		t.Fatal("مرزها/داخل بازهٔ ۲..۱۰ باید عددی قبول شوند")
	}
	if between("2", "10", "11") || between("10", "2", "5") {
		t.Fatal("خارج بازه/بازهٔ وارونه باید رد شود")
	}
	// E3b: تک‌آیه با ارقام عربی/فارسی روی استناد لاتین
	if !ayaEq("255", "٢٥٥") || !ayaEq("255", "۲۵۵") {
		t.Fatal("وارینت‌های رقم آیه باید برابر باشند")
	}
	if ayaEq("25", "255") || ayaEq("", "5") {
		t.Fatal("نابرابری/ورودی خالی نباید قبول شود")
	}
}

// E7/SEARCH-07: پرس‌وجوی بی‌توکن باید صادقانه complete/exact باشد، نه پیام سقف.
func TestAuditZeroTokenHonesty(t *testing.T) {
	path, cleanup := buildMultiTextIndex(t, []string{"متن سادهٔ آزمون"})
	defer cleanup()
	eng := NewLocal(path, []byte("k"), fakeMeta{})
	resp, err := eng.Search(context.Background(), &Request{Query: "،،؛؛", Mode: NormalizedPhrase, Scope: Scope{Target: "library"}}, "rel-test")
	if err != nil {
		t.Fatal(err)
	}
	if resp.CompletionState != "complete" || resp.CountRelation != "exact" || len(resp.Results) != 0 {
		t.Fatalf("بی‌توکن: complete/exact/0 انتظار؛ گرفت %s/%s/%d", resp.CompletionState, resp.CountRelation, len(resp.Results))
	}
	if !strings.Contains(resp.Notice, "واژه‌ای نداشت") {
		t.Fatalf("Notice صادقانه انتظار می‌رفت: %q", resp.Notice)
	}
}

// SEARCH-01: اشباع سقف کاندید → partial/lower_bound (هرگز complete/exact).
func TestAuditCandidateCapHonesty(t *testing.T) {
	var texts []string
	for i := 0; i < 6; i++ {
		texts = append(texts, "عبارت جست‌وجو در این خط آمده است و ادامه دارد")
	}
	path, cleanup := buildMultiTextIndex(t, texts)
	defer cleanup()
	eng := NewLocal(path, []byte("k"), fakeMeta{}, WithCandidateCap(2), WithLimits(1000, time.Minute))
	resp, err := eng.Search(context.Background(), &Request{Query: "عبارت جست‌وجو", Mode: NormalizedPhrase, Scope: Scope{Target: "library"}}, "rel-test")
	if err != nil {
		t.Fatal(err)
	}
	if resp.CompletionState != "partial" || resp.CountRelation != "lower_bound" {
		t.Fatalf("اشباع کاندید: partial/lower_bound انتظار؛ گرفت %s/%s", resp.CompletionState, resp.CountRelation)
	}
}

// SEARCH-02: عبارتِ دقیقاً مجاور مرز دو بلوک متوالی باید یک‌بار یافت شود
// (گذرنده از مرز قطعه — پیش از fix هرگز بازیابی نمی‌شد).
func TestAuditAdjacentChunkBoundaryPhrase(t *testing.T) {
	filler := strings.Repeat("پ ", 2000)
	b0 := filler + "عبارت مرزی"  // پایان بلوک اول
	b1 := "یکتای مرزی " + filler // آغاز بلوک دوم
	l0 := len([]rune(b0))
	blocks := []xmlparse.Block{
		{ID: "b-000", Type: "hadith_body", Text: b0, SourceOffsets: [2]int{0, l0}},
		{ID: "b-001", Type: "hadith_body", Text: b1, SourceOffsets: [2]int{l0 + 1, l0 + 1 + len([]rune(b1))}},
	}
	pages := []xmlparse.PageRec{{UID: "p-001", Label: "1", Num: "1", Serial: 0, StartBlock: 0, EndBlock: 1}}
	m := &xmlparse.DocModel{DocumentUID: "d-b", Blocks: blocks, Pages: pages}
	path, cleanup := buildModelIndex(t, m)
	defer cleanup()
	eng := NewLocal(path, []byte("k"), fakeMeta{})
	resp, err := eng.Search(context.Background(), &Request{
		Query: "عبارت مرزی یکتای مرزی", Mode: NormalizedPhrase, Scope: Scope{Target: "library"},
	}, "rel-b")
	if err != nil {
		t.Fatal(err)
	}
	if resp.VerifiedOccurrences != 1 {
		t.Fatalf("مرز قطعه: انتظار دقیقاً ۱ (بدون duplicate)؛ گرفت %d", resp.VerifiedOccurrences)
	}
}

// buildModelIndex نمایهٔ درون-پرونده‌ای از یک DocModel آماده (برای تست مرز).
func buildModelIndex(t *testing.T, m *xmlparse.DocModel) (string, func()) {
	t.Helper()
	path, cleanup := buildMultiTextIndex(t, []string{"seed"})
	_ = path
	dbw, err := index.OpenWrite(path + ".x")
	if err != nil {
		t.Fatal(err)
	}
	w := &index.IndexWriter{DB: dbw}
	docs := []index.DocInput{{CollectionUID: "c-b", WorkUID: "w-b", DocumentUID: m.DocumentUID, Language: "fa", Model: m}}
	if _, err := w.Rebuild("rel-b", docs, []index.TitleRow{{WorkUID: "w-b", Title: "کار مرز"}}, nil); err != nil {
		t.Fatal(err)
	}
	return path + ".x", func() { _ = dbw.Close(); cleanup() }
}
