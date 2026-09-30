package noordb

import (
	"strings"
	"testing"

	"noor/internal/fixturegen"
)

func TestDecodeFixtureItem4(t *testing.T) {
	// همان آیتم ۴ بحار — باید ayah و K حفظ شوند
	xmlText := `<hadith id="h-101" revayatindex="112"><sanadHadith>عن أبي <G n="أبيه">أبيه</G> <maasoom mno="7">الإمام الصادق عليه السلام</maasoom> قال</sanadHadith><p>كانت الأنبياء أرسلوا للناس وأن الرسول ما الرسول وما النبي فرقٌ بينهما في القول.</p><ayah sure="2" aya="213" ayahAddress="البقرة: ٢١٣"><p>كانَ النَّاسُ أُمَّةً وَاحِدَةً فَبَعَثَ اللهُ النَّبِيِّينَ</p></ayah><K book="الخصال" vol="۱" page="۱۳۰">مأخذ</K></hadith>`
	dict := strings.Split(fixturegen.DictForTest(), "|")
	enc := encodeForTest(xmlText, dict)
	dec, err := Decode(enc, dict)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(dec, "<ayah") {
		t.Errorf("تگ ayah باید در خروجی decode حفظ شود:\n%s", dec)
	}
	if !strings.Contains(dec, "<K book") {
		t.Errorf("تگ K باید حفظ شود:\n%s", dec)
	}
}

func encodeForTest(s string, dict []string) string {
	var b strings.Builder
	for _, p := range strings.Split(s, " ") {
		if p == "" {
			continue
		}
		idx := -1
		for i, d := range dict {
			if d == p {
				idx = i
				break
			}
		}
		if idx >= 0 {
			b.WriteString("|" + itoa(idx) + "|")
		} else {
			b.WriteString(strings.ReplaceAll(p, "|", "⁄"))
		}
		b.WriteByte(' ')
	}
	return strings.TrimRight(b.String(), " ")
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
