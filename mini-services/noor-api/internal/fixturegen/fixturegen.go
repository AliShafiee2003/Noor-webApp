// Package fixturegen — تولید مجموعهٔ آزمون هم‌ساخت نور (fixture).
// طبق §۳۰/§۵۳ PRD: روایت/سند/راوی/مأخذ/آیه/پاورقی/شرح/Link/تگ ناشناخته،
// صفحهٔ غیرعددی و هم‌نام، روایت چندقطعه‌ای، ۳۰۰ تطبیق برای صفحه‌بندی،
// موارد N1 (ي/ی، ك/ک، همزه، ة/ه، اعراب، نیم‌فاصله، ارقام، entity).
// این داده‌ها مصنوعی‌اند؛ ادعای پوشش کتابخانهٔ واقعی ندارند.
package fixturegen

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite"
)

// WorkManifest اثر در کاتالوگ.
type WorkManifest struct {
	UID        string            `json:"uid"`
	Title      string            `json:"title"`
	ShortTitle string            `json:"short_title"`
	Author     string            `json:"author"`
	Publisher  *string           `json:"publisher"`
	Year       *string           `json:"year"`
	Language   string            `json:"language"`
	Topics     []string          `json:"topics"`
	Documents  []DocManifest     `json:"documents"`
	Related    []RelatedManifest `json:"related"`
}

type DocManifest struct {
	UID      string `json:"uid"`
	File     string `json:"file"`
	Label    string `json:"label"`
	Kind     string `json:"kind"`
	Checksum string `json:"checksum"`
	Size     int64  `json:"size_bytes"`
	Language string `json:"language"`
}

type RelatedManifest struct {
	RelationType string `json:"relation_type"`
	Target       string `json:"target_work_uid"`
	Note         string `json:"note"`
}

const commonDict = "کتاب|روایت|امام|قال|عن|عليه|السلام|إلى|من|في|باب|ص|ج|الشيخ|الطبرسي|بحار|الأنوار|المجلسي|المؤلف|مؤلف|ترجمه|مقدمه|واژه|پاورقی|شرح|بیان|آیه|قرآن|سند|راوی|أبيه|الرضا|الصادق|الباقر|الجواد|الهادي|الحسن|الحسين|سليمان|داود|أعوذ|بالله|الشيطان|الرجيم|إن|الله|لا|إله|إلا|هو|الحي|القيوم|رسول|نبي|الأرحام|بعضها|على|بعض|أولي|الرحم|بعضهم|أولياء|هم|نسخهٔ|چاپی|بدون|تغییر"

type item struct {
	story int64
	xml   string
}

// encode قرارداد کدگذاری fixture: توکن «|n|» ارجاع به index دیکشنری است.
// Decode در noordb با همین قرارداد اعتبارسنجی می‌شود.
func encode(xmlText string, dict []string) string {
	var b strings.Builder
	for _, p := range strings.Split(xmlText, " ") {
		if p == "" {
			continue
		}
		if idx := dictIndex(dict, p); idx >= 0 {
			fmt.Fprintf(&b, "|%d|", idx)
		} else {
			b.WriteString(strings.ReplaceAll(p, "|", "⁄"))
		}
		b.WriteByte(' ')
	}
	return strings.TrimRight(b.String(), " ")
}

func dictIndex(dict []string, s string) int {
	for i, d := range dict {
		if d == s {
			return i
		}
	}
	return -1
}

func writeBook(path, title, author, version, dict string, items []item) (DocManifest, error) {
	_ = os.Remove(path)
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return DocManifest{}, err
	}
	defer db.Close()
	if _, err := db.Exec(`CREATE TABLE BookInfo(Id INTEGER PRIMARY KEY, Title TEXT, Auther TEXT, Version TEXT, VolumeInPapers TEXT, Publisher TEXT);
CREATE TABLE Letters(Id INTEGER PRIMARY KEY AUTOINCREMENT, Txt TEXT);
CREATE TABLE DocItem(Id INTEGER PRIMARY KEY AUTOINCREMENT, ItemNo INTEGER, Story INTEGER, Section INTEGER, XmlText TEXT, Length INTEGER);`); err != nil {
		return DocManifest{}, err
	}
	dl := strings.Split(dict, "|")
	for i, t := range dl {
		if _, err := db.Exec(`INSERT INTO Letters(Id, Txt) VALUES(?,?)`, i, t); err != nil {
			return DocManifest{}, err
		}
	}
	for i, it := range items {
		enc := encode(it.xml, dl)
		if _, err := db.Exec(`INSERT INTO DocItem(Id, ItemNo, Story, Section, XmlText, Length) VALUES(?,?,?,?,?,?)`,
			i+1, i+1, it.story, 1, enc, len(enc)); err != nil {
			return DocManifest{}, err
		}
	}
	if _, err := db.Exec(`INSERT INTO BookInfo(Id, Title, Auther, Version, VolumeInPapers, Publisher) VALUES(1,?,?,?,?,?)`, title, author, version, "", "مؤسسهٔ نمونه"); err != nil {
		return DocManifest{}, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return DocManifest{}, err
	}
	sum := sha256.Sum256(data)
	return DocManifest{Checksum: "sha256:" + hex.EncodeToString(sum[:]), Size: int64(len(data)), File: filepath.Base(path)}, nil
}

