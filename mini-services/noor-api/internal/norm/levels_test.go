package norm

import (
	"strings"
	"testing"
)

func TestLevelsHierarchy(t *testing.T) {
	// اصل L1 ⊆ L2 ⊆ L3:
	// هر تطبیق در L1 باید در L2 و L3 هم وجود داشته باشد
	text := "قَالَ‌ رَسُولُ‌ اللَّهِ‌: إِيَّاكُمْ‌ وَ مُحَدَّثَاتِ‌ الأُمُورِ"
	tokens := TokenizeAligned(text)

	if len(tokens) == 0 {
		t.Fatal("tokens should not be empty")
	}

	for i, tk := range tokens {
		if tk.Surface == "" || tk.N0 == "" || tk.N1 == "" || tk.N2 == "" {
			t.Errorf("token %d has empty level: %+v", i, tk)
		}
		// N0 باید اعراب داشته باشد (اگر در surface بوده)
		if strings.Contains(tk.Surface, "\u064E") && !strings.Contains(tk.N0, "\u064E") {
			t.Errorf("token %d N0 should keep fatha: surface=%q, n0=%q", i, tk.Surface, tk.N0)
		}
		// N1 نباید هیچ اعرابی داشته باشد
		for _, r := range tk.N1 {
			if ArabicDiacritics[r] {
				t.Errorf("token %d N1 contains diacritic %U: %s", i, r, tk.N1)
			}
		}
		// بازه شروع و پایان معتبر
		if tk.Start < 0 || tk.End <= tk.Start {
			t.Errorf("token %d invalid range [%d..%d]", i, tk.Start, tk.End)
		}
	}
}

func TestQuranicOrthography(t *testing.T) {
	// رسم‌الخط قرآنی و املای معیار باید در N2 «برابر» شوند (نه فقط به رشتهٔ ثابتی نگاشت).
	pairs := [][2]string{
		{"الصلوة", "الصلاة"},
		{"صلوة", "صلاة"},
		{"الزکوة", "الزکاة"},
		{"الزكوة", "الزكاة"},
		{"الحیوة", "الحياة"},
		{"ٱلصَّلَوٰةَ", "الصَّلاةَ"},
		{"إبرٰهيم", "إبراهيم"},
	}
	for _, p := range pairs {
		a := TokenizeAligned(p[0])
		b := TokenizeAligned(p[1])
		if len(a) != 1 || len(b) != 1 {
			t.Fatalf("واژه‌بندی نامنتظر: %v %v", a, b)
		}
		if a[0].N2 != b[0].N2 {
			t.Errorf("N2(%q)=%q ≠ N2(%q)=%q", p[0], a[0].N2, p[1], b[0].N2)
		}
	}
	// جدول قرآنی در متن چندواژه‌ای هم اثر دارد
	n2, _ := NormalizeN2("أقيموا الصلوة")
	if !strings.Contains(n2, "الصلاه") {
		t.Errorf("NormalizeN2 چندواژه‌ای جدول قرآنی را اعمال نکرد: %q", n2)
	}
}

// TestN2NoBlindPrefixStripping رگرسیون ممیزی: N2 نباید واژهٔ اصیل را با حذف کور پیشوند بشکند.
func TestN2NoBlindPrefixStripping(t *testing.T) {
	for _, w := range []string{"الله", "کتاب", "وزیر", "بیت", "ولد", "فرض", "والدین", "بالا", "کالبد", "لکن"} {
		if got := WordToN2(w); got != w {
			t.Errorf("WordToN2(%q)=%q؛ باید بدون تغییر بماند", w, got)
		}
	}
	// قواعد حرفی همچنان اعمال می‌شوند
	if got := WordToN2("أمير"); got != "امیر" {
		t.Errorf("WordToN2(أمير)=%q", got)
	}
	if got := WordToN2("رحمة"); got != "رحمه" {
		t.Errorf("WordToN2(رحمة)=%q", got)
	}
}

