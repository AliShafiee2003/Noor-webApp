package norm

// مرجع: TokenizeAligned پیش از بازنویسی scanWords (n1-1.4.0) برای آزمون هم‌ارزی.

import (
	"math/rand"
	"reflect"
	"strings"
	"testing"
	"unicode/utf8"
)

func tokenizeAlignedReference(text string) []AlignedToken {
	if text == "" {
		return nil
	}
	if !utf8.ValidString(text) {
		// مسیر کند هم‌ارز []rune: هر بایت نامعتبر یک U+FFFD و یک موضع code point است
		text = string([]rune(text))
	}
	// پیش‌تخصیص: میانگین واژهٔ عربی/فارسی با فاصله ~۵–۶ نویسه (≈۱۰ بایت) است
	tokens := make([]AlignedToken, 0, len(text)/10+1)
	// پیمایش مستقیم رشته: offsetها code point‌اند (نه بایت) و surface برش بی‌تخصیص رشته است
	cp := 0 // شمارندهٔ code point
	i := 0  // موضع بایت
	n := len(text)
	for i < n {
		// گذشتن از فاصله‌ها و علائم نگارشی جداکننده
		for i < n {
			r, sz := utf8.DecodeRuneInString(text[i:])
			if !isSeparator(r) {
				break
			}
			i += sz
			cp++
		}
		if i >= n {
			break
		}
		bStart, start := i, cp
		for i < n {
			r, sz := utf8.DecodeRuneInString(text[i:])
			if isSeparator(r) {
				break
			}
			i += sz
			cp++
		}
		surface := text[bStart:i]
		if isFootnoteRefReference(text, bStart, i) {
			continue // «علم[۱] نافع»: شمارهٔ ارجاع چسبیده واژهٔ عبارت نیست (n1-1.4.0)
		}
		n0, n1, n2 := wordLevels(surface)

		// نشانهٔ تنها (اعراب/تطویل/نیم‌فاصلهٔ جدا از حرف، مثل «،ُ») واژه نیست: اگر پس از N1
		// هیچ نویسهٔ پایه‌ای نماند، توکن ساخته نمی‌شود (پیش‌تر خودِ اعراب توکن می‌شد و
		// عبارت اعراب‌دار را از L2 به L4 می‌برد). نمایه و پرسش هر دو از همین تابع استفاده می‌کنند.
		if n1 == "" {
			continue
		}
		if n0 == "" {
			n0 = surface
		}
		if n2 == "" {
			n2 = n1
		}
		tokens = append(tokens, AlignedToken{
			Surface: surface,
			N0:      n0,
			N1:      n1,
			N2:      n2,
			Start:   start,
			End:     cp,
		})
	}
	return tokens
}

func isFootnoteRefReference(text string, bs, be int) bool {
	if !isDigits(text[bs:be]) || bs < 2 || be >= len(text) || text[bs-1] != '[' || text[be] != ']' {
		return false
	}
	return isFootnoteRef(text, bs, be)
}

func TestTokenizeAlignedMatchesReference(t *testing.T) {
	parts := []string{"قال", "رَسُولُ", "اللَّهِ", "کتاب‌ها", "خانه‌ی", "علم[۱]", "[۲]", "۱۲", "a", "b1", " ", "  ", "\n", "،", ":", "«", "»", "(ع)",
		"ُ", "ـ", "\u200c", "\xff", "\xd8", "\xc3(", "\x80", "\uFFFD", "١", "[", "]", "علیه‌السلام", "¹", "§", "·", "😀", "ﷺ"}
	r := rand.New(rand.NewSource(3))
	for k := 0; k < 20000; k++ {
		var b strings.Builder
		for n := r.Intn(14); n >= 0; n-- {
			b.WriteString(parts[r.Intn(len(parts))])
		}
		s := b.String()
		got, want := TokenizeAligned(s), tokenizeAlignedReference(s)
		if len(got) == 0 && len(want) == 0 {
			continue
		}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("%q (valid=%v):\ngot  %+v\nwant %+v", s, utf8.ValidString(s), got, want)
		}
	}
}
