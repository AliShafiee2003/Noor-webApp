package search

// آزمون‌های بازگشتی دور دوم اصلاحات (قید اعراب §۱۵، مرز واژهٔ L1، رسم‌الخط قرآنی با پیشوند،
// برش سقف با اولویت لایه). انتظارها دست‌نویس‌اند و از خروجی norm مشتق نمی‌شوند.

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
)

func round2Corpus() []testDoc {
	return []testDoc{
		{"c-r2", "w-r21", "d-r21", "ar", []string{
			`<p>قال: طلب العِلْمِ فريضة.</p>`,
			`<p>ورفع العَلَمَ فوق الجبل.</p>`,
			`<p>وفي نسخة: طلب علم فريضة.</p>`,
		}},
		{"c-r2", "w-r22", "d-r22", "fa", []string{
			`<p>این علم‌ها را باید آموخت و علم را باید به کار بست.</p>`,
		}},
		{"c-r2", "w-r23", "d-r23", "ar", []string{
			`<p>وأمر أهله بالصلوة والزكوة.</p>`,
		}},
	}
}

func layerOfDoc(resp *Response, doc string) []string {
	var ls []string
	for _, r := range resp.Results {
		if r.Document.UID == doc {
			ls = append(ls, r.Layer)
		}
	}
	return ls
}

func TestRound2DiacriticsPolicyTiered(t *testing.T) {
	e, _ := newTestEngine(t, round2Corpus())
	// پیش‌فرض §۱۵: عِلم با اعراب متناقض (عَلَم) رد؛ «علم» بی‌اعراب سازگار
	resp := search(t, e, Request{Query: "العِلْم", Mode: Tiered, Diacritics: "respect", Layers: []string{"L1", "L2", "L3"}})
	for _, r := range resp.Results {
		if r.Document.UID != "d-r21" {
			continue
		}
		if containsRunes(r.Snippet, "العَلَمَ") && !containsRunes(r.Snippet, "العِلْمِ") {
			t.Errorf("اعراب متناقض نباید نتیجهٔ قطعی بدهد: %q (%s)", r.Snippet, r.Layer)
		}
	}
	// n1-1.4.0: «علم» بی‌اعراب «طلب علم» با قاعدهٔ ال تعریف در L3 می‌آید (حرف بی‌حرکت ساکت است)
	if ls := layerOfDoc(resp, "d-r21"); len(ls) != 2 || !hasLayer(ls, "L2") || !hasLayer(ls, "L3") {
		t.Errorf("respect: انتظار L2 «العِلْمِ» + L3 «علم»، گرفته %v", ls)
	}
	// «طلب علم» بی‌اعراب: سازگار در پیش‌فرض (حرف بی‌حرکت متن ساکت است)، ناسازگار در strict
	resp = search(t, e, Request{Query: "طلب عِلْم", Mode: Tiered, Diacritics: "respect", Layers: []string{"L1", "L2", "L3"}})
	bare := func(resp *Response) (n int) {
		for _, r := range resp.Results {
			if r.Document.UID == "d-r21" && hitText(r) == "طلب علم" {
				n++
			}
		}
		return
	}
	if bare(resp) != 1 {
		t.Errorf("respect پیش‌فرض: انتظار ۱ وقوع بی‌اعراب «طلب علم»، گرفته %+v", layersOf(resp))
	}
	for _, r := range resp.Results {
		if containsRunes(hitText(r), "العَلَمَ") {
			t.Errorf("اعراب متناقض نباید از راه ال تعریف بیاید: %q", hitText(r))
		}
	}
	resp = search(t, e, Request{Query: "طلب عِلْم", Mode: Tiered, Diacritics: "respect_strict", Layers: []string{"L1", "L2", "L3"}})
	if n := bare(resp); n != 0 {
		t.Errorf("respect_strict: متن بی‌اعراب نباید بیاید، گرفته %d", n)
	}
}

// hitText متن هایلایت‌شدهٔ نتیجه (همهٔ بازه‌ها، پشت سر هم با فاصله).
func hitText(r Result) string {
	rs := []rune(r.Snippet)
	var parts []string
	for _, h := range r.Highlight {
		if h.Start >= 0 && h.End <= len(rs) && h.Start < h.End {
			parts = append(parts, string(rs[h.Start:h.End]))
		}
	}
	return strings.Join(parts, " ")
}

