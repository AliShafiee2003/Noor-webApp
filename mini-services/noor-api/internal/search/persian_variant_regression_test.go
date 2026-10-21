package search

import (
	"context"
	"strings"
	"testing"
)

// رگرسیون گزارش کاربر: متن کتاب «مى‌فرمود» (ى عربی + نیم‌فاصله) و «السّلام/عزّ و جلّ» دارد و
// پرسش کپی‌شده «ميفرمود». پیش‌تر پاسبان گونهٔ فارسی در سطح N1 («مى» ≠ «می») گونه را رد می‌کرد و
// حالت‌های لایه‌ای فقط L4 می‌دادند و normalized/linguistic هیچ.
func TestPersianVariantArabicYehZWNJ(t *testing.T) {
	const query = "فضيل بن يسار گويد: شنيدم امام صادق عليه السلام ببعضى از اصحاب قيس ماصر ميفرمود: همانا خداى عز و جل پيغمبرش را تربيت كرد"
	const target = "11- فضيل بن يسار گويد: شنيدم امام صادق عليه السّلام ببعضى از اصحاب قيس ماصر مى‌فرمود: همانا خداى عزّ و جلّ پيغمبرش را تربيت كرد و نيكو تربيت كرد"
	noise := strings.Repeat("امام صادق عليه السلام فرمود همانا خداى عز و جل پيغمبر را ميفرمود اصحاب از ", 6)
	var docs []testDoc
	for i, txt := range []string{noise, target, noise} {
		docs = append(docs, testDoc{"c-01", "w-0" + string(rune('1'+i)), "d-0" + string(rune('1'+i)), "fa", []string{"<p>" + txt + "</p>"}})
	}
	e, _ := newTestEngine(t, docs)
	for _, mode := range []string{NormalizedPhrase, Linguistic, Tiered, LongQuote, SimilarQuote} {
		req := Request{Query: query, Mode: mode, PageSize: 10}
		resp, err := e.Search(context.Background(), &req, "rel-t")
		if err != nil {
			t.Fatalf("%s: %v", mode, err)
		}
		found := false
		for _, r := range resp.Results {
			if r.Document.UID == "d-02" {
				found = true
				if r.Layer != "L3" {
					t.Errorf("%s: لایه %q؛ انتظار L3 (تفاوت پیوستگی) نه L4", mode, r.Layer)
				}
			}
		}
		if !found {
			t.Errorf("%s: متن هدف یافت نشد (نتایج=%d)", mode, len(resp.Results))
		}
	}
	// عین عبارت باید همچنان سخت‌گیر بماند
	req := Request{Query: query, Mode: StrictPhrase, PageSize: 10}
	resp, err := e.Search(context.Background(), &req, "rel-t")
	if err != nil {
		t.Fatal(err)
	}
	if len(resp.Results) != 0 {
		t.Errorf("strict_phrase نباید متن با «مى‌فرمود» را بیابد؛ %d نتیجه", len(resp.Results))
	}
}

// حالت text (همهٔ سطوح انعطاف) متن چسبانده‌شدهٔ بلند (بیش از ۲۰۴۸ نویسه) را می‌پذیرد؛
// سقف ۲۰۴۸ فقط برای خانوادهٔ words است (قرارداد دوحالته — modes.go).
func TestTieredAcceptsLongPaste(t *testing.T) {
	long := strings.Repeat("همانا خداى عز و جل پيغمبرش را تربيت كرد ", 80)
	for _, m := range []string{Tiered, NormalizedPhrase, StrictPhrase, Linguistic, SimilarQuote} {
		if err := validateRequest(&Request{Query: long, Mode: m, PageSize: 20}); err != nil {
			t.Fatalf("%s با متن بلند رد شد: %v", m, err)
		}
	}
	for _, f := range []string{FlexExact, FlexWritten, FlexSpelling, FlexSimilar} {
		if err := validateRequest(&Request{Query: long, Mode: ModeText, Flex: f, PageSize: 20}); err != nil {
			t.Fatalf("text/%s با متن بلند رد شد: %v", f, err)
		}
	}
	if err := validateRequest(&Request{Query: long, Mode: AllWords, PageSize: 20}); err == nil {
		t.Fatal("all_words باید سقف ۲۰۴۸ نویسه را نگه دارد")
	}
	if err := validateRequest(&Request{Query: long, Mode: ModeWords, PageSize: 20}); err == nil {
		t.Fatal("words باید سقف ۲۰۴۸ نویسه را نگه دارد")
	}
}
