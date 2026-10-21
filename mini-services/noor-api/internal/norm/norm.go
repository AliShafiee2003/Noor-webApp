// Package norm — نرمال‌ساز نسخه‌دار N1 (§۴۴ PRD).
// ترتیب قواعد: نخست NFC (ترکیب کانونی — بند نخست §۴۴)، سپس قواعد صریح:
// ي→ی، ك→ک، حذف تطویل و مجموعهٔ مصوب اعراب، یکسان‌سازی ارقام عربی/فارسی،
// whitespace و نیم‌فاصله، lowercase فقط لاتین.
// همزه و شکل‌های الف و ة/ه بی‌قید یکی نمی‌شوند. تغییر قواعد = نسخهٔ جدید + reindex.
// نگاشت n1_map همیشه به موقعیت «متن اصلی» (پیش از NFC) اشاره می‌کند.
package norm

import (
	"strings"
	"unicode"
)

// Version نسخهٔ فعلی قواعد نرمال‌سازی؛ در index و release ثبت می‌شود.
// n1-1.1.0: افزودن NFC در ابتدای خط نرمال‌سازی (SEARCH-04) + حذف U+064D کسرتان
// (SEARCH-05) — تغییر قواعد؛ نمایه‌های ساخته‌شده با نسخهٔ قبلی باید بازسازی شوند.
// n1-1.2.0: علائم نگارشی تازه (گیومهٔ خمیده، –، …، ﴾﴿، ۞، · و §) مرز واژه‌اند؛ N2 دیگر
// پیشوند چسبان را حذف نمی‌کند و جدول قرآنی در صورت حرفی N2 است — بازسازی نمایه لازم است.
// n1-1.3.0: جدول کامل شکل‌های نمایشی عربی (presentation_tables.go)؛ نویسه‌های کنترلی نامرئی (ZWJ، RLM/LRM/ALM، BOM، soft-hyphen، U+2066..2069،
// U+061C) حذف می‌شوند و شکل‌های نمایشی چسبیدهٔ پرکاربرد (لا/لآ/لأ/الله) به صورت پایه
// می‌رسند — تغییر قواعد؛ نمایه‌های ساخته‌شده با نسخهٔ قبلی باید بازسازی شوند.
// n1-1.4.0: «ۀ» = «هٔ» (L2)؛ رقم بالانویس و «[۱]» چسبیده ارجاع‌اند نه واژه؛ جدول واژگانی N2
// (همزه روی کرسی، داود/داوود …) — بازسازی نمایه لازم است.
const Version = "n1-1.4.0"

// ArabicDiacritics مجموعهٔ مصوب علامت‌های اعراب و تطویل (نه بازهٔ کور یونیکد).
// ۰x064D (تنوین کسر/کسرتان) نیز عضو مجموعه است (SEARCH-05) — نسخهٔ مشابه همین
// مجموعه در فیلتر OS (osDiacriticFilter) باید با اینجا هم‌گام بماند.
var ArabicDiacritics = map[rune]bool{
	0x0610: true, 0x0611: true, 0x0612: true,
	0x064B: true, 0x064C: true, 0x064D: true, 0x064E: true, 0x064F: true, 0x0650: true, 0x0651: true, 0x0652: true,
	0x0653: true, 0x0654: true, 0x0655: true, 0x0656: true, 0x0670: true, 0x0674: true,
	0x06D6: true, 0x06D7: true, 0x06D8: true, 0x06D9: true, 0x06DA: true, 0x06DB: true, 0x06DC: true,
	0x06DF: true, 0x06E0: true, 0x06E1: true, 0x06E2: true, 0x06E3: true, 0x06E4: true,
	0x06E7: true, 0x06E8: true, 0x06EA: true, 0x06EB: true, 0x06EC: true, 0x06ED: true,
}

// ZWNJ نیم‌فاصله — به فاصلهٔ استاندارد نگاشت می‌شود (قرارداد تعریف‌شدهٔ §۴۴).
const ZWNJ = '\u200C'

// invisibleRunes نویسه‌های کنترلی نامرئی که در N0/N1 حذف می‌شوند (n1-1.3.0):
// ZWJ، LRM/RLM/ALM و کنترل‌های جهت، BOM، soft-hyphen، U+2066..2069 و U+061C.
// حذف‌اند نه جداکننده — تا واژه را نشکنند (برخلاف ZWNJ که مرز واژه است).
var invisibleRunes = map[rune]bool{
	'\u200B': true, '\u200D': true, '\u200E': true, '\u200F': true,
	'\u202A': true, '\u202B': true, '\u202C': true, '\u202D': true, '\u202E': true,
	'\u2066': true, '\u2067': true, '\u2068': true, '\u2069': true,
	'\u061C': true, '\u00AD': true, '\uFEFF': true,
}

