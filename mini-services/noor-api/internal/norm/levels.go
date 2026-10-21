// Package norm — سطوح سه‌گانهٔ هم‌تراز N0، N1، N2 و واژه‌بندی دوواژه‌ای (§۱۶/§۲۰/§۲۱).
// اصل اساسی: واژه‌بندی یک‌بار انجام می‌شود و سطوح N0/N1/N2 تعداد واژه‌ها را تغییر نمی‌دهند.
// هر سطح فقط تابع خود واژه است (L1 ⊆ L2 ⊆ L3).
package norm

import (
	"strings"
	"sync"
	"sync/atomic"
	"unicode"
	"unicode/utf8"
)

// BigramSeparator نویسهٔ اتصال دوواژه‌ای غیر ASCII (U+00B7 · Middle Dot).
// در FTS5 با tokenizer ascii، این نویسه بخشی از واژه شمرده می‌شود و جدا نمی‌شود.
const BigramSeparator = "\u00B7"

// BoundaryMarker نشانهٔ مرز سخت در آخرین موضع یا پیش از مرز جریان.
const BoundaryMarker = "§"

// AlignedToken یک واژه با سه سطح نرمال‌سازی هم‌تراز و موقعیت دقیق در متن منبع.
type AlignedToken struct {
	Surface string `json:"surface"` // شکل در متن اصلی
	N0      string `json:"n0"`      // تمام قواعد N1 به‌جز حذف اعراب
	N1      string `json:"n1"`      // نرمال‌شدهٔ اصلی
	N2      string `json:"n2"`      // آزاد (همزه، ة/ه، رسم‌الخط قرآنی)
	Start   int    `json:"start"`   // آفست آغاز بر حسب Unicode code point
	End     int    `json:"end"`     // آفست پایان بر حسب Unicode code point (بازهٔ نیمه‌باز)
}

// QuranicOrthographyMap جدول بستهٔ رسم‌الخط قرآنی و کهن به املای معیار (§۱۶).
// کلیدها و مقدارها در «صورت حرفی N2» نوشته شده‌اند (ة→ه، ى→ی، همزه/الف یکسان) تا
// خروجی جدول با خروجی قواعد حرفی N2 هم‌خوان باشد. پیش از اصلاح، مقدار «الصلاة»
// با ة برمی‌گشت در حالی که N2 متن معیار «الصلاه» بود و این دو هرگز برابر نمی‌شدند.
// هر مدخل یک واژه را به یک واژه نگاشت می‌کند (تعداد واژه‌ها تغییر نمی‌کند).
var QuranicOrthographyMap = map[string]string{
	"الصلوه":  "الصلاه",
	"صلوه":    "صلاه",
	"صلوتک":   "صلاتک",
	"صلوتهم":  "صلاتهم",
	"الزکوه":  "الزکاه",
	"زکوه":    "زکاه",
	"الحیوه":  "الحیاه",
	"حیوه":    "حیاه",
	"النجوه":  "النجاه",
	"نجوه":    "نجاه",
	"الغدوه":  "الغداه",
	"غدوه":    "غداه",
	"مشکوه":   "مشکاه",
	"کمشکوه":  "کمشکاه",
	"الربوا":  "الربا",
	"ربوا":    "ربا",
	"الربو":   "الربا",
	"ابرهیم":  "ابراهیم",
	"اسمعیل":  "اسماعیل",
	"اسحق":    "اسحاق",
	"السموت":  "السماوات",
	"سموت":    "سماوات",
	"السموات": "السماوات",
	"سموات":   "سماوات",
	"الرحمن":  "الرحمان",
	"هرون":    "هارون",
	"سلیمن":   "سلیمان",
	"لقمن":    "لقمان",
}

// quranicNormalized نسخهٔ جدول پس از اعمال قواعد حرفی N2 روی کلید و مقدار —
// تضمین می‌کند که حتی اگر مدخلی با ة/أ/ى نوشته شود، با خروجی N2 جور بماند.
var quranicNormalized = func() map[string]string {
	out := make(map[string]string, len(QuranicOrthographyMap))
	for k, v := range QuranicOrthographyMap {
		out[n2Chars(k)] = n2Chars(v)
	}
	return out
}()