func TestN2Alternatives(t *testing.T) {
	has := func(alts []Alt, f string) bool {
		for _, a := range alts {
			if a.Form == f {
				return true
			}
		}
		return false
	}
	alts := N2Alternatives("قال")
	for _, f := range []string{"قال", "وقال", "فقال"} {
		if !has(alts, f) {
			t.Errorf("N2Alternatives(قال) باید %q را داشته باشد: %+v", f, alts)
		}
	}
	if has(alts, "بقال") {
		t.Errorf("«بقال» نباید گونهٔ «قال» باشد")
	}
	alts = N2Alternatives("الله")
	for _, f := range []string{"والله", "بالله", "لله", "فالله"} {
		if !has(alts, f) {
			t.Errorf("N2Alternatives(الله) باید %q را داشته باشد", f)
		}
	}
	if has(alts, "له") {
		t.Errorf("«له» نباید گونهٔ «الله» باشد")
	}
	alts = N2Alternatives("وقال")
	if !has(alts, "قال") {
		t.Errorf("N2Alternatives(وقال) باید «قال» را بپذیرد")
	}
	// حذف پیشوندِ خودِ پرسش همیشه با برچسب «(در پرسش)» است تا کاربر L3 را از L2 تمیز دهد
	for _, a := range N2Alternatives("وزیر") {
		if a.Form == "زیر" && !strings.Contains(a.Diff, "در پرسش") {
			t.Errorf("گونهٔ «زیر» برای «وزیر» باید برچسب‌دار باشد: %+v", a)
		}
	}
}

func TestFTSTokenOneToOne(t *testing.T) {
	for _, w := range []string{"50%", "c#", "a&b", "@x", "$", "قال", "abc", "ABC"} {
		f := FTSToken(w)
		for i := 0; i < len(f); i++ {
			c := f[i]
			if c < 0x80 && !(c >= '0' && c <= '9' || c >= 'a' && c <= 'z') {
				t.Errorf("FTSToken(%q)=%q هنوز جداکنندهٔ ASCII دارد", w, f)
			}
		}
		if f == "" {
			t.Errorf("FTSToken(%q) تهی شد", w)
		}
	}
	if FTSToken("50%") == FTSToken("50") {
		t.Errorf("نگاشت باید یک‌به‌یک باشد")
	}
}

func TestDiacriticsCompatible(t *testing.T) {
	cases := []struct {
		q, d string
		ok   bool
	}{
		{"عَلِم", "عَلِمَ", true},  // پرسش اعراب ناقص دارد
		{"عَلِمَ", "عَلِم", true},  // حرف پایانی در متن بی‌اعراب است: ساکت = سازگار (§۱۵ پیش‌فرض)
		{"عِلم", "عَلَم", false},   // حرکت متناقض روی همان حرف: رد
		{"عِلم", "علم", true},      // متن بی‌اعراب
		{"عُلِم", "عَلِمَ", false}, // ضمه ≠ فتحه
		{"علم", "عَلِمَ", true},    // بدون اعراب = بدون قید
		{"رَبِّ", "رَبِّ", true},
		{"رَبِّ", "رَبِ", false}, // تشدید
	}
	for _, c := range cases {
		if got := DiacriticsCompatible(c.q, c.d); got != c.ok {
			t.Errorf("DiacriticsCompatible(%q,%q)=%v؛ انتظار %v", c.q, c.d, got, c.ok)
		}
	}
}

func TestEditDistance1(t *testing.T) {
	if !EditDistance1("الاعمال", "الاعمل") {
		t.Error("حذف یک حرف")
	}
	if !EditDistance1("بالنیات", "بالنیاب") {
		t.Error("جایگزینی یک حرف")
	}
	if !EditDistance1("رسول", "رسوال") {
		t.Error("افزودن یک حرف")
	}
	if !EditDistance1("محمد", "محدم") {
		t.Error("جابه‌جایی مجاور")
	}
	if EditDistance1("قال", "قیل") {
		t.Error("واژهٔ کوتاه‌تر از ۴ حرف نزدیک شمرده نمی‌شود")
	}
	if EditDistance1("رسول", "رسول") {
		t.Error("برابر = نزدیک نیست")
	}
}

func TestNewPunctuationSeparators(t *testing.T) {
	text := "﴿بِسْمِ اللَّهِ﴾ “قال”… رسول–الله · §"
	var words []string
	for _, tk := range TokenizeAligned(text) {
		words = append(words, tk.N1)
	}
	want := []string{"بسم", "الله", "قال", "رسول", "الله"}
	if strings.Join(words, "|") != strings.Join(want, "|") {
		t.Errorf("واژه‌بندی=%v؛ انتظار %v", words, want)
	}
}

