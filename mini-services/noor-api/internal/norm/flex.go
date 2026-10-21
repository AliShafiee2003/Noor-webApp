package norm

// flex.go — انعطاف کنترل‌شدهٔ فارسی و عربی (n1-1.4.0).
//
// اصل: متن اصلی و L1 دست نمی‌خورند. هر انعطاف یا در L2 است (تفاوت نمایش یک نویسه)
// یا در L3 با برچسب قاعدهٔ اعمال‌شده؛ هیچ قاعده‌ای تمام ترکیب‌ها را نمایه نمی‌کند.
//   - L2: «ۀ» = «هٔ» = «ه»؛ رقم بالانویس و ارجاع چسبیدهٔ «[۱]» واژه نیستند.
//   - N2 (L3 یک‌به‌یک): جدول بستهٔ گونه‌های املایی واژگانی (مسئله/مسأله، داود/داوود …).
//   - L3 چندواژه‌ای (FlexVariants): پیوستگی پسوند/پیشوند، یای اضافه، واژه‌های مرکب
//     بسته، اختصارهای دعایی؛ و فقط با انتخاب کاربر، صورت صرفی جمع/مفرد.

import (
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"
)

func init() {
	// ۀ (U+06C0) = «ه» + نشانهٔ اضافه (U+0654). N1 نشانه را مانند اعراب حذف می‌کند و N0
	// نگهش می‌دارد؛ پس «خانۀ»، «خانهٔ» و «خانه» در L2 برابرند و قید اعراب هم سازگار می‌ماند.
	presentationForms['\u06C0'] = "\u0647\u0654"
}

// ---------------------------------------------------------------------------
// جدول واژگانی N2 (یک‌به‌یک، تعداد واژه ثابت)

type lexEntry struct {
	from, to string
	stem     bool // با پسوندهای بستهٔ lexSuffixes هم اعمال شود
	label    string
}

// lexicalTable کلیدها در «صورت حرفی N2» (پس از n2Chars) نوشته شده‌اند.
// «شئون/شؤون» عمداً نیامده: صورت N2 «شیون» با واژهٔ فارسی «شیون» برخورد می‌کند.
var lexicalTable = []lexEntry{
	{"مسیله", "مساله", true, "همزه روی کرسی"},
	{"مسیول", "مسوول", true, "همزه روی کرسی"},
	{"هییت", "هیات", true, "همزه روی کرسی"},
	{"سیوال", "سوال", true, "همزه روی کرسی"},
	{"داوود", "داود", false, "گونهٔ املایی نام"},
	{"طاووس", "طاوس", false, "گونهٔ املایی نام"},
	{"کاووس", "کاوس", false, "گونهٔ املایی نام"},
	{"رحمن", "رحمان", false, "رسم‌الخط"},
	{"انچ", "انچه", false, "املای کهن"},
}

var lexSuffixes = []string{"", "ها", "های", "هایی", "ات", "ی", "یت", "ین", "ان"}

var lexByFrom = func() map[string]lexEntry {
	m := make(map[string]lexEntry, len(lexicalTable))
	for _, e := range lexicalTable {
		m[e.from] = e
	}
	return m
}()

var lexStemsByLen = func() []lexEntry {
	var out []lexEntry
	for _, e := range lexicalTable {
		if e.stem {
			out = append(out, e)
		}
	}
	sort.Slice(out, func(i, j int) bool { return len(out[i].from) > len(out[j].from) })
	return out
}()

// lexCanon صورت N2 را با جدول واژگانی یکسان می‌کند؛ ok=false یعنی مدخلی نبود.
func lexCanon(n2 string) (string, bool) {
	if e, ok := lexByFrom[n2]; ok {
		return e.to, true
	}
	for _, e := range lexStemsByLen {
		if strings.HasPrefix(n2, e.from) {
			rest := n2[len(e.from):]
			for _, s := range lexSuffixes {
				if rest == s && rest != "" {
					return e.to + rest, true
				}
			}
		}
	}
	return n2, false
}

