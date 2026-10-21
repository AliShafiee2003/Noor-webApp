package norm

// آزمون‌های قواعد n1-1.3.0 با انتظارهای مستقل (رشته‌های ثابت دست‌نویس، نه خروجی خود norm).

import "testing"

func TestN13InvisibleRunesRemoved(t *testing.T) {
	cases := map[string]string{
		"کتاب\u200Dخانه":      "کتابخانه", // ZWJ حذف، مرز نیست
		"\uFEFFکتاب":          "کتاب",     // BOM
		"کت\u00ADاب":          "کتاب",     // soft hyphen
		"علی\u200F":           "علی",      // RLM
		"\u202Bقال\u202C":     "قال",
		"قال \u200F رسول":     "قال رسول", // نامرئی بین دو فاصله فاصلهٔ دوم نمی‌سازد
		"الله\u061C":          "الله",
		"\u2067متن\u2069 دوم": "متن دوم",
	}
	for in, want := range cases {
		if got, _ := Normalize(in); got != want {
			t.Errorf("Normalize(%q)=%q؛ انتظار %q", in, got, want)
		}
	}
}

func TestN13PresentationForms(t *testing.T) {
	cases := map[string]string{
		"\uFEFB":                               "لا",     // ﻻ
		"\uFDF2":                               "الله",   // ﷲ
		"\uFE8D\uFEDF\uFEDC\uFE98\uFE8E\uFE8F": "الکتاب", // ﺍﻟﻜﺘﺎﺏ (ك نمایشی ← ک)
		"\uFEE3\uFEEE\uFEB3\uFEF0":             "موسى",   // الف مقصوره در N1 حفظ می‌شود
		"\uFEF2":                               "ی",      // ي نمایشی ← ی
		"\uFB8F":                               "ک",      // کاف فارسی نمایشی
		"\uFBFD":                               "ی",      // ی فارسی نمایشی
		"\uFE7C\uFEB7":                         "ش",      // تشدید نمایشی حذف، ش نمایشی
		"\uFDFA":                               "\uFDFA", // لیگاتور چندواژه‌ای عمداً دست‌نخورده
	}
	for in, want := range cases {
		if got, _ := Normalize(in); got != want {
			t.Errorf("Normalize(%q)=%q؛ انتظار %q", in, got, want)
		}
	}
	// N0 اعراب نمایشی را نگه می‌دارد ولی صورت پایه می‌شود
	if got, _ := NormalizeN0("\uFE7D"); got != "\u0651" {
		t.Errorf("NormalizeN0(ﹽ)=%q؛ انتظار تشدید پایه", got)
	}
}

func TestN13PresentationMapAlignment(t *testing.T) {
	// هر نویسهٔ خروجیِ گسترش ﻻ باید به همان موضع اصلی اشاره کند (هایلایت روی متن اصلی)
	got, m := Normalize("و\uFEFB")
	if got != "ولا" || len(m) != 3 || m[1] != 1 || m[2] != 1 {
		t.Fatalf("Normalize(وﻻ)=%q map=%v", got, m)
	}
}

func TestN13NFDAlefMadda(t *testing.T) {
	a, _ := Normalize("\u0627\u0653ب") // ا + ٓ (NFD)
	b, _ := Normalize("\u0622ب")       // آ ترکیبی
	if a != b {
		t.Errorf("NFD و NFC آ باید یکسان شوند: %q ≠ %q", a, b)
	}
}

func TestN13HamzaCarrierAlternates(t *testing.T) {
	has := func(w, form string) bool {
		for _, a := range N2Alternatives(WordToN2(w)) {
			if a.Form == form {
				return true
			}
		}
		return false
	}
	pairs := [][2]string{{"مسئله", "مسأله"}, {"مسئول", "مسؤول"}, {"هیئت", "هیأت"}, {"سؤال", "سئوال"}}
	for _, p := range pairs {
		if !has(p[0], WordToN2(p[1])) || !has(p[1], WordToN2(p[0])) {
			t.Errorf("هم‌ارزی دوسویهٔ %s/%s در L3 نیست", p[0], p[1])
		}
	}
	if has("علم", WordToN2("عالم")) {
		t.Errorf("هم‌ارزی همزه نباید واژهٔ نامربوط را جور کند")
	}
}

func TestN13QuranicStemWithProclitic(t *testing.T) {
	pairs := [][2]string{
		{"والصلوة", "والصلاة"}, {"بالزکوة", "بالزکاة"}, {"الصلوة", "الصلاة"},
		{"فالحیوة", "فالحیاة"}, {"صلوة", "صلاة"},
	}
	for _, p := range pairs {
		a, b := WordToN2(p[0]), WordToN2(p[1])
		if a != b {
			t.Errorf("WordToN2(%s)=%s ≠ WordToN2(%s)=%s", p[0], a, p[1], b)
		}
		if ReuseKey(a) != ReuseKey(b) {
			t.Errorf("ReuseKey ناهم‌خوان برای %s/%s", p[0], p[1])
		}
		// مسیر توکن (نمایه و پرسش) باید با NormalizeN2 هم‌خوان باشد
		toks := TokenizeAligned(p[0])
		n2, _ := NormalizeN2(p[0])
		if len(toks) != 1 || toks[0].N2 != n2 {
			t.Errorf("توکن N2 «%s» با NormalizeN2 «%s» نمی‌خواند", toks[0].N2, n2)
		}
	}
}