func TestBuildBigrams(t *testing.T) {
	words := []string{"قال", "رسول", "الله"}
	bigrams := BuildBigrams(words)

	if len(bigrams) != len(words) {
		t.Fatalf("bigrams count %d != words count %d", len(bigrams), len(words))
	}

	expected0 := "قال" + BigramSeparator + "رسول"
	expected1 := "رسول" + BigramSeparator + "الله"
	expected2 := "الله" + BigramSeparator + BoundaryMarker

	if bigrams[0] != expected0 {
		t.Errorf("bigrams[0] = %q; want %q", bigrams[0], expected0)
	}
	if bigrams[1] != expected1 {
		t.Errorf("bigrams[1] = %q; want %q", bigrams[1], expected1)
	}
	if bigrams[2] != expected2 {
		t.Errorf("bigrams[2] = %q; want %q", bigrams[2], expected2)
	}

	phrase := QueryToBigramPhrase(words)
	expectedPhrase := "قال" + BigramSeparator + "رسول رسول" + BigramSeparator + "الله"
	if phrase != expectedPhrase {
		t.Errorf("QueryToBigramPhrase = %q; want %q", phrase, expectedPhrase)
	}
}

func TestPersianVariants(t *testing.T) {
	query1 := []string{"می", "گوید"}
	variants1 := GeneratePersianVariants(query1)

	foundMerged := false
	for _, v := range variants1 {
		if len(v) == 1 && v[0] == "میگوید" {
			foundMerged = true
			break
		}
	}
	if !foundMerged {
		t.Errorf("GeneratePersianVariants failed to merge 'می گوید' into 'میگوید': %+v", variants1)
	}

	query2 := []string{"میگوید"}
	variants2 := GeneratePersianVariants(query2)
	foundSplit := false
	for _, v := range variants2 {
		if len(v) == 2 && v[0] == "می" && v[1] == "گوید" {
			foundSplit = true
			break
		}
	}
	if !foundSplit {
		t.Errorf("GeneratePersianVariants failed to split 'میگوید' into 'می گوید': %+v", variants2)
	}
}

func TestReuseKeyCoversAlternatives(t *testing.T) {
	words := []string{"قال", "الله", "العلم", "المؤمنین", "رسول", "فلان", "وجد", "الصلاه", "کتاب", "وزیر",
		"لله", "وقال", "بالله", "للمؤمنین", "والله", "فقال", "الحدیث", "امیر", "الذی", "من", "بحار"}
	for _, w := range words {
		k := ReuseKey(w)
		for _, a := range N2Alternatives(w) {
			if ReuseKey(a.Form) != k {
				t.Errorf("ReuseKey(%q)=%q ≠ ReuseKey(%q)=%q (%s)", a.Form, ReuseKey(a.Form), w, k, a.Diff)
			}
		}
	}
}

func TestTokenizeAlignedSkipsBareMarks(t *testing.T) {
	toks := TokenizeAligned("زَههَ،ُ سطث ـ \u200c ِ")
	if len(toks) != 2 || toks[0].N1 != "زهه" || toks[1].N1 != "سطث" {
		var got []string
		for _, x := range toks {
			got = append(got, x.N1)
		}
		t.Fatalf("bare marks must not become tokens: %q", got)
	}
}

// TestTokenizeAlignedOffsetsAreCodePoints offsetها باید با []rune(text) بخوانند (حتی برای UTF-8 نامعتبر).
func TestTokenizeAlignedOffsetsAreCodePoints(t *testing.T) {
	for _, text := range []string{
		"قَالَ‌ رَسُولُ‌ اللَّهِ‌: «إِيَّاكُمْ» وَ C++ می‌گوید ۞ ﴿بسم﴾",
		"abc \xff\xfe def قال",
		"",
		"   ",
	} {
		rs := []rune(text)
		for _, tk := range TokenizeAligned(text) {
			if tk.Start < 0 || tk.End > len(rs) || string(rs[tk.Start:tk.End]) != string([]rune(tk.Surface)) {
				t.Errorf("%q: token %q at [%d,%d] does not match runes %q", text, tk.Surface, tk.Start, tk.End, string(rs[tk.Start:tk.End]))
			}
		}
	}
}

func TestDiacriticsCompatibleStrict(t *testing.T) {
	cases := []struct {
		q, d string
		ok   bool
	}{
		{"عَلِمَ", "عَلِم", false}, // سخت‌گیرانه: حرف بی‌حرکت متن = ناسازگار
		{"عِلم", "علم", false},
		{"عَلِم", "عَلِمَ", true},
		{"عِلم", "عَلَم", false},
	}
	for _, c := range cases {
		if got := DiacriticsCompatibleStrict(c.q, c.d); got != c.ok {
			t.Errorf("DiacriticsCompatibleStrict(%q,%q)=%v؛ انتظار %v", c.q, c.d, got, c.ok)
		}
	}
}