// LexicalLabel اگر دو واژهٔ N1 فقط با جدول واژگانی هم‌ارز شده‌اند، برچسب آن را برمی‌گرداند.
func LexicalLabel(a, b string) string {
	na, nb := n2Chars(a), n2Chars(b)
	ca, oka := lexCanon(na)
	cb, okb := lexCanon(nb)
	if (oka || okb) && ca == cb {
		for _, e := range lexicalTable {
			if strings.HasPrefix(na, e.from) || strings.HasPrefix(nb, e.from) {
				return e.label
			}
		}
		return "گونهٔ املایی مصوب"
	}
	return ""
}

// ---------------------------------------------------------------------------
// ال تعریف

// alExceptions واژه‌هایی که «ال» آغازشان حرف تعریف نیست یا حذفش واژهٔ دیگری می‌سازد
// (صورت N2). هر دو سو (افزودن و حذف) با این فهرست مسدود می‌شود.
var alExceptions = map[string]bool{
	"الله": true, "اللهم": true, "الهام": true, "الماس": true, "البته": true, "الگو": true,
	"الف": true, "الان": true, "الوان": true, "القاب": true, "الفاظ": true, "الطاف": true,
	"الحاق": true, "الزام": true, "التزام": true, "التماس": true, "التهاب": true, "الکل": true,
	"الهی": true, "الهیات": true, "الیاف": true, "الوهیت": true, "البرز": true, "الا": true,
	"الی": true, "الذی": true, "التی": true, "الذین": true, "اللتی": true, "اللذان": true,
	"اللتان": true, "اللاتی": true, "اللایی": true, "الیه": true, "الیک": true, "الیهم": true,
	"الیها": true, "الیکم": true, "البسه": true, "الحان": true, "الواح": true, "الهه": true,
	"الکترون": true, "الکتریکی": true, "الکتریک": true, "الگوها": true, "الاغ": true,
	"البوم": true, "الماسه": true, "الوار": true, "الک": true, "الو": true, "التفات": true,
	"التیام": true, "الغا": true, "القا": true, "الهامات": true,
}

func alBlocked(withAl string) bool { return alExceptions[withAl] }

// ---------------------------------------------------------------------------
// گونه‌های چندواژه‌ای L3

// Variant یک گونهٔ پذیرفته‌شدهٔ پرسش (یک ویرایش نسبت به پرسش اصلی).
type Variant struct {
	Words []string // صورت N1 واژه‌های گونه
	Label string   // برچسب تفاوت برای نمایش
	Kind  string   // spacing | ezafe | honorific | morph
	Tight []int    // j: میان Words[j] و Words[j+1] در متن فقط فاصله/نیم‌فاصله مجاز است
	Paren []int    // j: Words[j] در متن باید درون پرانتز باشد (اختصار دعایی)
	New   []string // واژه‌های تازه‌ای که باید در واژگان نسل باشند (پاسبان)
	Group string   // گونه‌های هم‌گروه سقف مشترک دارند
}

// Variant kinds.
const (
	KindSpacing   = "spacing"
	KindEzafe     = "ezafe"
	KindHonorific = "honorific"
	KindMorph     = "morph"
)

// VariantOptions گزینه‌های تولید گونه.
type VariantOptions struct {
	QueryParen []bool // واژهٔ i پرسش درون پرانتز نوشته شده است
	Morph      bool   // صورت صرفی جمع/مفرد (فقط با انتخاب صریح کاربر)
	Kinds      map[string]bool
}

var persianSuffixesLongFirst = []string{"هایی", "های", "ترین", "ها", "تر"}

