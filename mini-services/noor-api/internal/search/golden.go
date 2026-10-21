// golden — مجموعهٔ طلایی داده‌محور (ه-۱۳): پرس‌وجوهای پایدار روی fixture با انتظارِ
// نتیجه در فایل testdata/golden.json؛ همان فایل برای سنجش تطبیق دو موتور (الف-۴)
// به‌کار می‌رود: موتور OpenSearch با همان فایل می‌سنجد و تفاوت‌ها گزارش می‌شود.
package search

// Request نیازی به تغییر ندارد — همان ساختار API.

// GoldenFirst شاهد اولین ردیف‌های نتیجه (سند + بازهٔ تطبیق + صفحه).
type GoldenFirst struct {
	Doc   string `json:"doc"`
	Match [2]int `json:"match"`
	Page  string `json:"page"`
}

// GoldenExpect انتظار صادقانه از نتیجه — بدون وابستگی به متن snippet.
type GoldenExpect struct {
	Occurrences   int           `json:"occurrences"`
	Books         int           `json:"books"`
	Passages      int           `json:"passages"`
	CountRelation string        `json:"count_relation"`
	First         []GoldenFirst `json:"first"`
}

// GoldenCase یک پرس‌وجوی طلایی.
type GoldenCase struct {
	ID      string        `json:"id"`
	Group   string        `json:"group"`
	Note    string        `json:"note"`
	Request *Request      `json:"request"`
	Expect  *GoldenExpect `json:"expect,omitempty"` // در فایل تولیدی پر می‌شود
}

func scopeLib() Scope { return Scope{Target: "library"} }

