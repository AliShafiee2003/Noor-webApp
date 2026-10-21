package norm

// آزمون‌های n1-1.4.0 — انتظارها دست‌نویس‌اند (از خروجی خود norm مشتق نمی‌شوند).

import (
	"strings"
	"testing"
)

func n1s(s string) []string {
	var out []string
	for _, t := range TokenizeAligned(s) {
		out = append(out, t.N1)
	}
	return out
}

func TestFlexEzafeHamzaIsL2(t *testing.T) {
	for _, s := range []string{"خانۀ", "خانهٔ", "خانه"} {
		if got := n1s(s); len(got) != 1 || got[0] != "خانه" {
			t.Errorf("%q → %q، انتظار «خانه»", s, got)
		}
	}
	a, _ := NormalizeN0("خانۀ")
	b, _ := NormalizeN0("خانهٔ")
	if a != b {
		t.Errorf("N0 «خانۀ»=%q ≠ «خانهٔ»=%q", a, b)
	}
	// ة عربی با این قاعده یکی نمی‌شود
	if n1s("رحمة")[0] == "رحمه" {
		t.Errorf("ة نباید در L2 به ه برسد")
	}
}

func TestFlexFootnoteMarkers(t *testing.T) {
	cases := map[string]string{
		"علم¹ نافع":    "علم نافع",
		"علم[۱] نافع":  "علم نافع",
		"علمٌ[٢] نافع": "علم نافع",
		"علم [۱] نافع": "علم 1 نافع", // جدا: شماره است
	}
	for in, want := range cases {
		got := strings.Join(n1s(in), " ")
		if got != want {
			t.Errorf("%q → %q، انتظار %q", in, got, want)
		}
	}
}

func TestFlexLexicalTable(t *testing.T) {
	eq := [][2]string{{"مسئله", "مسأله"}, {"مسئله", "مساله"}, {"مسئول", "مسؤول"}, {"مسئولیت", "مسؤولیت"},
		{"هیئت", "هیأت"}, {"سؤال", "سئوال"}, {"داوود", "داود"}, {"طاووس", "طاوس"}, {"آنچ", "آنچه"}, {"رحمن", "رحمان"}}
	for _, p := range eq {
		if WordToN2(p[0]) != WordToN2(p[1]) {
			t.Errorf("WordToN2(%s)=%s ≠ WordToN2(%s)=%s", p[0], WordToN2(p[0]), p[1], WordToN2(p[1]))
		}
		if ReuseKey(WordToN2(p[0])) != ReuseKey(WordToN2(p[1])) {
			t.Errorf("کلید بازیابی ناهم‌خوان: %s/%s", p[0], p[1])
		}
		if LexicalLabel(p[0], p[1]) == "" && p[0] != "مسئله" {
			t.Errorf("برچسب واژگانی برای %s/%s خالی است", p[0], p[1])
		}
	}
	neq := [][2]string{{"شیون", "شؤون"}, {"مسئله", "مسئول"}, {"داود", "داوری"}}
	for _, p := range neq {
		if WordToN2(p[0]) == WordToN2(p[1]) {
			t.Errorf("%s و %s نباید هم‌ارز شوند", p[0], p[1])
		}
	}
	// N1 دست نمی‌خورد (L2 مستقل از جدول)
	if n1s("مسئله")[0] == n1s("مسأله")[0] {
		t.Errorf("جدول واژگانی نباید در N1 اعمال شود")
	}
}

func altForms(w string) map[string]string {
	m := map[string]string{}
	for _, a := range N2Alternatives(w) {
		m[a.Form] = a.Diff
	}
	return m
}

func TestFlexDefiniteArticle(t *testing.T) {
	a := altForms("کتاب")
	for _, f := range []string{"الکتاب", "والکتاب", "بالکتاب", "للکتاب"} {
		if _, ok := a[f]; !ok {
			t.Errorf("«کتاب» باید «%s» را در L3 بپذیرد", f)
		}
	}
	if _, ok := altForms("الکتاب")["کتاب"]; !ok {
		t.Errorf("«الکتاب» باید «کتاب» را در L3 بپذیرد")
	}
	for _, w := range []string{"هام", "ماس", "بته"} {
		if _, ok := altForms(w)["ال"+w]; ok {
			t.Errorf("استثنا: «%s» نباید «ال%s» را بپذیرد", w, w)
		}
	}
	for _, w := range []string{"الهام", "الماس", "البته", "الله", "الذی"} {
		if _, ok := altForms(w)[string([]rune(w)[2:])]; ok {
			t.Errorf("استثنا: «%s» نباید بی «ال» بیاید", w)
		}
	}
	// واژهٔ دوحرفی گسترش نمی‌یابد
	if _, ok := altForms("من")["المن"]; ok {
		t.Errorf("واژهٔ دوحرفی نباید ال بگیرد")
	}
	// ناوردایی کلید بازیابی برای همهٔ گونه‌ها
	for _, w := range []string{"کتاب", "الکتاب", "وزیر", "علم", "العلم", "ناس", "لیل", "رسول"} {
		k := ReuseKey(w)
		for _, x := range N2Alternatives(w) {
			if ReuseKey(x.Form) != k {
				t.Errorf("ReuseKey(%s)≠ReuseKey(%s)", x.Form, w)
			}
		}
	}
}

func variantSet(words []string, opt VariantOptions) map[string]Variant {
	m := map[string]Variant{}
	for _, v := range FlexVariants(words, opt) {
		m[strings.Join(v.Words, " ")] = v
	}
	return m
}