// Generate کل مجموعهٔ fixture را می‌سازد و کاتالوگ را برمی‌گرداند.
func Generate(dir string) ([]WorkManifest, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	dict := commonDict
	var works []WorkManifest

	// ۱) بحار — DocItem 425-like: روایت/سند/راوی/مأخذ/آیه/پاورقی/بیان مؤلف
	baharV2 := []item{
		{1, `<heading level="1">کتاب الإيمان</heading>`},
		{1, `<heading level="2">باب ما الرسول وما النبي</heading>`},
		{1, `<p>قال الشيخ الطبرسي في <K book="بحار" vol="۲" page="۱۱۵">بحار الأنوار</K> إنَّ الفرق بين الرسول والنبي في الاصطلاح معروف.</p>`},
		{1, `<hadith id="h-101" revayatindex="112"><sanadHadith>عن أبي <G n="أبيه">أبيه</G> <maasoom mno="7">الإمام الصادق عليه السلام</maasoom> قال</sanadHadith><p>كانت الأنبياء أرسلوا للناس وأن الرسول ما الرسول وما النبي فرقٌ بينهما في القول.</p><p>وذكَر المحقّق أنَّ النبيّ مُلهمٌ وأنَّ الرسول مُبعثٌ إلى الناس جميعًا.</p><ayah sure="2" aya="213" ayahAddress="البقرة: ٢١٣"><p>كانَ النَّاسُ أُمَّةً وَاحِدَةً فَبَعَثَ اللهُ النَّبِيِّينَ</p></ayah><K book="الخصال" vol="۱" page="۱۳۰">مأخذ</K></hadith>`},
		{1, `<p><lfootnote ref="fn-1" num="۱"/>انظر بيان مؤلف در ذیل همین باب.</p>`},
		{1, `<B>مراد از الرسول در کلام پیشین، پیامبری است که به‌سوی همهٔ مردم مبعث شده؛ و این بیان مؤلف است نه متن روایت.</B>`},
		{1, `<lfootnote id="fn-1" num="۱">بحار الأنوار، ج ۲، ص ۱۱۵، ح ۱۲.</lfootnote>`},
		{1, `<page num="115" label="۱۱۵"/>`},
		{2, `<heading level="2">باب فضل العلم</heading>`},
		{2, `<hadith id="h-102" revayatindex="113"><sanadHadith>عن أبي <G n="أبيه">أبيه</G> قال</sanadHadith><p>العلم خيرٌ من المال العلم يَحرُسُك و أنت تَحرُسُ المال.</p></hadith>`},
		{2, `<page num="116" label="۱۱۶"/>`},
	}
	doc1, err := writeBook(filepath.Join(dir, "01407_011.db"), "بحار الأنوار — ج ۲", "الشيخ الطبرسي", "نسخهٔ چاپی ۱۳۶۲", dict, baharV2)
	if err != nil {
		return nil, err
	}
	doc1.UID, doc1.Label, doc1.Kind, doc1.Language = "doc-bahar-2", "ج ۲", "volume", "ar"

	// ۲) DocItem 567-like: sharh + B بدون اتصال خودکار
	baharV3 := []item{
		{1, `<heading level="1">کتاب الصلاة</heading>`},
		{1, `<hadith id="h-201" revayatindex="88"><sanadHadith>عن <maasoom mno="5">الإمام الباقر عليه السلام</maasoom> قال</sanadHadith><p>الصلاة قُربان كلُّ تقي.</p></hadith>`},
		{1, `<sharh id="sh-1"/> در شرح این موضع، محقّق اختلاف را یاد کرده است.`},
		{1, `<B>اشارهٔ مؤلف: قربان یعنی نزدیک‌کننده؛ این معنا در کلام راوی صریح نیست.</B>`},
		{1, `<page num="58" label="۵۸"/>`},
	}
	doc2, err := writeBook(filepath.Join(dir, "01407_012.db"), "بحار الأنوار — ج ۳", "الشيخ الطبرسي", "نسخهٔ چاپی ۱۳۶۲", dict, baharV3)
	if err != nil {
		return nil, err
	}
	doc2.UID, doc2.Label, doc2.Kind, doc2.Language = "doc-bahar-3", "ج ۳", "volume", "ar"

	// ۳) آسمان و جهان — آیه بدون والد ayah + شرح، بدون hadith
	aseman := []item{
		{1, `<heading level="1">مقدمهٔ مؤلف</heading>`},
		{1, `<p>در این رساله، آفاق و انفس به قرآن شرح داده می‌شود: <ayahAddress sure="55" ayaFrom="33" ayaTo="41" sureName="الرحمن">الرحمن: ٣٣–٤١</ayahAddress>.</p>`},
		{1, `<p>و قال تعالى: <ayah sure="57" aya="4" ayahAddress="الحدید: ۴"><p>وَهُوَ مَعَكُم أينَ ما كُنتُم</p></ayah> — این نقلِ کتاب است و با متن معیار قرآن یکسان فرض نمی‌شود.</p>`},
		{1, `<sharh id="sh-2"/> محقّق در حاشیهٔ همین صفحه توضیح داده است.`},
		{1, `<page num="7" label="۷"/>`},
	}
	doc3, err := writeBook(filepath.Join(dir, "02566_001.db"), "آسمان و جهان", "محمدتقی فلسفی", "چاپ هفتم", dict, aseman)
	if err != nil {
		return nil, err
	}
	doc3.UID, doc3.Label, doc3.Kind, doc3.Language = "doc-aseman", "رسالهٔ اصلی", "volume", "fa"

	// ۴) سفینة — Link + تگ ناشناخته
	safina := []item{
		{1, `<heading level="1">الر</heading>`},
		{1, `<hadith id="h-301" revayatindex="45"><sanadHadith>عن <maasoom mno="9">الإمام الرضا عليه السلام</maasoom> قال</sanadHadith><p>من أراد أن يَنظُر إلى كلامنا فهذا كِتابُنا.</p><p>و في رواية أخرى إنَّ لكلِّ شيءٍ سفينَةً.</p></hadith>`},
		{1, `<p>در <link book="b" vol="۲" page="۱۱۵">بحار ج۲</link> از این باب سخن رفته است و ارجاع دیگر: <link book="q" vol="7" page="۱۳">مصادر دیگر</link>.</p>`},
		{1, `<page num="13" label="۱۳"/>`},
		{2, `<heading level="1">الس</heading>`},
		{2, `<hadith id="h-302" revayatindex="46"><sanadHadith>عن أبي <G n="أبيه">أبيه</G> قال</sanadHadith><p>السفينة خيرٌ من الغرق لقّطعتُ العِلْمَ أيُّما أحدٌ لم يُعمَل.</p></hadith>`},
		// نقل‌قول جزئی میان‌کتابی از h-101 بحار (آزمون «این روایت در چه کتاب‌هایی» — §۴۷):
		// فقط جملهٔ نخست نقل شده است؛ با گذرِ بخش آغازین در پاسخ جست‌وجوی روایت می‌آید.
		{2, `<hadith id="h-303" revayatindex="112"><sanadHadith>در بحار الأنوار از الإمام الصادق عليه السلام نقل شده که</sanadHadith><p>كانت الأنبياء أرسلوا للناس وأن الرسول ما الرسول وما النبي فرقٌ بينهما في القول.</p></hadith>`},
		{2, `<unknownclass data="x">متن با نشانه‌گذاری ناشناخته — فقط حفظ می‌شود.</unknownclass>`},
		{2, `<page num="14" label="۱۴"/>`},
	}
	doc4, err := writeBook(filepath.Join(dir, "13608_001.db"), "سفینة البحار", "الشيخ النعمة", "چاپ دوم", dict, safina)
	if err != nil {
		return nil, err
	}
	doc4.UID, doc4.Label, doc4.Kind, doc4.Language = "doc-safina", "جلد ۱", "volume", "ar"

	// ۵) صفحهٔ غیرعددی/هم‌نام
	ambig := []item{
		{1, `<heading level="1">مقدمهٔ مصحح</heading>`},
		{1, `<page num="ا-1" label="الف"/>`},
		{1, `<p>این صفحهٔ الفِ مقدمهٔ مصحح است.</p>`},
		{2, `<heading level="1">متن اصلی</heading>`},
		{2, `<page num="ا-1" label="الف"/>`},
		{2, `<p>این صفحهٔ الفِ متن اصلی است؛ هم‌نام صفحهٔ دیگر ولی متفاوت.</p>`},
		{2, `<page num="12" label="۱۲"/>`},
		{2, `<p>متن صفحهٔ دوازدهم.</p>`},
	}
	doc5, err := writeBook(filepath.Join(dir, "ambig_001.db"), "رسالهٔ مبهم‌صفحه", "نویسندهٔ نمونه", "چاپ نمونه", dict, ambig)
	if err != nil {
		return nil, err
	}
	doc5.UID, doc5.Label, doc5.Kind, doc5.Language = "doc-ambig", "جلد یکتا", "volume", "fa"

	// ۶) ۳۰۰ تطبیق برای آزمون صفحه‌بندی/شمارش
	var pagItems []item
	pagItems = append(pagItems, item{1, `<heading level="1">متن تکرارپذیر</heading>`})
	for i := 1; i <= 300; i++ {
		pagItems = append(pagItems, item{1, fmt.Sprintf(`<p>بند شمارهٔ %d في كتابِ الحجِّ نُقلَ أنَّ الكعبة بيت الله قبلة الناس.</p>`, i)})
		if i%5 == 0 {
			pagItems = append(pagItems, item{1, fmt.Sprintf(`<page num="%d" label="%d"/>`, i, i)})
		}
	}
	doc6, err := writeBook(filepath.Join(dir, "pagination_001.db"), "کتاب الحج — تجربی", "مؤلف تجربی", "چاپ تجربی", dict, pagItems)
	if err != nil {
		return nil, err
	}
	doc6.UID, doc6.Label, doc6.Kind, doc6.Language = "doc-hajj", "جلد تجربی", "volume", "ar"

	// ۷) N1 edge cases
	edge := []item{
		{1, `<heading level="1">واژه‌های مرزی</heading>`},
		{1, `<p>عربی با اعراب يُوسُفُ وَإِخْوَتُهُ؛ بدون اعراب يوسف وإخوته.</p>`},
		{1, `<p>ی فارسی و ي عربی؛ ک فارسی و ك عربی؛ در نرمال یکی‌اند اما در دقیق فرق دارند.</p>`},
		{1, `<p>مَدینه و مدينة و مدنيّة همزه و ة/ه در N1 بی‌قید یکی نمی‌شوند.</p>`},
		{1, `<p>نیم‌فاصله می‌رویم و می رویم و ارقام ۱۴۰۷ و ١٤٠٧ و 1407 و &amp;amp; entity.</p>`},
		{1, `<p>فرق مسیح و مسيح در حالت دقیق معنادار است.</p>`},
		{1, `<page num="3" label="۳"/>`},
	}
	doc7, err := writeBook(filepath.Join(dir, "edge_001.db"), "رسالهٔ واژه‌های مرزی", "مؤلف مرزی", "چاپ مرزی", dict, edge)
	if err != nil {
		return nil, err
	}
	doc7.UID, doc7.Label, doc7.Kind, doc7.Language = "doc-edge", "جلد مرزی", "volume", "fa"

	pub1, pub2 := "مؤسسهٔ نمونه", "نشر نمونه"
	year1 := "۱۳۶۲"
	works = []WorkManifest{
		{UID: "w-bahar", Title: "بحار الأنوار", ShortTitle: "بحار", Author: "الشيخ الطبرسي (مؤسسهٔ نمونه)", Publisher: &pub1, Year: &year1, Language: "ar",
			Topics: []string{"حدیث", "کلام", "تفسیر روایی"}, Documents: []DocManifest{doc1, doc2},
			Related: []RelatedManifest{{RelationType: "مأخذ", Target: "w-safina", Note: "ارجاع متقابل"}}},
		{UID: "w-aseman", Title: "آسمان و جهان", ShortTitle: "آسمان", Author: "محمدتقی فلسفی", Publisher: &pub2, Language: "fa",
			Topics: []string{"قرآن", "آفاق و انفس"}, Documents: []DocManifest{doc3}},
		{UID: "w-safina", Title: "سفینة البحار", ShortTitle: "سفینة", Author: "الشيخ النعمة", Publisher: &pub1, Language: "ar",
			Topics: []string{"حدیث", "اصطلاحات"}, Documents: []DocManifest{doc4},
			Related: []RelatedManifest{{RelationType: "مأخذ", Target: "w-bahar", Note: "بحار ج۲ ص۱۱۵"}}},
		{UID: "w-ambig", Title: "رسالهٔ مبهم‌صفحه", ShortTitle: "مبهم", Author: "نویسندهٔ نمونه", Language: "fa",
			Topics: []string{"آزمون"}, Documents: []DocManifest{doc5}},
		{UID: "w-hajj", Title: "کتاب الحج — تجربی", ShortTitle: "الحج", Author: "مؤلف تجربی", Language: "ar",
			Topics: []string{"فقه", "حج"}, Documents: []DocManifest{doc6}},
		{UID: "w-edge", Title: "رسالهٔ واژه‌های مرزی", ShortTitle: "مرزی", Author: "مؤلف مرزی", Language: "fa",
			Topics: []string{"آزمون"}, Documents: []DocManifest{doc7}},
	}
	return works, nil
}

// DictForTest برای تست‌های decode.
func DictForTest() string { return commonDict }