// suffixSplitExceptions واژه‌هایی که پایانشان پسوند نیست (صورت N1).
var suffixSplitExceptions = map[string]bool{
	"تنها": true, "انتها": true, "ابتها": true, "منتها": true, "کلها": true, "منها": true,
	"عنها": true, "فیها": true, "علیها": true, "الیها": true, "لها": true, "بها": true,
	"وبها": true, "معها": true, "بعدها": true, "قبلها": true, "تحتها": true, "فوقها": true,
	"کبوتر": true, "انگشتر": true, "دختر": true, "دفتر": true, "بستر": true, "اختر": true,
	"استر": true,
}

var shortStemOK = map[string]bool{"آن": true, "این": true, "کم": true}

// persianCompounds مرکب‌های بسته (صورت پیوسته ← اجزا).
var persianCompounds = map[string][]string{
	"آنکه": {"آن", "که"}, "اینکه": {"این", "که"}, "آنچه": {"آن", "چه"}, "چنانکه": {"چنان", "که"},
	"چنانچه": {"چنان", "چه"}, "هرچه": {"هر", "چه"}, "هرکه": {"هر", "که"}, "هرگاه": {"هر", "گاه"},
	"هرکس": {"هر", "کس"}, "آنجا": {"آن", "جا"}, "اینجا": {"این", "جا"}, "آنگاه": {"آن", "گاه"},
	"هیچکس": {"هیچ", "کس"}, "هیچگاه": {"هیچ", "گاه"}, "چونکه": {"چون", "که"}, "همچنین": {"هم", "چنین"},
	"همچنان": {"هم", "چنان"}, "آنها": {"آن", "ها"}, "اینها": {"این", "ها"},
}

var compoundByParts = func() map[[2]string]string {
	m := map[[2]string]string{}
	for k, v := range persianCompounds {
		m[[2]string{v[0], v[1]}] = k
	}
	return m
}()

type abbr struct {
	word  string
	paren bool
}

type honorificGroup struct {
	id   string
	abbr []abbr
	full [][]string
}

// honorifics جدول بستهٔ اختصارهای دعایی. هم‌ارزی فقط میان «اختصار» و «صورت کامل» است؛
// دو صورت کامل متفاوت (مثلاً «وآله» و «وسلم») هم‌ارز شمرده نمی‌شوند و برچسب نتیجه
// صورت دقیق متن را نشان می‌دهد.
var honorifics = []honorificGroup{
	{"nabi", []abbr{{"ص", true}, {"ﷺ", false}, {"صلعم", true}}, [][]string{
		{"صلی", "الله", "علیه", "وآله"}, {"صلی", "الله", "علیه", "و", "آله"},
		{"صلی", "الله", "علیه", "وآله", "وسلم"}, {"صلی", "الله", "علیه", "و", "آله", "و", "سلم"},
		{"صلی", "الله", "علیه", "وسلم"}, {"صلی", "الله", "علیه", "و", "سلم"},
	}},
	{"alayh", []abbr{{"ع", true}}, [][]string{
		{"علیه", "السلام"}, {"علیهم", "السلام"}, {"علیها", "السلام"}, {"علیهما", "السلام"},
	}},
	{"sa", []abbr{{"س", true}}, [][]string{{"سلام", "الله", "علیها"}}},
	{"ajj", []abbr{{"عج", true}}, [][]string{
		{"عجل", "الله", "تعالی", "فرجه", "الشریف"}, {"عجل", "الله", "فرجه", "الشریف"},
		{"عجل", "الله", "تعالی", "فرجه"}, {"عجل", "الله", "فرجه"},
	}},
	{"rah", []abbr{{"ره", true}}, [][]string{{"رحمه", "الله"}, {"رحمه", "الله", "علیه"}}},
	{"qudd", []abbr{{"قده", true}}, [][]string{
		{"قدس", "سره"}, {"قدس", "الله", "سره"}, {"قدس", "الله", "روحه"}, {"قدس", "سره", "الشریف"},
	}},
	{"rad", []abbr{{"رض", true}}, [][]string{{"رضی", "الله", "عنه"}, {"رضی", "الله", "عنها"}, {"رضی", "الله", "عنهم"}}},
	{"jalla", []abbr{{"ﷻ", false}}, [][]string{{"جل", "جلاله"}}},
}

