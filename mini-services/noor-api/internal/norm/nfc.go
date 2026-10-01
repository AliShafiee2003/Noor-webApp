// nfc.go — اعمال NFC (ترکیب کانونی یونیکد) با حفظ نگاشت به موقعیت متن اصلی (SEARCH-04).
//
// الگوریتم استاندارد UAX#15: تجزیهٔ کانونی کامل → ترتیب کانونی علامت‌ها → ترکیب.
// جدول‌ها در nfc_tables.go (تولیدشده از Unicode 15.0.0) و Hangul به‌صورت الگوریتمی.
// خروجی همراه یک آرایهٔ هم‌طول است: هر rune خروجی به ایندکس rune «متن اصلی»
// اشاره می‌کند؛ در ترکیب دو نویسه، مرکب به ایندکس شروع‌کننده (نخستین نویسه)
// نگاشت می‌شود و در تجزیه، همهٔ اجزا به همان نویسهٔ اصلی — تا ن1‌مپ همیشه به
// اصل اشاره کند و هایلایت جابه‌جا نشود.
package norm

// nfcChar نویسهٔ میانی با کلاس ترکیب و ایندکس مبدأ در متن اصلی.
type nfcChar struct {
	r   rune
	cc  uint8
	org int32
}

// ثابت‌های Hangul (ACP — الگوریتمی، خارج از جدول‌ها).
const (
	hSBase  = 0xAC00
	hLBase  = 0x1100
	hVBase  = 0x1161
	hTBase  = 0x11A7
	hLCount = 19
	hVCount = 21
	hTCount = 28
	hNCount = hVCount * hTCount
	hSCount = hLCount * hNCount
	hTMax   = hTBase + hTCount // 0x11C3 — انتهای بازهٔ T جامو
	hVMax   = hVBase + hVCount // 0x1176
	hLMax   = hLBase + hLCount // 0x1113
)

func isHangulSyllable(r rune) bool { d := r - hSBase; return d >= 0 && d < hSCount }
func isHangulL(r rune) bool        { return r >= hLBase && r < hLMax }
func isHangulV(r rune) bool        { return r >= hVBase && r < hVMax }
func isHangulT(r rune) bool        { return r > hTBase && r < hTMax }
func isHangulJamo(r rune) bool     { return (r >= hLBase && r < hTMax) || isHangulSyllable(r) }
func isHangulLV(r rune) bool {
	d := r - hSBase
	return d >= 0 && d < hSCount && d%hTCount == 0
}

// cccOf کلاس ترکیب کانونی نویسه (۰ یعنی شروع‌کننده).
func cccOf(r rune) uint8 {
	if c, ok := nfcCCC[r]; ok {
		return c
	}
	return 0
}

// nfcPlain بررسی سریع: اگر هیچ نویسه‌ای تجزیه/ترکیب‌پذیر یا علامت نباشد،
// ورودی از قبل NFC است (فقط مسیر بهینه — رفتار خروجی یکسان است).
func nfcPlain(rs []rune) bool {
	for _, r := range rs {
		if _, ok := nfcDecomp[r]; ok {
			return false
		}
		if _, ok := nfcCCC[r]; ok {
			return false
		}
		if isHangulJamo(r) {
			return false
		}
	}
	return true
}

// nfcFrom ورودی را به فرم NFC برمی‌گرداند به‌همراه نگاشت هر rune خروجی به ایندکس rune ورودی.
// اگر ورودی از قبل NFC باشد، خروجی دقیقاً همان ورودی است و نگاشت همانی.
func nfcFrom(rs []rune) ([]rune, []int) {
	if len(rs) == 0 {
		return nil, nil
	}
	if nfcPlain(rs) {
		m := make([]int, len(rs))
		for i := range m {
			m[i] = i
		}
		return rs, m
	}
	// ۱) تجزیهٔ کانونی کامل (+ Hangul الگوریتمی)
	seq := make([]nfcChar, 0, len(rs))
	for i, r := range rs {
		if isHangulSyllable(r) {
			d := r - hSBase
			l := hLBase + d/hNCount
			v := hVBase + (d%hNCount)/hTCount
			t := d % hTCount
			seq = append(seq, nfcChar{r: l, org: int32(i)}, nfcChar{r: v, org: int32(i)})
			if t != 0 {
				seq = append(seq, nfcChar{r: hTBase + t, org: int32(i)})
			}
			continue
		}
		if s, ok := nfcDecomp[r]; ok {
			for _, dr := range s {
				seq = append(seq, nfcChar{r: dr, cc: cccOf(dr), org: int32(i)})
			}
			continue
		}
		seq = append(seq, nfcChar{r: r, cc: cccOf(r), org: int32(i)})
	}
	// ۲) ترتیب کانونی علامت‌ها (پایدار؛ فقط علامت‌ها میان شروع‌کننده‌ها جابه‌جا می‌شوند)
	canonicalOrder(seq)
	// ۳) ترکیب کانونی — با حفظ ایندکس شروع‌کننده (مطابق الگوریتم مرجع UAX#15)
	out := make([]nfcChar, 0, len(seq))
	starterIdx := -1
	var lastCC uint8
	for i := range seq {
		ch := seq[i]
		// قاعدهٔ مسدودسازی: علامت فقط با آخرین شروع‌کننده ترکیب می‌شود اگر
		// علامتی با cc بزرگ‌تر یا مساوی میانشان نباشد (برای cc=۰ نیز فقط
		// در صورت نبود علامت میانی — لازمهٔ ترکیب Hangul L+V).
		if starterIdx >= 0 && (lastCC == 0 || ch.cc > lastCC) {
			st := &out[starterIdx]
			if isHangulL(st.r) && isHangulV(ch.r) {
				st.r = hSBase + (rune(st.r-hLBase)*hVCount+(ch.r-hVBase))*hTCount
				continue
			}
			if isHangulLV(st.r) && isHangulT(ch.r) {
				st.r += ch.r - hTBase
				continue
			}
			if c, ok := nfcComp[[2]rune{st.r, ch.r}]; ok {
				st.r = c
				continue
			}
		}
		lastCC = ch.cc // شروع‌کننده‌ها cc=۰ دارند
		if ch.cc == 0 {
			starterIdx = len(out)
		}
		out = append(out, ch)
	}
	// خروجی + نگاشت به اصل
	rs2 := make([]rune, len(out))
	m := make([]int, len(out))
	for i, c := range out {
		rs2[i] = c.r
		m[i] = int(c.org)
	}
	return rs2, m
}

// canonicalOrder مرتب‌سازی پایدار علامت‌ها بر پایهٔ CCC (فقط بین شروع‌کننده‌ها).
func canonicalOrder(seq []nfcChar) {
	for i := 1; i < len(seq); i++ {
		cc := seq[i].cc
		if cc == 0 {
			continue
		}
		j := i - 1
		for ; j >= 0 && seq[j].cc > cc; j-- {
		}
		if j+1 == i {
			continue
		}
		tmp := seq[i]
		copy(seq[j+2:i+1], seq[j+1:i])
		seq[j+1] = tmp
	}
}