// NormalizeN0 سطح N0: تمام قواعد N1 را اعمال می‌کند به جز حذف اعراب.
// اعراب، تشدید، تنوین و سکون حفظ می‌شوند (SEARCH-N0).
func NormalizeN0(s string) (out string, mapToOrig []int) {
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
			continue
		}
		prevSpace = false
		if pf, ok := presentationForms[r]; ok {
			for _, pr := range pf {
				if e := mapN0Rune(pr); e != 0 {
					b.WriteRune(e)
					mapToOrig = append(mapToOrig, nfcMap[i])
				}
			}
			continue
		}
		if e := mapN0Rune(r); e != 0 { // فقط تطویل حذف می‌شود، اعراب حفظ می‌شوند
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

// NormalizeN1 همان نرمال‌سازی استاندارد N1 است (NFC + حذف اعراب و تطویل + ي/ك + ارقام).
func NormalizeN1(s string) (out string, mapToOrig []int) {
	return Normalize(s)
}

// n2Rune قاعدهٔ حرفی N2 برای یک نویسه؛ ok=false یعنی نویسه حذف شود.
func n2Rune(r rune) rune {
	switch r {
	case 'أ', 'إ', 'آ', 'ٱ', 'ٲ', 'ٳ':
		return 'ا'
	case 'ؤ':
		return 'و'
	case 'ئ', 'ى', 'ي':
		return 'ی'
	case 'ة', 'ۀ', 'ہ', 'ە':
		return 'ه'
	case 'ك':
		return 'ک'
	}
	return r
}

// n2Chars قواعد حرفی N2 روی یک رشتهٔ N1 (بدون جداسازی پیشوند).
// همزهٔ منفرد «ء» درون واژه حذف می‌شود؛ اگر کل واژه همان همزه باشد حفظ می‌شود.
func n2Chars(n1 string) string {
	runes := []rune(n1)
	var b strings.Builder
	b.Grow(len(n1))
	for i, r := range runes {
		if r == 'ء' {
			if (i > 0 && unicode.IsLetter(runes[i-1])) || (i+1 < len(runes) && unicode.IsLetter(runes[i+1])) {
				continue
			}
		}
		b.WriteRune(n2Rune(r))
	}
	return b.String()
}

// NormalizeN2 سطح N2 روی متن: N1 به‌علاوهٔ یکسان‌سازی‌های حرفی مصوب (همزه، ة/ه، ى/ی)
// و جدول رسم‌الخط قرآنی برای هر واژه. نگاشت به متن اصلی حفظ می‌شود.
// برای متن چندواژه‌ای جدول قرآنی واژه‌به‌واژه اعمال می‌شود (پیش‌تر فقط وقتی کل متن
// یک واژه بود اثر داشت).
func NormalizeN2(s string) (out string, mapToOrig []int) {
	n1, origMap := Normalize(s)
	runes := []rune(n1)
	var b strings.Builder
	b.Grow(len(runes))
	mapToOrig = make([]int, 0, len(runes))
	flushWord := func(word []rune, maps []int) {
		w := n2Chars(string(word))
		if q, ok := quranicNormalized[w]; ok {
			w = q
		} else if c, ok := lexCanon(w); ok {
			w = c
		} else if q, ok := quranicNormalizedStem(string(word)); ok {
			// «والصلوة» ← ساقه در جدول است؛ مقدار جدول با همان پیشوند برمی‌گردد
			w = q
		}
		wr := []rune(w)
		for i, r := range wr {
			b.WriteRune(r)
			// نگاشت: نویسه‌های اضافه/کم‌شده به نزدیک‌ترین نویسهٔ واژهٔ اصل
			j := i
			if j >= len(maps) {
				j = len(maps) - 1
			}
			if j >= 0 {
				mapToOrig = append(mapToOrig, maps[j])
			} else {
				mapToOrig = append(mapToOrig, 0)
			}
		}
	}
	var word []rune
	var wmap []int
	for i, r := range runes {
		o := 0
		if i < len(origMap) {
			o = origMap[i]
		}
		if r == ' ' {
			if len(word) > 0 {
				flushWord(word, wmap)
				word, wmap = word[:0], wmap[:0]
			}
			b.WriteRune(' ')
			mapToOrig = append(mapToOrig, o)
			continue
		}
		word = append(word, r)
		wmap = append(wmap, o)
	}
	if len(word) > 0 {
		flushWord(word, wmap)
	}
	return b.String(), mapToOrig
}

// arabicStemPrefixes پیشوندهای چسبان برای جست‌وجوی ساقه در جدول قرآنی (n1-1.3.0).
var arabicStemPrefixes = []string{"وال", "بال", "فال", "کال", "لل", "ال", "و", "ف", "ب", "ل", "ک"}

// quranicNormalizedStem اگر واژهٔ N1 با پیشوند چسبان به مدخل جدول قرآنی می‌رسد،
// مقدار جدول را با همان پیشوند برمی‌گرداند؛ در غیر این صورت خالی.
func quranicNormalizedStem(n1 string) (string, bool) {
	r := []rune(n1)
	for _, p := range arabicStemPrefixes {
		pr := []rune(p)
		if len(r) > len(pr) && string(r[:len(pr)]) == p {
			if q, ok := quranicNormalized[n2Chars(string(r[len(pr):]))]; ok {
				return p + q, true
			}
		}
	}
	return "", false
}

// ArabicPrefixes فهرست بستهٔ پیشوندهای چسبان عربی از بلندترین به کوتاه‌ترین (§۱۶).
var ArabicPrefixes = []string{
	"وال", "بال", "فال", "کال", "لل", "ال",
	"و", "ف", "ب", "ل", "ک",
}

// StripArabicPrefix پیشوندهای چسبان عربی را «تهاجمی» جدا می‌کند. این تابع دیگر در N2
// به‌کار نمی‌رود (پیش‌تر «الله→له»، «کتاب→تاب» و «وزیر→زیر» می‌ساخت و L3 را آلوده
// می‌کرد)؛ فقط برای کلید نمایهٔ بازکاربرد (ReuseKey) استفاده می‌شود که صرفاً کاندید
// می‌سازد و هر کاندید با aligner روی متن واقعی سنجیده می‌شود.
func StripArabicPrefix(w string) string {
	runes := []rune(w)
	for _, p := range ArabicPrefixes {
		pRunes := []rune(p)
		minStem := 2
		if len(pRunes) == 1 {
			minStem = 3
		}
		if len(runes) >= len(pRunes)+minStem && strings.HasPrefix(w, p) {
			return string(runes[len(pRunes):])
		}
	}
	return w
}

// WordToN2 تبدیل یک تک‌واژهٔ N1 به N2: قواعد حرفی مصوب + جدول رسم‌الخط قرآنی.
// N2 تابع خود واژه و بدون حدس صرفی است؛ پیشوندهای چسبان (و/ف/ب/ل/ک/ال) در N2
// حذف نمی‌شوند، بلکه در L3 به‌صورت گسترش زمان پرس‌وجو (N2Alternatives) با برچسب
// تفاوت «پیشوند و» و … سنجیده می‌شوند.
func WordToN2(w string) string {
	n2 := n2Chars(w)
	if q, ok := quranicNormalized[n2]; ok {
		return q
	}
	if c, ok := lexCanon(n2); ok {
		return c
	}
	// «والصلوة»/«بالزکوة»: ساقهٔ پس از پیشوند چسبان در جدول قرآنی — همان قاعدهٔ NormalizeN2
	// (پیش‌تر فقط NormalizeN2 آن را داشت و مسیر توکن/نمایه بی‌اثر می‌ماند).
	if q, ok := quranicNormalizedStem(w); ok {
		return q
	}
	if n2 == "" {
		return w
	}
	return n2
}

// ReuseKey کلید «هم‌ارزی آزاد» واژه: N2 به‌علاوهٔ جداسازی تهاجمی پیشوندهای چسبان.
// این کلید در ستون n2k نمایهٔ عبارت و در نمایهٔ بازکاربرد متن (winnowing) به‌کار می‌رود
// و فقط «کاندید» می‌سازد؛ تطبیق نهایی L3 با N2Alternatives و برچسب تفاوت انجام می‌شود
// و L4 با aligner. پس برخورد کاذب کلید (مثلاً «فلان»→«لان») فقط کاندید اضافه است.
//
// ویژگی لازم (آزموده در TestReuseKeyCoversAlternatives): برای هر a در N2Alternatives(w)
// داریم ReuseKey(a.Form) == ReuseKey(w)؛ یعنی جست‌وجوی عبارت روی n2k ابرمجموعهٔ کامل
// همهٔ تطبیق‌های L1 تا L3 است.
func ReuseKey(n2 string) string {
	r := []rune(n2)
	// ۱. حذف مکرر و/ف عطف (طول ≥ ۴) — تکرار، سازگاری key(و+w)=key(w) را تضمین می‌کند
	for len(r) >= 4 && (r[0] == 'و' || r[0] == 'ف') {
		r = r[1:]
	}
	// ۲. ب/ک پیش از ال؛ لل → ال؛ حالت ویژهٔ لله → الله
	switch {
	case len(r) >= 5 && (r[0] == 'ب' || r[0] == 'ک') && r[1] == 'ا' && r[2] == 'ل':
		r = r[1:]
	case string(r) == "لله":
		r = []rune("الله")
	case len(r) >= 4 && r[0] == 'ل' && r[1] == 'ل':
		r = append([]rune{'ا'}, r[1:]...)
	}
	// ۳. حرف تعریف (ساقهٔ دست‌کم ۳ حرف)
	if len(r) >= 5 && r[0] == 'ا' && r[1] == 'ل' {
		r = r[2:]
	}
	return string(r)
}

// wordLevels سطوح N0/N1/N2 یک واژهٔ سطحی؛ تابعی خالص از surface است و نتیجه در کش کران‌دار
// نگه داشته می‌شود (توزیع Zipf واژه‌ها → نرخ برخورد بالا). راستی‌آزمایی FTS5 هر passage کاندید
// را دوباره واژه‌بندی می‌کند و بدون این کش، NFC/N0/N1/N2 هر واژه گلوگاه بود.
func wordLevels(surface string) (n0, n1, n2 string) {
	if l, ok := levelCache.get(surface); ok {
		return l.n0, l.n1, l.n2
	}
	n0, _ = NormalizeN0(surface)
	n1, _ = NormalizeN1(surface)
	n2 = WordToN2(n1)
	if len(surface) <= 64 {
		// Clone: کلید نباید کل متن passage (رشتهٔ والد برش) را در حافظه نگه دارد
		levelCache.put(strings.Clone(surface), levels3{strings.Clone(n0), strings.Clone(n1), strings.Clone(n2)})
	}
	return n0, n1, n2
}

type levels3 struct{ n0, n1, n2 string }

// levelsCache کش «عکس فوری + افزوده»: مسیر خواندن (پرتکرار) فقط یک atomic load و یک
// جست‌وجوی map[string] بی‌قفل است (≈۲٫۴ برابر سریع‌تر از sync.Map با کلید any). واژه‌های تازه
// در pending زیر قفل جمع می‌شوند و وقتی pending به ¼ عکس فوری رسید در عکس تازه ادغام می‌شوند
// (هزینهٔ سرشکن O(1) برای هر درج). با رسیدن به سقف، کل کش تخلیه می‌شود (همان رفتار قبلی).
type levelsCache struct {
	snap    atomic.Pointer[map[string]levels3] // فقط‌خواندنی؛ هرگز درجا تغییر نمی‌کند
	mu      sync.Mutex
	pending map[string]levels3
}

const levelCacheCap = 500_000 // حداکثر واژهٔ متمایز در کش (~۶۰ مگابایت در بدترین حالت)

var levelCache = newLevelsCache()

func newLevelsCache() *levelsCache {
	c := &levelsCache{pending: map[string]levels3{}}
	empty := map[string]levels3{}
	c.snap.Store(&empty)
	return c
}

func (c *levelsCache) get(s string) (levels3, bool) {
	if l, ok := (*c.snap.Load())[s]; ok {
		return l, true
	}
	c.mu.Lock()
	l, ok := c.pending[s]
	c.mu.Unlock()
	return l, ok
}

func (c *levelsCache) put(s string, l levels3) {
	c.mu.Lock()
	defer c.mu.Unlock()
	snap := *c.snap.Load()
	if _, ok := snap[s]; ok {
		return
	}
	if len(snap)+len(c.pending) >= levelCacheCap {
		// تخلیهٔ کامل: ساده و کران‌دار
		empty := map[string]levels3{}
		c.snap.Store(&empty)
		c.pending = map[string]levels3{}
		snap = empty
	}
	c.pending[s] = l
	if len(c.pending) >= 1024 && len(c.pending) >= len(snap)/4 {
		merged := make(map[string]levels3, len(snap)+len(c.pending))
		for k, v := range snap {
			merged[k] = v
		}
		for k, v := range c.pending {
			merged[k] = v
		}
		c.snap.Store(&merged)
		c.pending = map[string]levels3{}
	}
}

// decodeRune رمزگشایی درون‌خطی برای ASCII و نویسه‌های دوبایتی (عربی/فارسی، U+0080..U+07FF)؛
// بقیه به utf8.DecodeRuneInString سپرده می‌شوند. خروجی دقیقاً همان DecodeRuneInString است.
func decodeRune(s string, i int) (rune, int) {
	c := s[i]
	if c < utf8.RuneSelf {
		return rune(c), 1
	}
	if c >= 0xC2 && c <= 0xDF && i+1 < len(s) {
		if c1 := s[i+1]; c1&0xC0 == 0x80 {
			return rune(c&0x1F)<<6 | rune(c1&0x3F), 2
		}
	}
	return utf8.DecodeRuneInString(s[i:])
}

// tokenizeInvalid مسیر کند هم‌ارز []rune برای UTF-8 نامعتبر: هر بایت نامعتبر یک U+FFFD و یک
// موضع code point است. اعتبار در همان پیمایش اصلی کشف می‌شود (نه یک گذر جدای ValidString).
func tokenizeInvalid(text string) []AlignedToken {
	return TokenizeAligned(string([]rune(text)))
}

// TokenizeAligned متن را یک بار واژه‌بندی کرده و برای هر واژه سه سطح N0، N1 و N2 را استخراج می‌کند.
// این تابع منبع واحد حقیقت (Single Source of Truth) برای شمارش و مرز واژه‌هاست (§۱۶/§۲۱).
func TokenizeAligned(text string) []AlignedToken {
	if text == "" {
		return nil
	}
	// پیش‌تخصیص: شمار فاصله‌ها (جست‌وجوی بایتی سریع) کران پایین خوبی برای شمار واژه‌هاست؛
	// تخمین طولی قبلی (len/10) برای واژه‌های کوتاه چند بار growslice می‌داد.
	tokens := make([]AlignedToken, 0, strings.Count(text, " ")+strings.Count(text, "\n")+2)
	// پیمایش مستقیم رشته: offsetها code point‌اند (نه بایت) و surface برش بی‌تخصیص رشته است
	cp := 0 // شمارندهٔ code point
	i := 0  // موضع بایت
	n := len(text)
	for i < n {
		// گذشتن از فاصله‌ها و علائم نگارشی جداکننده
		for i < n {
			r, sz := decodeRune(text, i)
			if r == utf8.RuneError && sz == 1 {
				return tokenizeInvalid(text)
			}
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
			r, sz := decodeRune(text, i)
			if r == utf8.RuneError && sz == 1 {
				return tokenizeInvalid(text)
			}
			if isSeparator(r) {
				break
			}
			i += sz
			cp++
		}
		surface := text[bStart:i]
		if isFootnoteRef(text, bStart, i) {
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
		tokens = append(tokens, AlignedToken{Surface: surface, N0: n0, N1: n1, N2: n2, Start: start, End: cp})
	}
	return tokens
}

// IsApprovedPunctuation علائم نگارشی مصوب که در قرارداد N1 به مرز تبدیل می‌شوند (§۱۶).
// n1-1.2.0: گیومه‌های خمیده، خط تیرهٔ کوتاه، سه‌نقطه، پرانتز تزیینی قرآنی ﴾﴿،
// نشانه‌های ۞ و ۩، ستارهٔ عربی ٭، نقطهٔ اردو ۔، و نویسه‌های رزرو موتور (· و §) نیز مرزند.
// · (U+00B7) و § (U+00A7) باید مرز باشند تا هرگز درون واژهٔ N1 نیایند؛ وگرنه
// دوواژه‌ای «a·b» مبهم و نشانهٔ مرز سخت جعل‌پذیر می‌شد.
func IsApprovedPunctuation(r rune) bool {
	switch r {
	case '.', ',', ':', ';', '!', '?', '،', '؛', '؟', '«', '»', '(', ')', '[', ']', '{', '}', '"', '\'', '-', '—', '/', '*', '_', '+', '=', '<', '>', '|', '~', '^',
		'`', '\\',
		'\u201C', '\u201D', '\u201E', '\u201F', '\u2018', '\u2019', '\u201A', '\u201B', '\u2039', '\u203A',
		'\u2010', '\u2011', '\u2012', '\u2013', '\u2015', '\u2026', '\u2022',
		'\uFD3E', '\uFD3F', '\u06DE', '\u06E9', '\u066D', '\u06D4', '\u060D', '\u061E',
		'\u00B7', '\u00A7',
		// n1-1.4.0: رقم‌های بالانویس/زیرنویس نشانهٔ پاورقی‌اند، نه بخشی از واژه («علم¹»)
		'\u00B9', '\u00B2', '\u00B3', '\u2070', '\u2074', '\u2075', '\u2076', '\u2077', '\u2078', '\u2079',
		'\u2080', '\u2081', '\u2082', '\u2083', '\u2084', '\u2085', '\u2086', '\u2087', '\u2088', '\u2089':
		return true
	}
	return false
}

func isSeparator(r rune) bool {
	// مسیر سریع: حروف و حرکات عربی (U+0621..U+065F) هیچ‌گاه جداکننده نیستند
	if r >= 0x0621 && r <= 0x065F {
		return false
	}
	if unicode.IsSpace(r) || r == ZWNJ || r == '\r' || r == '\n' || r == '\t' {
		return true
	}
	return IsApprovedPunctuation(r)
}

// BuildBigrams دنبالهٔ دوواژه‌ای‌ها را از یک لیست واژه می‌سازد (§۲۱).
// در موضع i: اتصال واژهٔ i و i+1 با BigramSeparator.
// در آخرین موضع: واژه با BoundaryMarker جفت می‌شود تا طول فهرست با unigram برابر بماند.
func BuildBigrams(words []string) []string {
	n := len(words)
	if n == 0 {
		return nil
	}
	out := make([]string, n)
	for i := 0; i < n-1; i++ {
		out[i] = words[i] + BigramSeparator + words[i+1]
	}
	out[n-1] = words[n-1] + BigramSeparator + BoundaryMarker
	return out
}

// FormatForFTS واژه‌ها را با یک فاصله جهت درج در جدول contentless FTS5 با tokenize="ascii" آماده می‌کند.
func FormatForFTS(words []string) string {
	return strings.Join(words, " ")
}

// QueryToBigramPhrase عبارت پرس‌وجوی m واژه‌ای (m >= 2) را به عبارت دوواژه‌ای FTS5 ترجمه می‌کند (§۲۱).
// مثال: "قال رسول الله" -> "قال·رسول رسول·الله"
func QueryToBigramPhrase(words []string) string {
	if len(words) < 2 {
		if len(words) == 1 {
			return words[0]
		}
		return ""
	}
	var b strings.Builder
	for i := 0; i < len(words)-1; i++ {
		if i > 0 {
			b.WriteRune(' ')
		}
		b.WriteString(words[i])
		b.WriteString(BigramSeparator)
		b.WriteString(words[i+1])
	}
	return b.String()
}

// FTSToken واژهٔ نرمال‌شده را برای درج/پرس‌وجو در FTS5 با tokenizer «ascii» امن می‌کند.
// tokenizer ascii هر نویسهٔ ASCII غیرحرفی‌عددی را جداکننده می‌داند؛ پس واژه‌ای مثل
// «50%» یا «C#» در FTS5 به چند واژه یا هیچ واژه می‌شکست و مواضع ستون‌ها از واژه‌بندی Go
// جدا می‌افتاد. اینجا هر بایت ASCII غیرحرفی‌عددی به یک نویسهٔ ناحیهٔ خصوصی یونیکد
// (U+E000+b) نگاشت می‌شود؛ نگاشت یک‌به‌یک و برگشت‌پذیر است و هر واژهٔ Go دقیقاً یک
// واژهٔ FTS5 می‌ماند. نویسه‌های بزرگ ASCII کوچک می‌شوند.
func FTSToken(w string) string {
	clean := true
	for i := 0; i < len(w); i++ {
		c := w[i]
		if c < 0x80 && !(c >= '0' && c <= '9' || c >= 'a' && c <= 'z') {
			clean = false
			break
		}
	}
	if clean && w != "" {
		return w
	}
	if w == "" {
		return "\uE000"
	}
	var b strings.Builder
	b.Grow(len(w) + 8)
	for _, r := range w {
		switch {
		case r >= 'A' && r <= 'Z':
			b.WriteRune(r + ('a' - 'A'))
		case r < 0x80 && !(r >= '0' && r <= '9' || r >= 'a' && r <= 'z'):
			b.WriteRune(0xE000 + r)
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}

// FTSPhrase واژه‌ها را به یک عبارت نقل‌قول‌شدهٔ FTS5 تبدیل می‌کند ("a b c").
// چون FTSToken هیچ نویسهٔ ASCII غیرحرفی‌عددی (از جمله ") باقی نمی‌گذارد، عبارت
// همیشه از نظر نحوی امن است.
func FTSPhrase(words []string) string {
	var b strings.Builder
	b.WriteByte('"')
	for i, w := range words {
		if i > 0 {
			b.WriteByte(' ')
		}
		b.WriteString(FTSToken(w))
	}
	b.WriteByte('"')
	return b.String()
}

// Alt یک صورت جایگزین برای واژهٔ پرسش در L3 همراه با برچسب تفاوت.
type Alt struct {
	Form string // صورت N2 قابل‌قبول در متن
	Diff string // برچسب تفاوت برای نمایش («پیشوند و»، …)؛ خالی = همان صورت
}

// proclitic برچسب‌های پیشوندهای چسبان.
var procliticLabel = map[rune]string{'و': "پیشوند و", 'ف': "پیشوند ف", 'ب': "پیشوند ب", 'ل': "پیشوند ل", 'ک': "پیشوند ک"}

// N2Alternatives صورت‌های قابل‌قبول L3 برای یک واژهٔ N2 پرسش (§۱۶/§۲۰) — گسترش زمان
// پرس‌وجو به‌جای حذف پیشوند در نمایه. قواعد بسته و محافظه‌کارانه است:
//   - خود واژه؛
//   - افزودن «و»/«ف» عطف به آغاز واژه (وقال، فقال)؛
//   - برای واژهٔ دارای «ال»: افزودن «ب/ک/و/ف» پیش از ال و «لل» (بالله، کالبحر، للمؤمنین)؛
//     و حالت ویژهٔ «الله ↔ لله»؛
//   - برعکس: اگر پرسش خودش پیشوند و/ف (با ساقهٔ دست‌کم ۳ حرف) یا ب/ک/و/ف+ال یا لل
//     داشته باشد، صورت بی‌پیشوند نیز پذیرفته می‌شود.
//
// نتیجهٔ L3 همیشه با برچسب تفاوت نمایش داده می‌شود و هرگز در L1/L2 نمی‌آید.
func N2Alternatives(w string) []Alt {
	out := []Alt{{Form: w}}
	seen := map[string]bool{w: true}
	// همزه روی کرسی (مسئله/مسأله …) دیگر اینجا نیست: جدول واژگانی N2 (flex.go) هر دو
	// صورت را به یک N2 می‌رساند تا کلید بازیابی n2k هم یکسان باشد (پیش‌تر گونهٔ
	// «همزه روی کرسی» کلید متفاوت داشت و کاندیدش هرگز واکشی نمی‌شد).
	key := ReuseKey(w)
	add := func(f, d string) {
		// ناوردایی بازیابی: گونه‌ای که کلید n2k متفاوت دارد هرگز کاندید نمی‌شود؛ پس پذیرفته نمی‌شود
		if f != "" && !seen[f] && len([]rune(f)) >= 2 && ReuseKey(f) == key {
			seen[f] = true
			out = append(out, Alt{Form: f, Diff: d})
		}
	}
	r := []rune(w)
	if len(r) < 2 {
		return out
	}
	hasAl := len(r) >= 4 && r[0] == 'ا' && r[1] == 'ل'
	// افزودن پیشوند (فقط برای واژهٔ دست‌کم سه‌حرفی؛ «ومن/فما» دو‌حرفی‌ها را گسترش نمی‌دهیم)
	if len(r) >= 3 {
		add("و"+w, "پیشوند و")
		add("ف"+w, "پیشوند ف")
	}
	if hasAl {
		add("ب"+w, "پیشوند ب")
		add("ک"+w, "پیشوند ک")
		add("وب"+w, "پیشوند وب")
		add("ل"+string(r[1:]), "پیشوند ل")
		add("ول"+string(r[1:]), "پیشوند ول")
		add("فل"+string(r[1:]), "پیشوند فل")
	}
	// ال تعریف (L3، دوسویه، با فهرست استثنا): «کتاب» ↔ «الکتاب» و صورت‌های پیشونددارِ آن
	if !hasAl && len(r) >= 3 && !alBlocked("ال"+w) {
		add("ال"+w, "ال تعریف")
		add("وال"+w, "ال تعریف + پیشوند و")
		add("فال"+w, "ال تعریف + پیشوند ف")
		add("بال"+w, "ال تعریف + پیشوند ب")
		add("کال"+w, "ال تعریف + پیشوند ک")
		if r[0] != 'ل' {
			add("لل"+w, "ال تعریف + پیشوند ل")
		}
	}
	if hasAl && len(r) >= 5 && !alBlocked(w) {
		add(string(r[2:]), "ال تعریف (در پرسش)")
	}
	if w == "الله" {
		add("لله", "پیشوند ل")
		add("ولله", "پیشوند ول")
		add("فلله", "پیشوند فل")
	}
	// حذف پیشوندِ موجود در پرسش
	if len(r) >= 4 && (r[0] == 'و' || r[0] == 'ف') {
		add(string(r[1:]), procliticLabel[r[0]]+" (در پرسش)")
	}
	if len(r) >= 5 && (r[0] == 'ب' || r[0] == 'ک' || r[0] == 'و' || r[0] == 'ف') && r[1] == 'ا' && r[2] == 'ل' {
		add(string(r[1:]), procliticLabel[r[0]]+" (در پرسش)")
	}
	if len(r) >= 4 && r[0] == 'ل' && r[1] == 'ل' {
		if w == "لله" {
			add("الله", "پیشوند ل (در پرسش)")
		} else {
			add("ا"+string(r[1:]), "پیشوند ل (در پرسش)")
		}
	}
	if w == "لله" {
		add("الله", "پیشوند ل (در پرسش)")
	}
	return out
}

// DiacriticsCompatible قید اعراب (§۱۵): هر علامتی که کاربر روی هر حرف گذاشته باید
// روی همان حرف در متن هم باشد؛ متن می‌تواند علامت بیشتری داشته باشد (اعراب ناقص پرسش
// مجاز است). حروف پایه با قواعد N1 مقایسه می‌شوند؛ اگر تعداد حروف پایه برابر نباشد
// سازگار نیست. ورودی‌ها صورت سطحی (Surface) یا N0 هستند.
//
// سیاست «حرف بی‌حرکت در متن» (§۱۵): پیش‌فرض «سازگار» — حرفی که در متن هیچ علامتی ندارد
// قید را نقض نمی‌کند (متون اعراب ناقص دارند)؛ ولی اگر آن حرف در متن علامت دارد، باید همهٔ
// علامت‌های پرسش را داشته باشد (تشدید، تنوین و سکون هرکدام علامت مستقل‌اند).
func DiacriticsCompatible(query, doc string) bool { return diacriticsCompatible(query, doc, false) }

// DiacriticsCompatibleStrict گونهٔ سخت‌گیرانه: حرف بی‌حرکت در متن هم ناسازگار است.
func DiacriticsCompatibleStrict(query, doc string) bool {
	return diacriticsCompatible(query, doc, true)
}

func diacriticsCompatible(query, doc string, strict bool) bool {
	qb, qm := splitMarks(query)
	db, dm := splitMarks(doc)
	if len(qb) != len(db) {
		return false
	}
	for i := range qb {
		if len(qm[i]) == 0 {
			continue
		}
		if len(dm[i]) == 0 && !strict {
			continue // حرف در متن بی‌اعراب است: ساکت، نه متناقض
		}
		for m := range qm[i] {
			if !dm[i][m] {
				return false
			}
		}
	}
	return true
}

// DiacriticsCompatibleAligned همان قید اعراب برای جفت‌های L3 که فقط در پیشوند (ال، و، ب …)
// تفاوت دارند: حروف پایه از انتها هم‌تراز می‌شوند و قید روی ساقهٔ مشترک سنجیده می‌شود.
// اعرابِ پرسش روی پیشوندی که در متن نیست نادیده گرفته می‌شود (تفاوتش در برچسب L3 هست).
func DiacriticsCompatibleAligned(query, doc string, strict bool) bool {
	qb, qm := splitMarks(query)
	db, dm := splitMarks(doc)
	if len(qb) == len(db) {
		return diacriticsCompatible(query, doc, strict)
	}
	k := len(qb)
	if len(db) < k {
		k = len(db)
	}
	for x := 1; x <= k; x++ {
		i, j := len(qb)-x, len(db)-x
		if qb[i] != db[j] {
			return false
		}
		if len(qm[i]) == 0 || (len(dm[j]) == 0 && !strict) {
			continue
		}
		for m := range qm[i] {
			if !dm[j][m] {
				return false
			}
		}
	}
	return true
}

// HasDiacritics آیا واژه/عبارت دست‌کم یک علامت اعراب دارد؟
func HasDiacritics(s string) bool {
	for _, r := range s {
		if ArabicDiacritics[r] {
			return true
		}
	}
	return false
}

func splitMarks(s string) ([]rune, []map[rune]bool) {
	n0, _ := NormalizeN0(s)
	var bases []rune
	var marks []map[rune]bool
	for _, r := range n0 {
		if ArabicDiacritics[r] {
			if len(marks) > 0 {
				if marks[len(marks)-1] == nil {
					marks[len(marks)-1] = map[rune]bool{}
				}
				marks[len(marks)-1][r] = true
			}
			continue
		}
		if r == ' ' {
			continue
		}
		bases = append(bases, r)
		marks = append(marks, nil)
	}
	return bases, marks
}

// EditDistance1 آیا a و b دقیقاً یک ویرایش حرفی (جایگزینی/حذف/افزودن یا جابه‌جایی دو
// حرف مجاور) فاصله دارند؟ برای «واژهٔ نزدیک» L4/L5 (§۲۳) — هر دو دست‌کم ۴ حرف.
func EditDistance1(a, b string) bool {
	if a == b {
		return false
	}
	// پیش‌پالایش بی‌تخصیص: طول code point (هر دو کمتر از ۴ یا اختلاف بیش از ۱ → نه)
	la, lb := utf8.RuneCountInString(a), utf8.RuneCountInString(b)
	if la < 4 || lb < 4 || la-lb > 1 || lb-la > 1 {
		return false
	}
	return EditDistance1Runes([]rune(a), []rune(b))
}

// EditDistance1Runes همان EditDistance1 روی برش‌های rune (برای فراخوان‌هایی که rune واژه را
// یک بار ساخته و بارها مقایسه می‌کنند — aligner و L5).
func EditDistance1Runes(ra, rb []rune) bool {
	la, lb := len(ra), len(rb)
	if la == lb {
		same := true
		for i := range ra {
			if ra[i] != rb[i] {
				same = false
				break
			}
		}
		if same {
			return false
		}
	}
	if la < 4 || lb < 4 {
		return false
	}
	if la == lb {
		diff := -1
		for i := 0; i < la; i++ {
			if ra[i] != rb[i] {
				if diff >= 0 {
					// جابه‌جایی مجاور؟
					if i == diff+1 && ra[diff] == rb[i] && ra[i] == rb[diff] {
						for j := i + 1; j < la; j++ {
							if ra[j] != rb[j] {
								return false
							}
						}
						return true
					}
					return false
				}
				diff = i
			}
		}
		return true
	}
	if la-lb == 1 || lb-la == 1 {
		if la < lb {
			ra, rb = rb, ra
		}
		// ra بلندتر است
		i, j, skipped := 0, 0, false
		for i < len(ra) && j < len(rb) {
			if ra[i] == rb[j] {
				i++
				j++
				continue
			}
			if skipped {
				return false
			}
			skipped = true
			i++
		}
		return true
	}
	return false
}

// PersianPrefixes پیشوندهای فعلی برای گونه‌های پیوسته/گسستهٔ موتور قدیمی (local).
// موتور FTS5 قواعد کامل‌تر (پسوندها، یای اضافه، مرکب‌ها) را از FlexVariants می‌گیرد.
var PersianPrefixes = []string{"می", "نمی"}

// GeneratePersianVariants گونه‌های پیوسته و گسستهٔ واژه‌های پرسش را تولید می‌کند (سقف ۱۶ ترکیب).
func GeneratePersianVariants(words []string) [][]string {
	if len(words) == 0 {
		return nil
	}
	res := [][]string{words}

	// ساخت گونه‌ها برای پیشوندهای می/نمی
	for i, w := range words {
		for _, pre := range PersianPrefixes {
			if w == pre && i+1 < len(words) {
				// صورت گسسته "می" + "گوید" -> صورت پیوسته "میگوید"
				merged := make([]string, 0, len(words)-1)
				merged = append(merged, words[:i]...)
				merged = append(merged, pre+words[i+1])
				merged = append(merged, words[i+2:]...)
				if len(res) < 16 {
					res = append(res, merged)
				}
			} else if strings.HasPrefix(w, pre) && len(w) > len(pre)+2 {
				// صورت پیوسته "میگوید" -> صورت گسسته "می" + "گوید"
				stem := strings.TrimPrefix(w, pre)
				split := make([]string, 0, len(words)+1)
				split = append(split, words[:i]...)
				split = append(split, pre, stem)
				split = append(split, words[i+1:]...)
				if len(res) < 16 {
					res = append(res, split)
				}
			}
		}
	}
	return res
}

// RuneCount طول رشته بر حسب Unicode code point.
func RuneCount(s string) int {
	return utf8.RuneCountInString(s)
}
