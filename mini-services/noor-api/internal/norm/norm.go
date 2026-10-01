// Package norm — نرمال‌ساز نسخه‌دار N1 (§۴۴ PRD).
// قواعد محافظه‌کارانه: ي→ی، ك→ک، حذف تطویل و مجموعهٔ مصوب اعراب،
// یکسان‌سازی ارقام عربی/فارسی، whitespace و نیم‌فاصله، lowercase فقط لاتین.
// همزه و شکل‌های الف و ة/ه بی‌قید یکی نمی‌شوند. تغییر قواعد = نسخهٔ جدید + reindex.
// NFC در parser اعمال می‌شود (متن ورودی NFC فرض می‌گردد) تا نگاشت دقیق بماند.
package norm

import (
	"strings"
	"unicode"
)

// Version نسخهٔ فعلی قواعد نرمال‌سازی؛ در index و release ثبت می‌شود.
const Version = "n1-1.0.0"

// ArabicDiacritics مجموعهٔ مصوب علامت‌های اعراب و تطویل (نه بازهٔ کور یونیکد).
var ArabicDiacritics = map[rune]bool{
	0x0610: true, 0x0611: true, 0x0612: true,
	0x064B: true, 0x064C: true, 0x064E: true, 0x064F: true, 0x0650: true, 0x0651: true, 0x0652: true,
	0x0653: true, 0x0654: true, 0x0655: true, 0x0656: true, 0x0670: true, 0x0674: true,
	0x06D6: true, 0x06D7: true, 0x06D8: true, 0x06D9: true, 0x06DA: true, 0x06DB: true, 0x06DC: true,
	0x06DF: true, 0x06E0: true, 0x06E1: true, 0x06E2: true, 0x06E3: true, 0x06E4: true,
	0x06E7: true, 0x06E8: true, 0x06EA: true, 0x06EB: true, 0x06EC: true, 0x06ED: true,
}

// ZWNJ نیم‌فاصله — به فاصلهٔ استاندارد نگاشت می‌شود (قرارداد تعریف‌شدهٔ §۴۴).
const ZWNJ = '\u200C'

var digitMap = map[rune]rune{
	'٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
	'۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
}

// Normalize متن را نرمال می‌کند و نگاشت کامل «هر code point خروجی → code point ورودی»
// را برمی‌گرداند (آرایهٔ هم‌طول خروجی). برای highlight و نشانی شاهد الزامی است.
func Normalize(s string) (out string, mapToOrig []int) {
	runes := []rune(s)
	var b strings.Builder
	b.Grow(len(runes))
	mapToOrig = make([]int, 0, len(runes))
	prevSpace := false
	for i, r := range runes {
		if r == ZWNJ || unicode.IsSpace(r) {
			if !prevSpace && b.Len() > 0 {
				b.WriteRune(' ')
				mapToOrig = append(mapToOrig, i)
			}
			prevSpace = true
			continue
		}
		prevSpace = false
		var emit rune
		switch {
		case ArabicDiacritics[r] || r == '\u0640': // اعراب و تطویل: حذف
			continue
		case digitMap[r] != 0:
			emit = digitMap[r]
		case r == 'ي':
			emit = 'ی'
		case r == 'ك':
			emit = 'ک'
		case r < 0x250 && unicode.IsUpper(r):
			emit = unicode.ToLower(r)
		default:
			emit = r
		}
		b.WriteRune(emit)
		mapToOrig = append(mapToOrig, i)
	}
	return b.String(), mapToOrig
}

// Fold گسترده‌تر فقط برای mode زبانی (N2 جداست): همزه‌ها، شکل‌های الف، ة/ه، ي/ی، ى.
func Fold(s string) string {
	n, _ := Normalize(s)
	var b strings.Builder
	for _, r := range n {
		switch r {
		case 'أ', 'إ', 'آ', 'ٱ':
			b.WriteRune('ا')
		case 'ؤ':
			b.WriteRune('و')
		case 'ئ':
			b.WriteRune('ی')
		case 'ة':
			b.WriteRune('ه')
		case 'ى':
			b.WriteRune('ی')
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}

// Tokenize واژه‌ها (بدون stemming/stopword — §۴۴).
func Tokenize(s string) []string {
	return strings.FieldsFunc(s, func(r rune) bool {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '-' || r == ZWNJ {
			return false
		}
		return true
	})
}

// WordBoundary بررسی مرز واژه در متن نرمال: نویسهٔ قبل/بعد حرف/رقم نباشند.
func WordBoundary(s string, start, end int) bool {
	rs := []rune(s)
	if start < 0 || end > len(rs) || start >= end {
		return false
	}
	if start > 0 && (unicode.IsLetter(rs[start-1]) || unicode.IsDigit(rs[start-1])) {
		return false
	}
	if end < len(rs) && (unicode.IsLetter(rs[end]) || unicode.IsDigit(rs[end])) {
		return false
	}
	return true
}