// صورت‌های N2 جدول دعایی یک بار در init محاسبه می‌شوند؛ HonorificMask در هر پنجرهٔ L4
// صدا زده می‌شود و باید O(n) با ثابت کوچک بماند.
type honN2 struct {
	abbr []string   // N2 هر abbr (هم‌اندیس g.abbr)
	full [][]string // N2 هر صورت کامل
}

var (
	honorificsN2   []honN2
	honFullByFirst map[string][][]string // N2 واژهٔ نخست ← صورت‌های کامل
)

func init() {
	honFullByFirst = map[string][][]string{}
	for _, g := range honorifics {
		var h honN2
		for _, a := range g.abbr {
			h.abbr = append(h.abbr, WordToN2(a.word))
		}
		for _, f := range g.full {
			fn := make([]string, len(f))
			for j, w := range f {
				fn[j] = WordToN2(w)
			}
			h.full = append(h.full, fn)
			honFullByFirst[fn[0]] = append(honFullByFirst[fn[0]], fn)
		}
		honorificsN2 = append(honorificsN2, h)
	}
}

func runeLen(s string) int { return len([]rune(s)) }

func abbrLabel(a abbr) string {
	if a.paren {
		return "(" + a.word + ")"
	}
	return a.word
}

// FlexVariants گونه‌های L3 پرسش را تولید می‌کند. هر گونه دقیقاً یک ویرایش است (ترکیب
// ضربی ساخته نمی‌شود)؛ ترتیب خروجی اولویت است: قواعد بسته پیش از قواعد عمومی.
// پاسبانی واژگانی (New) و سقف شمار گونه‌ها با فراخوان است.
func FlexVariants(n1 []string, opt VariantOptions) []Variant {
	n := len(n1)
	if n == 0 {
		return nil
	}
	allow := func(k string) bool { return opt.Kinds == nil || opt.Kinds[k] }
	var out []Variant
	seen := map[string]bool{strings.Join(n1, " "): true}
	emit := func(i, k int, repl []string, v Variant) {
		ws := make([]string, 0, n-k+len(repl))
		ws = append(ws, n1[:i]...)
		ws = append(ws, repl...)
		ws = append(ws, n1[i+k:]...)
		key := strings.Join(ws, " ")
		if seen[key] {
			return
		}
		seen[key] = true
		for x := range v.Tight {
			v.Tight[x] += i
		}
		for x := range v.Paren {
			v.Paren[x] += i
		}
		v.Words = ws
		out = append(out, v)
	}
	paren := func(i int) bool { return i < len(opt.QueryParen) && opt.QueryParen[i] }
	qn2 := make([]string, n)
	for i, w := range n1 {
		qn2[i] = WordToN2(w)
	}

	// ۱. اختصارهای دعایی (جدول بسته؛ بدون پاسبان واژگانی)
	if allow(KindHonorific) {
		for i := 0; i < n; i++ {
			for gi, g := range honorifics {
				hn := honorificsN2[gi]
				for ai, a := range g.abbr {
					if qn2[i] != hn.abbr[ai] || (a.paren && !paren(i)) {
						continue
					}
					for _, f := range g.full {
						emit(i, 1, f, Variant{Kind: KindHonorific, Group: "hon:" + g.id,
							Label: "اختصار دعایی: «" + abbrLabel(a) + "» ↔ «" + strings.Join(f, " ") + "»"})
					}
					for _, b := range g.abbr {
						if b == a {
							continue
						}
						v := Variant{Kind: KindHonorific, Group: "hon:" + g.id,
							Label: "اختصار دعایی: «" + abbrLabel(a) + "» ↔ «" + abbrLabel(b) + "»"}
						if b.paren {
							v.Paren = []int{0}
						}
						emit(i, 1, []string{b.word}, v)
					}
				}
				for fi, f := range g.full {
					if i+len(f) > n {
						continue
					}
					match := true
					for j := range f {
						if qn2[i+j] != hn.full[fi][j] {
							match = false
							break
						}
					}
					if !match {
						continue
					}
					for _, a := range g.abbr {
						v := Variant{Kind: KindHonorific, Group: "hon:" + g.id,
							Label: "اختصار دعایی: «" + strings.Join(f, " ") + "» ↔ «" + abbrLabel(a) + "»"}
						if a.paren {
							v.Paren = []int{0}
						}
						emit(i, len(f), []string{a.word}, v)
					}
				}
			}
		}
	}

	if allow(KindSpacing) {
		for i := 0; i < n; i++ {
			w := n1[i]
			// ۲. مرکب‌های بسته
			if parts, ok := persianCompounds[w]; ok {
				emit(i, 1, []string{parts[0], parts[1]}, Variant{Kind: KindSpacing, Group: "cmp:" + w,
					Tight: []int{0}, Label: "تفاوت پیوستگی: «" + w + "» ↔ «" + parts[0] + " " + parts[1] + "»"})
			}
			if i+1 < n {
				if c, ok := compoundByParts[[2]string{w, n1[i+1]}]; ok {
					emit(i, 2, []string{c}, Variant{Kind: KindSpacing, Group: "cmp:" + c,
						Label: "تفاوت پیوستگی: «" + w + " " + n1[i+1] + "» ↔ «" + c + "»"})
				}
			}
			// ۳. پیشوند فعلی می/نمی
			for _, pre := range []string{"نمی", "می"} {
				if w == pre && i+1 < n {
					j := pre + n1[i+1]
					emit(i, 2, []string{j}, Variant{Kind: KindSpacing, Group: "pre:" + j, New: []string{j},
						Label: "تفاوت پیوستگی: «" + pre + " " + n1[i+1] + "» ↔ «" + j + "»"})
				} else if strings.HasPrefix(w, pre) && runeLen(w)-runeLen(pre) >= 3 {
					stem := w[len(pre):]
					emit(i, 1, []string{pre, stem}, Variant{Kind: KindSpacing, Group: "pre:" + w, New: []string{stem},
						Tight: []int{0}, Label: "تفاوت پیوستگی: «" + w + "» ↔ «" + pre + " " + stem + "»"})
					break // «نمی» پیش از «می» آزموده می‌شود
				}
			}
			// ۴. پسوندهای جمع و تفضیل (فقط پیوستگی؛ مفرد/جمع جداست)
			if i+1 < n {
				for _, s := range persianSuffixesLongFirst {
					if n1[i+1] == s && runeLen(w) >= 2 && !isDigits(w) {
						j := w + s
						emit(i, 2, []string{j}, Variant{Kind: KindSpacing, Group: "sfx:" + j, New: []string{j},
							Label: "تفاوت پیوستگی: «" + w + " " + s + "» ↔ «" + j + "»"})
						break
					}
				}
			}
			if !suffixSplitExceptions[w] {
				for _, s := range persianSuffixesLongFirst {
					if !strings.HasSuffix(w, s) {
						continue
					}
					stem := w[:len(w)-len(s)]
					if runeLen(stem) >= 3 || shortStemOK[stem] {
						emit(i, 1, []string{stem, s}, Variant{Kind: KindSpacing, Group: "sfx:" + w, New: []string{stem},
							Tight: []int{0}, Label: "تفاوت پیوستگی: «" + w + "» ↔ «" + stem + " " + s + "»"})
					}
					break
				}
			}
			// ۵. «به» پیوسته (فقط از گسسته به پیوسته؛ شکستن «بـ» آغازین مثبت کاذب زیاد دارد)
			if w == "به" && i+1 < n && runeLen(n1[i+1]) >= 3 {
				j := "ب" + n1[i+1]
				emit(i, 2, []string{j}, Variant{Kind: KindSpacing, Group: "be:" + j, New: []string{j},
					Label: "تفاوت پیوستگی: «به " + n1[i+1] + "» ↔ «" + j + "»"})
			}
		}
		// ۶. مرکب عمومی (پرسش کوتاه): پیوستن دو واژهٔ مجاور / شکستن یک واژهٔ بلند؛
		// هر دو با پاسبان واژگانی و هر گروه حداکثر دو گونه (سقف با فراخوان).
		if n <= 6 {
			for i := 0; i+1 < n; i++ {
				a, b := n1[i], n1[i+1]
				if runeLen(a) < 2 || runeLen(b) < 2 || isDigits(a) || isDigits(b) || isFunctionWord(a) || isFunctionWord(b) {
					continue
				}
				j := a + b
				emit(i, 2, []string{j}, Variant{Kind: KindSpacing, Group: "gen:" + j, New: []string{j},
					Label: "تفاوت پیوستگی (مرکب): «" + a + " " + b + "» ↔ «" + j + "»"})
			}
			for i := 0; i < n; i++ {
				rs := []rune(n1[i])
				if len(rs) < 6 || isDigits(n1[i]) || (rs[0] == 'ا' && rs[1] == 'ل') {
					continue
				}
				for p := 3; p+3 <= len(rs); p++ {
					a, b := string(rs[:p]), string(rs[p:])
					if isFunctionWord(a) || isFunctionWord(b) {
						continue
					}
					emit(i, 1, []string{a, b}, Variant{Kind: KindSpacing, Group: "gen:" + n1[i], New: []string{a, b},
						Tight: []int{0}, Label: "تفاوت پیوستگی (مرکب): «" + n1[i] + "» ↔ «" + a + " " + b + "»"})
				}
			}
		}
	}

	// ۷. یای اضافه/میانجی: «خانهٔ علم» ↔ «خانه‌ی علم» (پرسش کوتاه)
	if allow(KindEzafe) && n <= 8 {
		for i := 0; i+1 < n; i++ {
			w := n1[i]
			if !strings.HasSuffix(w, "ه") || runeLen(w) < 2 {
				continue
			}
			if n1[i+1] == "ی" {
				emit(i, 2, []string{w}, Variant{Kind: KindEzafe, Group: "ez:" + w,
					Label: "یای اضافه: «" + w + "‌ی» ↔ «" + w + "»"})
			} else {
				emit(i, 1, []string{w, "ی"}, Variant{Kind: KindEzafe, Group: "ez:" + w, Tight: []int{0},
					Label: "یای اضافه: «" + w + "» ↔ «" + w + "‌ی»"})
			}
		}
	}

	// ۸. صورت صرفی جمع/مفرد با «ها» — فقط با انتخاب صریح کاربر و برای پرسش کوتاه
	if opt.Morph && allow(KindMorph) && n <= 4 {
		for i := 0; i < n; i++ {
			w := n1[i]
			if isDigits(w) || isFunctionWord(w) || runeLen(w) < 3 {
				continue
			}
			if i+1 < n && (n1[i+1] == "ها" || n1[i+1] == "های") {
				emit(i, 2, []string{w}, Variant{Kind: KindMorph, Group: "mor:" + w,
					Label: "صورت صرفی (مفرد): «" + w + " " + n1[i+1] + "» ↔ «" + w + "»"})
				continue
			}
			if strings.HasSuffix(w, "ها") && !suffixSplitExceptions[w] && runeLen(w) >= 5 {
				stem := strings.TrimSuffix(w, "ها")
				emit(i, 1, []string{stem}, Variant{Kind: KindMorph, Group: "mor:" + w, New: []string{stem},
					Label: "صورت صرفی (مفرد): «" + w + "» ↔ «" + stem + "»"})
				continue
			}
			if strings.HasSuffix(w, "ها") || strings.HasSuffix(w, "های") {
				continue
			}
			emit(i, 1, []string{w, "ها"}, Variant{Kind: KindMorph, Group: "mor:" + w, Tight: []int{0},
				Label: "صورت صرفی (جمع): «" + w + "» ↔ «" + w + "‌ها»"})
			emit(i, 1, []string{w + "ها"}, Variant{Kind: KindMorph, Group: "mor:" + w, New: []string{w + "ها"},
				Label: "صورت صرفی (جمع): «" + w + "» ↔ «" + w + "ها»"})
		}
	}
	return out
}