var digitMap = map[rune]rune{
	'٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
	'۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
}

// Normalize متن را نرمال می‌کند و نگاشت کامل «هر code point خروجی → code point ورودی»
// را برمی‌گرداند (آرایهٔ هم‌طول خروجی). برای highlight و نشانی شاهد الزامی است.
// ترتیب: نخست NFC روی ورودی (SEARCH-04 — بند نخست §۴۴) با نگاشت به اصل،
// سپس قواعد صریح N1؛ نگاشت نهایی همچنان به موقعیت متن اصلی اشاره می‌کند.
func Normalize(s string) (out string, mapToOrig []int) {
	runes, nfcMap := nfcFrom([]rune(s))
	var b strings.Builder
	b.Grow(len(runes))
	mapToOrig = make([]int, 0, len(runes))
	prevSpace := false
	for i, r := range runes {
		if r == ZWNJ || unicode.IsSpace(r) || IsApprovedPunctuation(r) {
			if !prevSpace && b.Len() > 0 {
				b.WriteRune(' ')
				mapToOrig = append(mapToOrig, nfcMap[i])
			}
			prevSpace = true
			continue
		}
		if invisibleRunes[r] {
			continue // نامرئی: نه حرف است نه مرز — وضعیت فاصلهٔ قبلی دست نمی‌خورد
		}
		prevSpace = false
		if pf, ok := presentationForms[r]; ok {
			// شکل نمایشی ← صورت پایه؛ هر نویسهٔ حاصل از همان قواعد عبور می‌کند (ي←ی، اعراب حذف…)
			for _, pr := range pf {
				if e := mapN1Rune(pr); e != 0 {
					b.WriteRune(e)
					mapToOrig = append(mapToOrig, nfcMap[i])
				}
			}
			continue
		}
		if e := mapN1Rune(r); e != 0 {
			b.WriteRune(e)
			mapToOrig = append(mapToOrig, nfcMap[i])
		}
	}
	res := b.String()
	for len(res) > 0 && res[len(res)-1] == ' ' {
		res = res[:len(res)-1]
		if len(mapToOrig) > 0 {
			mapToOrig = mapToOrig[:len(mapToOrig)-1]
		}
	}
	return res, mapToOrig
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

// Trigrams سه‌گانه‌های نویسه‌ای متمایز متن (بر پایهٔ code point).
// برای پیش‌فیلتر «عبارت دقیق» روی text_n1: اگر عبارت خام در متن اصلی با مرز واژه
// آمده باشد، شکل نرمال آن زیررشتهٔ n1 است و پس همهٔ سه‌گانه‌هایش در n1 هست
// (صدا: پیش‌فیلتر شامل هر passage دارای تطبیق واقعی است — verifier نهایی روی متن اصلی می‌ماند).
// متن کوتاه‌تر از ۳ نویسه خروجی ندارد (پیش‌فیلتر ممکن نیست؛ caller باید fallback داشته باشد).
func Trigrams(s string) []string {
	rs := []rune(s)
	if len(rs) < 3 {
		return nil
	}
	seen := make(map[string]bool, len(rs))
	out := make([]string, 0, len(rs))
	for i := 0; i+3 <= len(rs); i++ {
		t := string(rs[i : i+3])
		if !seen[t] {
			seen[t] = true
			out = append(out, t)
		}
	}
	return out
}

// WordBoundary بررسی مرز واژه در متن نرمال: نویسهٔ قبل/بعد حرف/رقم نباشند.
func WordBoundary(s string, start, end int) bool {
	return WordBoundaryRunes([]rune(s), start, end)
}

// WordBoundaryRunes همان WordBoundary روی متنی که از پیش به rune تبدیل شده است.
func WordBoundaryRunes(rs []rune, start, end int) bool {
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

// mapN1Rune نگاشت تک‌نویسهٔ N1؛ صفر یعنی حذف (اعراب و تطویل).
func mapN1Rune(r rune) rune {
	switch {
	case ArabicDiacritics[r] || r == '\u0640':
		return 0
	case digitMap[r] != 0:
		return digitMap[r]
	case r == 'ي':
		return 'ی'
	case r == 'ك':
		return 'ک'
	case r < 0x250 && unicode.IsUpper(r):
		return unicode.ToLower(r)
	}
	return r
}

// mapN0Rune نگاشت تک‌نویسهٔ N0 (اعراب حفظ؛ فقط تطویل حذف).
func mapN0Rune(r rune) rune {
	switch {
	case r == '\u0640':
		return 0
	case digitMap[r] != 0:
		return digitMap[r]
	case r == 'ي':
		return 'ی'
	case r == 'ك':
		return 'ک'
	case r < 0x250 && unicode.IsUpper(r):
		return unicode.ToLower(r)
	}
	return r
}
