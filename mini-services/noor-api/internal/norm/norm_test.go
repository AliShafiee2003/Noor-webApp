package norm

// norm_test.go — آزمون‌های محصول نرمال‌ساز (SEARCH-04/05).
// بردارهای طلایی NFC در nfc_vectors_test.go (تولیدشده از Unicode 15.0.0) هستند.

import (
	"strings"
	"testing"
)

// normNorm خروجی نرمال را برای آزمون برمی‌گرداند.
func normNorm(s string) string { out, _ := Normalize(s); return out }

// TestNFCGoldenVectors خروجی nfcFrom باید با NFC مرجع یونیکد روی همهٔ بردارها یکی باشد.
func TestNFCGoldenVectors(t *testing.T) {
	if len(nfcGoldenVectors) < 1000 {
		t.Fatalf("بردارهای طلایی NFC ناقص است: %d", len(nfcGoldenVectors))
	}
	for i, v := range nfcGoldenVectors {
		in := []rune(v[0])
		got, m := nfcFrom(in)
		if string(got) != v[1] {
			t.Errorf("بردار %d: NFC(%q) = %q؛ انتظار %q", i, v[0], string(got), v[1])
			if i > 20 {
				break // خطای سیستماتیک؛ جزئیات کافی است
			}
		}
		// نگاشت: هم‌طول خروجی و درون بازهٔ متن اصلی
		if len(m) != len(got) {
			t.Errorf("بردار %d: طول نگاشت %d با خروجی %d یکی نیست", i, len(m), len(got))
		}
		for _, x := range m {
			if x < 0 || x >= len(in) {
				t.Fatalf("بردار %d: نگاشت خارج از بازه: %d", i, x)
			}
		}
	}
}

// TestNFCIdempotent خروجی NFC باید خودش NFC باشد (ویژگی تعریفی فرم).
func TestNFCIdempotent(t *testing.T) {
	for i, v := range nfcGoldenVectors {
		once, _ := nfcFrom([]rune(v[0]))
		twice, _ := nfcFrom(once)
		if string(twice) != string(once) {
			t.Fatalf("بردار %d: NFC(%q)=%q تکرارش %q داد — خروجی NFC نیست", i, v[0], string(once), string(twice))
		}
	}
}

// TestN1A_NFCCrossProduct دو فرم یونیکدِ یک نویسه باید در Normalize یکی شوند
// (SEARCH-04: پیش از این دو کلید نمایهٔ متفاوت می‌ساختند).
func TestN1A_NFCCrossProduct(t *testing.T) {
	composed := "آتش پاک است"
	decomposed := "\u0627\u0653تش پاک است"
	a := normNorm(composed)
	b := normNorm(decomposed)
	if a != b {
		t.Errorf("فرم مؤلف (ا+U+0653) و مرکب (آ) باید در N1 یکی شوند: %q vs %q", a, b)
	}
	if a != "آتش پاک است" {
		t.Errorf("نرمال آتش دست‌خورده است: %q", a)
	}
	// سایر ترکیب‌های عربی هم باید هم‌فرم شوند
	pairs := [][2]string{
		{"\u0627\u0654حمد", "أحمد"},
		{"\u0627\u0655ن", "إِن"},
		{"و\u0654", "ؤ"},
		{"ي\u0654", "ئ"},
	}
	for _, p := range pairs {
		if normNorm(p[0]) != normNorm(p[1]) {
			t.Errorf("ترکیب %q باید با مرکب %q یکی شود: %q vs %q", p[0], p[1], normNorm(p[0]), normNorm(p[1]))
		}
	}
}

// TestN1B_KasratanRemoved کل بازهٔ اعراب 064B..0652 باید حذف شود — از جمله 064D (SEARCH-05).
func TestN1B_KasratanRemoved(t *testing.T) {
	for r := rune(0x064B); r <= 0x0652; r++ {
		got := normNorm("ب" + string(r) + "ع")
		if got != "بع" {
			t.Errorf("U+%04X باید حذف شود؛ گرفت %q", r, got)
		}
	}
	if got := []rune(normNorm("شيءٍ")); string(got) != "\u0634\u06CC\u0621" {
		t.Errorf("کسرتان (U+064D) باید حذف شود؛ گرفت %q (U+%04X)", string(got), got[len(got)-1])
	}
	if !ArabicDiacritics[0x064D] {
		t.Error("0x064D باید عضو ArabicDiacritics باشد")
	}
}

// TestN1D_MapConsistencyNFC نگاشت n1→اصل با NFC هم باید هم‌طول خروجی و درون بازه بماند
// (سبک آزمون N1D ممیزی) — و برای نویسهٔ مرکب به نویسهٔ نخستِ متن اصلی اشاره کند.
func TestN1D_MapConsistencyNFC(t *testing.T) {
	cases := []string{
		"\u0627\u0653تش پاک",  // decomposed
		"آتش پاک",             // composed
		"النَّبي الكريم ۱۴۰۷", // اعراب + رقم
		"A\u0300 B\u0316",     // لاتین تجزیه‌ای
		"عبارت با اعرابِ کاملٌ در متن",
	}
	for _, s := range cases {
		out, mp := Normalize(s)
		rs := []rune(s)
		outRs := []rune(out)
		if len(mp) != len(outRs) {
			t.Errorf("طول نگاشت %d با خروجی %d یکی نیست (%q)", len(mp), len(outRs), out)
		}
		for _, v := range mp {
			if v < 0 || v >= len(rs) {
				t.Fatalf("نگاشت خارج از بازهٔ اصل: %d (%q)", v, s)
			}
		}
		// نویسهٔ مرکب باید به ایندکس نویسهٔ نخست (شروع‌کننده) اشاره کند
		if s[0] == 0xD8 && strings.HasPrefix(s, "\u0627\u0653") && mp[0] != 0 {
			t.Errorf("مرکب آ باید به ا (ایندکس ۰) نگاشت شود؛ گرفت %d", mp[0])
		}
	}
}