// functionWords واژه‌های دستوری پرکاربرد که در قواعد عمومی مرکب‌سازی شرکت نمی‌کنند.
var functionWords = map[string]bool{
	"و": true, "در": true, "به": true, "از": true, "که": true, "را": true, "با": true, "این": true,
	"آن": true, "تا": true, "بر": true, "یا": true, "هم": true, "نه": true, "من": true, "فی": true,
	"علی": true, "الی": true, "عن": true, "ما": true, "لا": true, "ان": true, "قد": true, "ثم": true,
	"او": true, "هو": true, "هی": true, "ای": true, "ها": true, "های": true, "ی": true,
}

func isFunctionWord(w string) bool { return functionWords[w] }

func isDigits(w string) bool {
	if w == "" {
		return false
	}
	for _, r := range w {
		if !unicode.IsDigit(r) {
			return false
		}
	}
	return true
}

// ---------------------------------------------------------------------------
// عبارت دعایی در L4

// honorificSingle اختصارهای تک‌واژه‌ای که در متن عملاً فقط اختصار دعایی‌اند
// («ره» و «س» عمداً نیامده‌اند: واژهٔ عادی هم هستند).
var honorificSingle = map[string]bool{"ع": true, "ص": true, "عج": true, "قده": true, "رض": true, "صلعم": true, "ﷺ": true, "ﷻ": true}