// GoldenQueries فهرست ≥۱۰۰ پرس‌وجوی پوشش‌دهنده: عبارت دقیق، نرمال، نزدیک، زبانی،
// نقل بلند، استناد قرآنی، فیلتر نقش، scope و عنوان‌ها (ه-۱۳).
func GoldenQueries() []GoldenCase {
	var cs []GoldenCase
	add := func(group, note string, r *Request) {
		cs = append(cs, GoldenCase{ID: "g-" + pad3(len(cs)+1), Group: group, Note: note, Request: r})
	}
	pg := func() *int { p := 20; return &p }()

	// — عبارت دقیق (strict_phrase) — ۲۴
	add("strict", "عبارت طلایی تکرارشونده در کتاب الحج", &Request{Query: "الكعبة بيت الله", Mode: StrictPhrase, Scope: scopeLib(), PageSize: *pg})
	add("strict", "عبارت دقیق با ادامهٔ جمله", &Request{Query: "الكعبة بيت الله قبلة الناس", Mode: StrictPhrase, Scope: scopeLib(), PageSize: *pg})
	add("strict", "واژهٔ اعراب‌دار در متن (الحجِّ)", &Request{Query: "الحجِّ", Mode: StrictPhrase, Scope: scopeLib(), PageSize: *pg})
	add("strict", "عبارت با اعراب کامل", &Request{Query: "في كتابِ الحجِّ نُقلَ أنَّ الكعبة", Mode: StrictPhrase, Scope: scopeLib(), PageSize: *pg})
	add("strict", "بدون تطبیق — عبارت غیرواقعی", &Request{Query: "طائرة فضائية في الكعبة", Mode: StrictPhrase, Scope: scopeLib(), PageSize: *pg})
	add("strict", "ی فارسی نباید در متن عربیِ ی‌دار دقیق بخورد", &Request{Query: "الكعبة بيت الله", Mode: StrictPhrase, Scope: scopeLib(), PageSize: *pg})
	add("strict", "عبارت دقیق بین‌کتابی (عن أبي أبيه)", &Request{Query: "عن أبي أبيه", Mode: StrictPhrase, Scope: scopeLib(), PageSize: *pg})
	add("strict", "عبارت دقیق با شیخ الطبرسی", &Request{Query: "قال الشيخ الطبرسي في بحار الأنوار", Mode: StrictPhrase, Scope: scopeLib(), PageSize: *pg})
	add("strict", "فرق الرسول والنبي", &Request{Query: "الفرق بين الرسول والنبي", Mode: StrictPhrase, Scope: scopeLib(), PageSize: *pg})
	add("strict", "حدیث العلم با اعراب", &Request{Query: "العلم خيرٌ من المال", Mode: StrictPhrase, Scope: scopeLib(), PageSize: *pg})
	add("strict", "تک‌واژهٔ دقیق", &Request{Query: "قربان", Mode: StrictPhrase, Scope: scopeLib(), PageSize: *pg})
	add("strict", "عبارت دوواژه‌ای متوالی", &Request{Query: "الصلاة قُربان", Mode: StrictPhrase, Scope: scopeLib(), PageSize: *pg})
	add("strict", "مرز واژه — نیمهٔ واژه نباید بخورد", &Request{Query: "علم", Mode: StrictPhrase, Scope: scopeLib(), PageSize: *pg})
	add("strict", "عبارت با نیم‌فاصله در متن فارسی", &Request{Query: "هم‌نام صفحهٔ دیگر", Mode: StrictPhrase, Scope: scopeLib(), PageSize: *pg})
	add("strict", "متن فارسی سند آسمان", &Request{Query: "آفاق و انفس", Mode: StrictPhrase, Scope: scopeLib(), PageSize: *pg})
	add("strict", "عبارت دقیق واژه‌های مرزی", &Request{Query: "يوسف وإخوته", Mode: StrictPhrase, Scope: scopeLib(), PageSize: *pg})
	add("strict", "متن بند شمارهٔ ۱ کتاب الحج", &Request{Query: "بند شمارهٔ 1", Mode: StrictPhrase, Scope: scopeLib(), PageSize: *pg})
	add("strict", "عبارت دقیق در سند سفینه", &Request{Query: "الصادق عليه السلام", Mode: StrictPhrase, Scope: scopeLib(), PageSize: *pg})
	add("strict", "عبارت دقیق با ارقام عربی", &Request{Query: "الرحمن: ٣٣–٤١", Mode: StrictPhrase, Scope: scopeLib(), PageSize: *pg})
	add("strict", "پایان جمله", &Request{Query: "وأنت تَحرُسُ المال", Mode: StrictPhrase, Scope: scopeLib(), PageSize: *pg})
	add("strict", "عبارت دقیق صلاة", &Request{Query: "الصلاة قُربان كلُّ تقي", Mode: StrictPhrase, Scope: scopeLib(), PageSize: *pg})
	add("strict", "کوته‌ترین عبارت دوحرفی (بدون پیش‌فیلتر trigram)", &Request{Query: "عن", Mode: StrictPhrase, Scope: scopeLib(), PageSize: *pg})
	add("strict", "عبارت دقیق سند مبهم‌صفحه", &Request{Query: "مقدمهٔ مصحح", Mode: StrictPhrase, Scope: scopeLib(), PageSize: *pg})
	add("strict", "متن صفحهٔ دوازدهم سند مبهم", &Request{Query: "متن صفحهٔ دوازدهم", Mode: StrictPhrase, Scope: scopeLib(), PageSize: *pg})

	// — عبارت نرمال‌شده (normalized_phrase) — ۱۶
	add("normalized", "ی فارسی به جای ي عربی — نرمال یکی می‌کند", &Request{Query: "الكعبة بيت الله", Mode: NormalizedPhrase, Scope: scopeLib(), PageSize: *pg})
	add("normalized", "بدون اعراب بر متن اعراب‌دار", &Request{Query: "العلم خير من المال", Mode: NormalizedPhrase, Scope: scopeLib(), PageSize: *pg})
	add("normalized", "بدون اعراب صلاة", &Request{Query: "الصلاة قربان كل تقي", Mode: NormalizedPhrase, Scope: scopeLib(), PageSize: *pg})
	add("normalized", "ك عربی به جای ک فارسی در متن فارسی", &Request{Query: "در نرمال یکی‌اند اما در دقیق فرق دارند", Mode: NormalizedPhrase, Scope: scopeLib(), PageSize: *pg})
	add("normalized", "نقل وَهُوَ مَعَكُم بدون اعراب", &Request{Query: "وهو معكم أين ما كنتم", Mode: NormalizedPhrase, Scope: scopeLib(), PageSize: *pg})
	add("normalized", "عبارت نرمال با متن با اعراب کامل", &Request{Query: "في كتاب الحج نقل أن الكعبة بيت الله قبلة الناس", Mode: NormalizedPhrase, Scope: scopeLib(), PageSize: *pg})
	add("normalized", "ارقام فارسی به جای عربی", &Request{Query: "الرحمن: 33–41", Mode: NormalizedPhrase, Scope: scopeLib(), PageSize: *pg})
	add("normalized", "عبارت نرمال با فاصله‌های چندگانه", &Request{Query: "الكعبة  بيت   الله", Mode: NormalizedPhrase, Scope: scopeLib(), PageSize: *pg})
	add("normalized", "عبارت نرمالِ ایمان", &Request{Query: "باب ما الرسول وما النبي", Mode: NormalizedPhrase, Scope: scopeLib(), PageSize: *pg})
	add("normalized", "عبارت نرمال بدون تطبیق", &Request{Query: "النبی والرسول فرق معروف", Mode: NormalizedPhrase, Scope: scopeLib(), PageSize: *pg})
	add("normalized", "یوسف با ی فارسی (نرمال)", &Request{Query: "یوسف واخوته", Mode: NormalizedPhrase, Scope: scopeLib(), PageSize: *pg})
	add("normalized", "تطبیق در مقدمهٔ مؤلف", &Request{Query: "به قرآن شرح داده می‌شود", Mode: NormalizedPhrase, Scope: scopeLib(), PageSize: *pg})
	add("normalized", "عبارت نرمال در مقدمهٔ مصحح", &Request{Query: "این صفحهٔ الف مقدمهٔ مصحح است", Mode: NormalizedPhrase, Scope: scopeLib(), PageSize: *pg})
	add("normalized", "نقل اشارهٔ مؤلف", &Request{Query: "قربان یعنی نزدیک‌کننده", Mode: NormalizedPhrase, Scope: scopeLib(), PageSize: *pg})
	add("normalized", "عبارت نرمال در حاشیهٔ کتاب", &Request{Query: "اشارهٔ مؤلف", Mode: NormalizedPhrase, Scope: scopeLib(), PageSize: *pg})
	add("normalized", "عبارت نرمالِ سند مربوط به ابی‌ابیه", &Request{Query: "عن ابي ابيه", Mode: NormalizedPhrase, Scope: scopeLib(), PageSize: *pg})

	// — همهٔ واژه‌ها (all_words) — ۱۴
	add("all_words", "هر سه واژه در یک passage", &Request{Query: "الكعبة بيت الله", Mode: AllWords, Scope: scopeLib(), PageSize: *pg})
	add("all_words", "واژه‌های پراکنده", &Request{Query: "الرسول النبي الفرق", Mode: AllWords, Scope: scopeLib(), PageSize: *pg})
	add("all_words", "واژه‌ای که نیست → بدون نتیجه", &Request{Query: "الكعبة الزمرد", Mode: AllWords, Scope: scopeLib(), PageSize: *pg})
	add("all_words", "چهار واژه", &Request{Query: "العلم خير المال حرس", Mode: AllWords, Scope: scopeLib(), PageSize: *pg})
	add("all_words", "واژهٔ تکراری در پرس‌وجو (رگرسیون)", &Request{Query: "الرسول ما الرسول", Mode: AllWords, Scope: scopeLib(), PageSize: *pg})
	add("all_words", "واژه‌های متن فارسی", &Request{Query: "قرآن شرح داده", Mode: AllWords, Scope: scopeLib(), PageSize: *pg})
	add("all_words", "مخلوط فارسی/عربی", &Request{Query: "الكعبة قبلة", Mode: AllWords, Scope: scopeLib(), PageSize: *pg})
	add("all_words", "سه واژهٔ حديث صلاة", &Request{Query: "الصلاة قربان تقي", Mode: AllWords, Scope: scopeLib(), PageSize: *pg})
	add("all_words", "بدون نتیجه در فارسی", &Request{Query: "قورباغه سبز", Mode: AllWords, Scope: scopeLib(), PageSize: *pg})
	add("all_words", "ترکیب نقش‌دار", &Request{Query: "الطبرسي بحار الأنوار", Mode: AllWords, Scope: scopeLib(), PageSize: *pg})
	add("all_words", "واژه‌های صفحهٔ الف متن اصلی", &Request{Query: "الف متن اصلی متفاوت", Mode: AllWords, Scope: scopeLib(), PageSize: *pg})
	add("all_words", "واژه‌های سند مرزی", &Request{Query: "ی ک نرمال دقیق", Mode: AllWords, Scope: scopeLib(), PageSize: *pg})
	add("all_words", "واژه‌های نادر", &Request{Query: "الصادق الباقر", Mode: AllWords, Scope: scopeLib(), PageSize: *pg})
	add("all_words", "تک‌واژهٔ پرتکرار", &Request{Query: "الناس", Mode: AllWords, Scope: scopeLib(), PageSize: *pg})

	// — هر واژه (any_words) — ۸
	add("any_words", "یکی از دو واژه کافی است", &Request{Query: "الكعبة الصلاة", Mode: AnyWords, Scope: scopeLib(), PageSize: *pg})
	add("any_words", "ترکیب بی‌ربط", &Request{Query: "الزمرد الفيروزه", Mode: AnyWords, Scope: scopeLib(), PageSize: *pg})
	add("any_words", "سه واژهٔ متفاوت", &Request{Query: "العلم الصلاة الحج", Mode: AnyWords, Scope: scopeLib(), PageSize: *pg})
	add("any_words", "واژهٔ واحد", &Request{Query: "بحار", Mode: AnyWords, Scope: scopeLib(), PageSize: *pg})
	add("any_words", "فارسی و عربی", &Request{Query: "متن العلم", Mode: AnyWords, Scope: scopeLib(), PageSize: *pg})
	add("any_words", "بدون هیچ تطبیقی", &Request{Query: "غزال آهو", Mode: AnyWords, Scope: scopeLib(), PageSize: *pg})
	add("any_words", "واژه‌های مرزی سند edge", &Request{Query: "يُوسُفُ عربی", Mode: AnyWords, Scope: scopeLib(), PageSize: *pg})
	add("any_words", "واژهٔ تکراری پرس‌وجو", &Request{Query: "الله الله", Mode: AnyWords, Scope: scopeLib(), PageSize: *pg})

	// — نزدیکی (near) — ۱۰
	add("near", "دو واژهٔ نزدیک با slop=2", &Request{Query: "الفرق الرسول", Mode: Near, Scope: scopeLib(), Near: &NearOpts{Slop: 2, Ordered: false}, PageSize: *pg})
	add("near", "سه واژه با ترتیب", &Request{Query: "الفرق الرسول النبي", Mode: Near, Scope: scopeLib(), Near: &NearOpts{Slop: 3, Ordered: true}, PageSize: *pg})
	add("near", "با ترتیب غلط → بی‌نتیجه", &Request{Query: "النبي الفرق", Mode: Near, Scope: scopeLib(), Near: &NearOpts{Slop: 2, Ordered: true}, PageSize: *pg})
	add("near", "بدون ترتیب → تطبیق", &Request{Query: "النبي الفرق", Mode: Near, Scope: scopeLib(), Near: &NearOpts{Slop: 2, Ordered: false}, PageSize: *pg})
	add("near", "slop بزرگ", &Request{Query: "العلم المال", Mode: Near, Scope: scopeLib(), Near: &NearOpts{Slop: 6, Ordered: false}, PageSize: *pg})
	add("near", "slop صفر (مجاورت کامل)", &Request{Query: "بيت الله", Mode: Near, Scope: scopeLib(), Near: &NearOpts{Slop: 0, Ordered: false}, PageSize: *pg})
	add("near", "واژه‌های دور در متن فارسی", &Request{Query: "آفاق انفس قرآن", Mode: Near, Scope: scopeLib(), Near: &NearOpts{Slop: 4, Ordered: false}, PageSize: *pg})
	add("near", "بدون نتیجه", &Request{Query: "الكعبة الصلاة", Mode: Near, Scope: scopeLib(), Near: &NearOpts{Slop: 1, Ordered: false}, PageSize: *pg})
	add("near", "عبارت قرآنی نزدیک", &Request{Query: "معكم أين", Mode: Near, Scope: scopeLib(), Near: &NearOpts{Slop: 1, Ordered: true}, PageSize: *pg})
	add("near", "slop منفی معتبر نیست → رفتار پیش‌فرض", &Request{Query: "العلم المال", Mode: Near, Scope: scopeLib(), Near: &NearOpts{Slop: 0, Ordered: false}, PageSize: *pg})

	// — زبانی (linguistic — Fold) — ۱۰
	add("linguistic", "ة به جای ه", &Request{Query: "مدينة", Mode: Linguistic, Scope: scopeLib(), PageSize: *pg})
	add("linguistic", "ه به جای ة", &Request{Query: "مدينه", Mode: Linguistic, Scope: scopeLib(), PageSize: *pg})
	add("linguistic", "ا به جای أ (الأنبياء)", &Request{Query: "الانبياء", Mode: Linguistic, Scope: scopeLib(), PageSize: *pg})
	add("linguistic", "أ اصلی در حالت زبانی", &Request{Query: "الأنبياء", Mode: Linguistic, Scope: scopeLib(), PageSize: *pg})
	add("linguistic", "ی/ي در حالت زبانی", &Request{Query: "يوسف", Mode: Linguistic, Scope: scopeLib(), PageSize: *pg})
	add("linguistic", "عبارت زبانی با ه/ة", &Request{Query: "قربان كل تقي", Mode: Linguistic, Scope: scopeLib(), PageSize: *pg})
	add("linguistic", "نزدیک‌کننده (نیم‌فاصله + زبانی)", &Request{Query: "نزديک کننده", Mode: Linguistic, Scope: scopeLib(), PageSize: *pg})
	add("linguistic", "واژهٔ بدون همزه", &Request{Query: "احمد", Mode: Linguistic, Scope: scopeLib(), PageSize: *pg})
	add("linguistic", "عبارت دقیق‌خواهی در حالت زبانی", &Request{Query: "الكعبة بيت الله", Mode: Linguistic, Scope: scopeLib(), PageSize: *pg})
	add("linguistic", "کلمهٔ مرزی ي فارسی", &Request{Query: "كلمه", Mode: Linguistic, Scope: scopeLib(), PageSize: *pg})

	// — نقل بلند (long_quote) — ۶
	add("long_quote", "نقل بلند کامل بند الحج", &Request{Query: "في كتابِ الحجِّ نُقلَ أنَّ الكعبة بيت الله قبلة الناس", Mode: LongQuote, Scope: scopeLib(), PageSize: *pg})
	add("long_quote", "نقل بلند روایت الرسول والنبي", &Request{Query: "إنَّ الفرق بين الرسول والنبي في الاصطلاح معروف", Mode: LongQuote, Scope: scopeLib(), PageSize: *pg})
	add("long_quote", "نقل بلند حدیث علم", &Request{Query: "العلم خيرٌ من المال العلم يَحرُسُك و أنت تَحرُسُ المال", Mode: LongQuote, Scope: scopeLib(), PageSize: *pg})
	add("long_quote", "نقل بلند قرآنی", &Request{Query: "وَهُوَ مَعَكُم أينَ ما كُنتُم", Mode: LongQuote, Scope: scopeLib(), PageSize: *pg})
	add("long_quote", "نقل بلند ناموجود", &Request{Query: "جمله‌ای که هرگز در هیچ کتابی نیامده است به هیچ روی", Mode: LongQuote, Scope: scopeLib(), PageSize: *pg})
	add("long_quote", "نقل بلند سند صلاة", &Request{Query: "الصلاة قُربان كلُّ تقي", Mode: LongQuote, Scope: scopeLib(), PageSize: *pg})

	// — استناد قرآنی (QUR-03) — ۸
	add("quran", "استناد صرف: سورهٔ الرحمن (۵۵)", &Request{Query: "", Mode: NormalizedPhrase, Scope: Scope{Target: "library", Quran: &QuranRef{Sure: "55"}}, PageSize: *pg})
	add("quran", "استناد: الرحمن آیهٔ ۳۵ (درون بازهٔ ۳۳–۴۱)", &Request{Query: "", Mode: NormalizedPhrase, Scope: Scope{Target: "library", Quran: &QuranRef{Sure: "55", Aya: "35"}}, PageSize: *pg})
	add("quran", "استناد: الرحمن آیهٔ ۵۰ (بیرون بازه)", &Request{Query: "", Mode: NormalizedPhrase, Scope: Scope{Target: "library", Quran: &QuranRef{Sure: "55", Aya: "50"}}, PageSize: *pg})
	add("quran", "استناد: البقرة ۲۱۳", &Request{Query: "", Mode: NormalizedPhrase, Scope: Scope{Target: "library", Quran: &QuranRef{Sure: "2", Aya: "213"}}, PageSize: *pg})
	add("quran", "استناد: الحدید ۴", &Request{Query: "", Mode: NormalizedPhrase, Scope: Scope{Target: "library", Quran: &QuranRef{Sure: "57", Aya: "4"}}, PageSize: *pg})
	add("quran", "استناد + عبارت (هر دو باید بخورد)", &Request{Query: "الكعبة بيت الله", Mode: NormalizedPhrase, Scope: Scope{Target: "library", Quran: &QuranRef{Sure: "2", Aya: "213"}}, PageSize: *pg})
	add("quran", "استناد ناموجود: نوح ۹۹۹", &Request{Query: "", Mode: NormalizedPhrase, Scope: Scope{Target: "library", Quran: &QuranRef{Sure: "71", Aya: "999"}}, PageSize: *pg})
	add("quran", "استناد سورهٔ کامل ناموجود", &Request{Query: "", Mode: NormalizedPhrase, Scope: Scope{Target: "library", Quran: &QuranRef{Sure: "114"}}, PageSize: *pg})

	// — فیلتر نقش (role filter روی محل تطبیق) — ۸
	add("roles", "تطبیق داخل سند راوی (sanad)", &Request{Query: "عن أبي أبيه", Mode: StrictPhrase, Scope: Scope{Target: "library", Roles: []string{"sanad"}}, PageSize: *pg})
	add("roles", "تطبیق داخل گوینده (G)", &Request{Query: "الصادق", Mode: AllWords, Scope: Scope{Target: "library", Roles: []string{"G"}}, PageSize: *pg})
	add("roles", "فیلتر نقش معصوم", &Request{Query: "الإمام", Mode: AllWords, Scope: Scope{Target: "library", Roles: []string{"maasoom"}}, PageSize: *pg})
	add("roles", "فیلتر نقش مأخذ (K)", &Request{Query: "الخصال", Mode: AllWords, Scope: Scope{Target: "library", Roles: []string{"K"}}, PageSize: *pg})
	add("roles", "فیلتر نقش بدنه (b)", &Request{Query: "اصطلاح", Mode: AllWords, Scope: Scope{Target: "library", Roles: []string{"b"}}, PageSize: *pg})
	add("roles", "نقش غلط → بی‌نتیجه", &Request{Query: "الكعبة", Mode: StrictPhrase, Scope: Scope{Target: "library", Roles: []string{"sanad"}}, PageSize: *pg})
	add("roles", "چند نقش (sanad یا maasoom)", &Request{Query: "قال", Mode: AllWords, Scope: Scope{Target: "library", Roles: []string{"sanad", "maasoom"}}, PageSize: *pg})
	add("roles", "تطبیق بیرون نقش‌های درخواستی حذف می‌شود", &Request{Query: "الرسول", Mode: AllWords, Scope: Scope{Target: "library", Roles: []string{"sharh"}}, PageSize: *pg})

	// — scope — ۱۶
	add("scope", "دامنهٔ یک اثر: الحج", &Request{Query: "الكعبة بيت الله", Mode: StrictPhrase, Scope: Scope{Target: "work", WorkUID: strPtr("w-hajj")}, PageSize: *pg})
	add("scope", "دامنهٔ اثر بی‌تطبیق", &Request{Query: "الكعبة بيت الله", Mode: StrictPhrase, Scope: Scope{Target: "work", WorkUID: strPtr("w-edge")}, PageSize: *pg})
	add("scope", "دامنهٔ یک سند: doc-bahar-2", &Request{Query: "الرسول", Mode: AnyWords, Scope: Scope{Target: "document", DocumentUIDs: []string{"doc-bahar-2"}}, PageSize: *pg})
	add("scope", "دامنهٔ دو سند", &Request{Query: "العلم", Mode: AnyWords, Scope: Scope{Target: "document", DocumentUIDs: []string{"doc-bahar-2", "doc-bahar-3"}}, PageSize: *pg})
	add("scope", "دامنهٔ سند فارسی", &Request{Query: "قرآن", Mode: AnyWords, Scope: Scope{Target: "document", DocumentUIDs: []string{"doc-aseman"}}, PageSize: *pg})
	add("scope", "دامنهٔ سند مرزی", &Request{Query: "يوسف", Mode: NormalizedPhrase, Scope: Scope{Target: "document", DocumentUIDs: []string{"doc-edge"}}, PageSize: *pg})
	add("scope", "زبان عربی", &Request{Query: "العلم", Mode: AnyWords, Scope: Scope{Target: "library", Language: strPtr("ar")}, PageSize: *pg})
	add("scope", "زبان فارسی", &Request{Query: "قرآن", Mode: AnyWords, Scope: Scope{Target: "library", Language: strPtr("fa")}, PageSize: *pg})
	add("scope", "زبان غلط", &Request{Query: "العلم", Mode: AnyWords, Scope: Scope{Target: "library", Language: strPtr("fr")}, PageSize: *pg})
	add("scope", "عنوان کتاب: بحار", &Request{Query: "بحار", Mode: StrictPhrase, Scope: Scope{Target: "titles"}, PageSize: *pg})
	add("scope", "عنوان کتاب: الحج", &Request{Query: "الحج", Mode: StrictPhrase, Scope: Scope{Target: "titles"}, PageSize: *pg})
	add("scope", "عنوان: آسمان (فارسی)", &Request{Query: "آسمان", Mode: StrictPhrase, Scope: Scope{Target: "titles"}, PageSize: *pg})
	add("scope", "عنوان ناموجود", &Request{Query: "الغزیة", Mode: StrictPhrase, Scope: Scope{Target: "titles"}, PageSize: *pg})
	add("scope", "عنوان: سفینة (با ة)", &Request{Query: "سفينة", Mode: StrictPhrase, Scope: Scope{Target: "titles"}, PageSize: *pg})
	add("scope", "عنوان با عبارت نرمال", &Request{Query: "تجربی", Mode: NormalizedPhrase, Scope: Scope{Target: "titles"}, PageSize: *pg})
	add("scope", "دامنهٔ اثر بحار", &Request{Query: "العلم", Mode: AnyWords, Scope: Scope{Target: "work", WorkUID: strPtr("w-bahar")}, PageSize: *pg})

	// — صفحه‌بندی و سقف (رفتار پایدار) — ۶
	add("paging", "صفحه‌بندی: عبارت طلایی با page_size=5", &Request{Query: "الكعبة بيت الله", Mode: StrictPhrase, Scope: scopeLib(), PageSize: 5})
	add("paging", "صفحه‌بندی: page_size=50 (سقف مجاز)", &Request{Query: "الكعبة بيت الله", Mode: StrictPhrase, Scope: scopeLib(), PageSize: 50})
	add("paging", "page_size خارج از بازه → پیش‌فرض ۲۰", &Request{Query: "الكعبة بيت الله", Mode: StrictPhrase, Scope: scopeLib(), PageSize: 3})
	add("paging", "نتیجهٔ کمتر از یک صفحه", &Request{Query: "الصلاة قربان كل تقي", Mode: StrictPhrase, Scope: scopeLib(), PageSize: 20})
	add("paging", "نتیجهٔ صفر", &Request{Query: "ژانوال", Mode: StrictPhrase, Scope: scopeLib(), PageSize: 20})
	add("paging", "متن کوتاه تک‌حرفی", &Request{Query: "و", Mode: AnyWords, Scope: scopeLib(), PageSize: 20})

	_ = pg
	return cs
}

func pad3(n int) string {
	s := "000"
	if n < 10 {
		return "00" + itoa(n)
	}
	if n < 100 {
		return "0" + itoa(n)
	}
	return itoa(n) + s[len(itoa(n)):]
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	return string(b)
}

func strPtr(s string) *string { return &s }