func hasLayer(ls []string, l string) bool {
	for _, x := range ls {
		if x == l {
			return true
		}
	}
	return false
}

func TestRound2L1RequiresWholeWord(t *testing.T) {
	e, _ := newTestEngine(t, round2Corpus())
	resp := search(t, e, Request{Query: "علم", Mode: Tiered, Layers: []string{"L1", "L2", "L3"}})
	ls := layerOfDoc(resp, "d-r22")
	if len(ls) != 2 {
		t.Fatalf("انتظار ۲ وقوع در d-r22 (علم‌ها و علم)، گرفته %v", ls)
	}
	l1 := 0
	for _, l := range ls {
		if l == "L1" {
			l1++
		}
	}
	if l1 != 1 {
		t.Errorf("فقط «علم» مستقل L1 است، نه «علم» درون «علم‌ها»: %v", ls)
	}
}

func TestRound2QuranicOrthographyWithProclitic(t *testing.T) {
	e, _ := newTestEngine(t, round2Corpus())
	resp := search(t, e, Request{Query: "بالصلاة", Mode: Tiered, Layers: []string{"L1", "L2", "L3"}})
	ls := layerOfDoc(resp, "d-r23")
	if len(ls) != 1 || ls[0] != "L3" {
		t.Errorf("«بالصلوة» باید با «بالصلاة» در L3 بیاید، گرفته %v", ls)
	}
	if resp.VerifiedOccurrences < 1 {
		t.Errorf("L3 جزو شمار قطعی است")
	}
}

// TestRound2CapKeepsBestLayer سقف ۳ نتیجه: ۶۰۰ سند نخست (بیش از دو دستهٔ ۲۵۶تایی) فقط «رحمه» (L3 برای پرسش «رحمة»)
// دارند و سند آخر عین «رحمة» (L1). پیش‌تر برش به ترتیب canonical، L1 انتهای کتابخانه را
// حذف می‌کرد.
func TestRound2CapKeepsBestLayer(t *testing.T) {
	var docs []testDoc
	for i := 0; i < 600; i++ { // > سقف + perPassageHitCap تا مسیر برش واقعاً اجرا شود
		docs = append(docs, testDoc{"c-cap", fmt.Sprintf("w-c%03d", i), fmt.Sprintf("d-c%03d", i), "ar",
			[]string{`<p>رحمه الله تعالى وأسكنه جنته.</p>`}})
	}
	docs = append(docs, testDoc{"c-cap", "w-cz", "d-cz", "ar", []string{`<p>وسعت رحمة ربك كل شيء.</p>`}})
	dir := t.TempDir()
	rel := "rel-cap"
	buildEngineRelease(t, dir, rel, docs, 1)
	base := NewLocal(filepath.Join(dir, "none.sqlite"), []byte("test-secret-key-32-bytes-long!!"), dummyMeta{}, WithLimits(3, 0))
	e, err := OpenFTS5Release(base, dir, rel)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = e.Close() })
	req := Request{Query: "رحمة", Mode: Tiered, Layers: []string{"L1", "L2", "L3"}}
	resp, err := e.Search(context.Background(), &req, "")
	if err != nil {
		t.Fatal(err)
	}
	if ls := layerOfDoc(resp, "d-cz"); len(ls) != 1 || ls[0] != "L1" {
		t.Errorf("L1 انتهای کتابخانه باید در نتایج سقف‌دار بماند، گرفته %v (همه: %+v)", ls, layersOf(resp))
	}
	if len(resp.Results) > 0 && resp.Results[0].Layer != "L1" {
		t.Errorf("ترتیب: L1 باید اول باشد، گرفته %s", resp.Results[0].Layer)
	}
	if resp.CountRelation == "exact" {
		t.Errorf("با برش سقف، شمارش نباید exact اعلام شود")
	}
}

func containsRunes(s, sub string) bool {
	return len(sub) == 0 || (len(s) >= len(sub) && indexOf(s, sub) >= 0)
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