// HonorificMask برای دنبالهٔ واژه‌های N2، واژه‌هایی را که جزء یک عبارت دعایی شناخته‌شده‌اند
// علامت می‌زند. aligner افزودن/حذف این واژه‌ها را ارزان‌تر و با برچسب جدا گزارش می‌کند.
func HonorificMask(n2 []string) []bool {
	mask := make([]bool, len(n2))
	for i := range n2 {
		if honorificSingle[n2[i]] {
			mask[i] = true
		}
		for _, f := range honFullByFirst[n2[i]] {
			if i+len(f) > len(n2) {
				continue
			}
			ok := true
			for j := range f {
				if n2[i+j] != f[j] {
					ok = false
					break
				}
			}
			if ok {
				for j := range f {
					mask[i+j] = true
				}
			}
		}
	}
	return mask
}

// ---------------------------------------------------------------------------
// ارجاع پاورقی چسبیده

// isFootnoteRef آیا واژه‌ای که از بایت bs تا be در text است، شمارهٔ ارجاع چسبیده
// به شکل «واژه[۱]» است؟ (فقط کروشهٔ چسبیده به حرف پیشین؛ «(۱)» و «[ ۱ ]» شماره‌اند.)
func isFootnoteRef(text string, bs, be int) bool {
	// بررسی‌های تک‌بایتی پیش از پیمایش واژه (تقریباً همهٔ واژه‌ها همین‌جا رد می‌شوند)
	if bs < 2 || be >= len(text) || text[be] != ']' || text[bs-1] != '[' || !isDigits(text[bs:be]) {
		return false
	}
	// نویسهٔ پیش از «[»: حرف یا علامت (اعراب) — یعنی بدون فاصله به واژه چسبیده است
	r, _ := utf8.DecodeLastRuneInString(text[:bs-1])
	return unicode.IsLetter(r) || unicode.Is(unicode.Mn, r)
}