func TestFlexVariantsSpacing(t *testing.T) {
	cases := []struct {
		q    []string
		want []string
		not  []string
	}{
		{[]string{"کتابها"}, []string{"کتاب ها"}, nil},
		{[]string{"کتاب", "ها"}, []string{"کتابها"}, nil},
		{[]string{"بزرگتر"}, []string{"بزرگ تر"}, nil},
		{[]string{"آنکه"}, []string{"آن که"}, nil},
		{[]string{"آن", "که"}, []string{"آنکه"}, nil},
		{[]string{"آنها"}, []string{"آن ها"}, nil},
		{[]string{"میروم"}, []string{"می روم"}, nil},
		{[]string{"می", "روم"}, []string{"میروم"}, nil},
		{[]string{"به", "خانه"}, []string{"بخانه"}, nil},
		{[]string{"کتابخانه"}, []string{"کتاب خانه"}, nil},
		{[]string{"تنها"}, nil, []string{"تن ها"}},
		{[]string{"دختر"}, nil, []string{"دخ تر"}},
		{[]string{"میوه"}, nil, []string{"می وه"}},
		{[]string{"علیها"}, nil, []string{"علی ها"}},
	}
	for _, c := range cases {
		vs := variantSet(c.q, VariantOptions{})
		for _, w := range c.want {
			if _, ok := vs[w]; !ok {
				t.Errorf("%q: گونهٔ «%s» ساخته نشد", c.q, w)
			}
		}
		for _, w := range c.not {
			if _, ok := vs[w]; ok {
				t.Errorf("%q: گونهٔ نادرست «%s»", c.q, w)
			}
		}
	}
	if v := variantSet([]string{"کتابها"}, VariantOptions{})["کتاب ها"]; len(v.Tight) != 1 || len(v.New) != 1 || v.New[0] != "کتاب" {
		t.Errorf("گونهٔ گسسته باید مرز تنگ و پاسبان واژگانی داشته باشد: %+v", v)
	}
}

func TestFlexVariantsEzafe(t *testing.T) {
	vs := variantSet([]string{"خانه", "علم"}, VariantOptions{})
	if v, ok := vs["خانه ی علم"]; !ok || v.Kind != KindEzafe {
		t.Errorf("یای اضافه ساخته نشد: %v", vs)
	}
	if _, ok := variantSet([]string{"خانه", "ی", "علم"}, VariantOptions{})["خانه علم"]; !ok {
		t.Errorf("حذف یای اضافه ساخته نشد")
	}
	if _, ok := variantSet([]string{"کتاب", "علم"}, VariantOptions{})["کتاب ی علم"]; ok {
		t.Errorf("یای اضافه فقط پس از «ـه»")
	}
}

func TestFlexVariantsHonorific(t *testing.T) {
	q := []string{"صادق", "ع", "فرمود"}
	if _, ok := variantSet(q, VariantOptions{})["صادق علیه السلام فرمود"]; ok {
		t.Errorf("«ع» بی‌پرانتز نباید گسترش یابد")
	}
	vs := variantSet(q, VariantOptions{QueryParen: []bool{false, true, false}})
	if v, ok := vs["صادق علیه السلام فرمود"]; !ok || v.Kind != KindHonorific {
		t.Errorf("«(ع)» باید به «علیه السلام» برسد: %v", vs)
	}
	vs = variantSet([]string{"رسول", "الله", "صلی", "الله", "علیه", "وآله"}, VariantOptions{})
	if v, ok := vs["رسول الله ص"]; !ok || len(v.Paren) != 1 || v.Paren[0] != 2 {
		t.Errorf("صورت کامل باید به «(ص)» با قید پرانتز برسد: %+v", v)
	}
	if _, ok := vs["رسول الله ﷺ"]; !ok {
		t.Errorf("صورت کامل باید به «ﷺ» برسد")
	}
	if _, ok := vs["رسول الله صلی الله علیه وسلم"]; ok {
		t.Errorf("دو صورت کامل متفاوت صلوات نباید هم‌ارز شوند")
	}
	if _, ok := variantSet([]string{"قال", "ﷺ"}, VariantOptions{})["قال صلی الله علیه وآله"]; !ok {
		t.Errorf("«ﷺ» باید به صورت کامل برسد")
	}
}

func TestFlexVariantsMorphOptIn(t *testing.T) {
	if _, ok := variantSet([]string{"کتاب"}, VariantOptions{})["کتابها"]; ok {
		t.Errorf("گسترش صرفی بدون انتخاب کاربر ممنوع است")
	}
	vs := variantSet([]string{"کتاب"}, VariantOptions{Morph: true})
	for _, w := range []string{"کتاب ها", "کتابها"} {
		if v, ok := vs[w]; !ok || v.Kind != KindMorph {
			t.Errorf("گونهٔ صرفی «%s» ساخته نشد", w)
		}
	}
	if v, ok := variantSet([]string{"کتابها"}, VariantOptions{Morph: true})["کتاب"]; !ok || v.Kind != KindMorph {
		t.Errorf("مفرد «کتابها» ساخته نشد")
	}
}

func TestFlexHonorificMask(t *testing.T) {
	w := []string{"قال", "رسول", "الله", "صلی", "الله", "علیه", "وآله", "انما"}
	var n2 []string
	for _, x := range w {
		n2 = append(n2, WordToN2(x))
	}
	m := HonorificMask(n2)
	want := []bool{false, false, false, true, true, true, true, false}
	for i := range want {
		if m[i] != want[i] {
			t.Errorf("mask[%d]=%v، انتظار %v", i, m[i], want[i])
		}
	}
}
