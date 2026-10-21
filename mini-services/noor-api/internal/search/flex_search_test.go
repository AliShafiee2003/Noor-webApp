package search

// آزمون انتها‌به‌انتهای انعطاف n1-1.4.0 روی موتور FTS5 (نمایهٔ واقعی SQLite).
// هر سناریو سند جدا دارد تا شمارش و لایه بی‌ابهام باشد؛ انتظارها دست‌نویس‌اند.

import (
	"testing"

	"noor/internal/norm"
)

func flexCorpus() []testDoc {
	return []testDoc{
		{"c-fx", "w-f1", "d-f1", "fa", []string{`<p>این کتابها را خواندم.</p>`}},
		{"c-fx", "w-f2", "d-f2", "fa", []string{`<p>درِ خانۀ علم باز است.</p>`}},
		{"c-fx", "w-f3", "d-f3", "fa", []string{`<p>در خانه‌ی علم نشستیم.</p>`}},
		{"c-fx", "w-f4", "d-f4", "fa", []string{`<p>امام صادق (ع) فرمود که دانش بیاموزید.</p>`}},
		{"c-fx", "w-f5", "d-f5", "fa", []string{`<p>امام صادق علیه‌السلام فرمود که دانش بیاموزید.</p>`}},
		{"c-fx", "w-f6", "d-f6", "fa", []string{`<p>مسئلهٔ مهم همین است.</p>`}},
		{"c-fx", "w-f7", "d-f7", "ar", []string{`<p>قال رسول الله صلى الله عليه وآله إنما الأعمال بالنيات.</p>`}},
		{"c-fx", "w-f8", "d-f8", "ar", []string{`<p>ذلك الكتاب لا ريب فيه.</p>`}},
		{"c-fx", "w-f9", "d-f9", "fa", []string{`<p>گفت: علم[۱] نافع است.</p>`}},
		{"c-fx", "w-f10", "d-f10", "fa", []string{`<p>تن ها خسته بود و تنها ماند.</p>`}},
		{"c-fx", "w-f11", "d-f11", "fa", []string{`<p>کتاب، ها را نوشت.</p>`}},
		{"c-fx", "w-f12", "d-f12", "fa", []string{`<p>یک کتاب خریدم.</p>`}},
	}
}

func layersFor(resp *Response, doc string) map[string]int {
	m := map[string]int{}
	for _, r := range resp.Results {
		if r.Document.UID == doc {
			m[r.Layer]++
		}
	}
	return m
}

func matchTypeFor(resp *Response, doc string) string {
	for _, r := range resp.Results {
		if r.Document.UID == doc {
			return r.MatchType
		}
	}
	return ""
}

func TestFlexEndToEnd(t *testing.T) {
	e, _ := newTestEngine(t, flexCorpus())
	tiered := func(q string) *Response {
		return search(t, e, Request{Query: q, Mode: Tiered, Layers: []string{"L1", "L2", "L3"}})
	}

	t.Run("spacing: کتاب ها ← کتابها (L3 پیوستگی)، نه «کتاب، ها»", func(t *testing.T) {
		resp := tiered("کتاب ها")
		if l := layersFor(resp, "d-f1"); l["L3"] != 1 {
			t.Errorf("d-f1: %v", l)
		}
		if mt := matchTypeFor(resp, "d-f1"); mt != "L3 (تفاوت پیوستگی)" {
			t.Errorf("match_type: %q", mt)
		}
		// «کتابها» → گسسته فقط با مرز تنگ: «کتاب، ها» نشانه دارد و نباید بیاید
		resp = tiered("کتابها")
		if l := layersFor(resp, "d-f11"); len(l) != 0 {
			t.Errorf("مرز نشانه‌دار نباید تفاوت پیوستگی شمرده شود: %v", l)
		}
	})

	t.Run("ezafe: خانهٔ علم ← خانۀ علم (L2) و خانه‌ی علم (L3)", func(t *testing.T) {
		resp := tiered("خانهٔ علم")
		if l := layersFor(resp, "d-f2"); l["L2"] != 1 {
			t.Errorf("خانۀ باید L2 باشد: %v", l)
		}
		if l := layersFor(resp, "d-f3"); l["L3"] != 1 {
			t.Errorf("خانه‌ی باید L3 باشد: %v", l)
		}
		if mt := matchTypeFor(resp, "d-f3"); mt != "L3 (یای اضافه)" {
			t.Errorf("match_type: %q", mt)
		}
	})

	t.Run("honorific: (ع) ↔ علیه‌السلام", func(t *testing.T) {
		resp := tiered("صادق (ع) فرمود")
		if l := layersFor(resp, "d-f4"); l["L2"]+l["L1"] != 1 {
			t.Errorf("d-f4: %v", l)
		}
		if l := layersFor(resp, "d-f5"); l["L3"] != 1 {
			t.Errorf("d-f5: %v", l)
		}
		if mt := matchTypeFor(resp, "d-f5"); mt != "L3 (عبارت دعایی)" {
			t.Errorf("match_type: %q", mt)
		}
		resp = tiered("صادق علیه السلام فرمود")
		if l := layersFor(resp, "d-f4"); l["L3"] != 1 {
			t.Errorf("صورت کامل → (ع): %v", l)
		}
		// بی‌پرانتز: «ع» اختصار فرض نمی‌شود
		resp = tiered("صادق ع فرمود")
		if l := layersFor(resp, "d-f5"); len(l) != 0 {
			t.Errorf("«ع» بی‌پرانتز نباید گسترش یابد: %v", l)
		}
	})

	t.Run("honorific: ﷺ ↔ صلى الله عليه وآله", func(t *testing.T) {
		resp := tiered("رسول الله ﷺ انما")
		if l := layersFor(resp, "d-f7"); l["L3"] != 1 {
			t.Errorf("d-f7: %v", l)
		}
	})

	t.Run("lexical: مسأله ← مسئلهٔ (L3، کلید بازیابی یکسان)", func(t *testing.T) {
		resp := tiered("مسأله مهم")
		if l := layersFor(resp, "d-f6"); l["L3"] != 1 {
			t.Errorf("d-f6: %v", l)
		}
	})

	t.Run("definite article: کتاب لا ریب ← الكتاب لا ريب (L3)", func(t *testing.T) {
		resp := tiered("کتاب لا ریب")
		if l := layersFor(resp, "d-f8"); l["L3"] != 1 {
			t.Errorf("d-f8: %v", l)
		}
		resp = search(t, e, Request{Query: "کتاب لا ریب", Mode: StrictPhrase})
		if l := layersFor(resp, "d-f8"); len(l) != 0 {
			t.Errorf("strict نباید ال را نادیده بگیرد: %v", l)
		}
	})

	t.Run("footnote marker: علم نافع ← علم[۱] نافع (L2)", func(t *testing.T) {
		resp := tiered("علم نافع")
		if l := layersFor(resp, "d-f9"); l["L2"] != 1 {
			t.Errorf("d-f9: %v", l)
		}
	})

	t.Run("false positive: تنها ↛ تن ها", func(t *testing.T) {
		resp := tiered("تنها")
		if l := layersFor(resp, "d-f10"); l["L3"] != 0 || l["L1"] != 1 {
			t.Errorf("d-f10: %v", l)
		}
	})

	t.Run("morphology is opt-in", func(t *testing.T) {
		resp := tiered("کتاب")
		if l := layersFor(resp, "d-f1"); len(l) != 0 {
			t.Errorf("بدون انتخاب، «کتابها» نباید بیاید: %v", l)
		}
		resp = search(t, e, Request{Query: "کتاب", Mode: Tiered, Layers: []string{"L1", "L2", "L3"}, ExpandMorphology: true})
		if mt := matchTypeFor(resp, "d-f1"); mt != "L3 (صورت صرفی)" {
			t.Errorf("با انتخاب، «کتابها» باید «صورت صرفی» باشد: %q", mt)
		}
		if l := layersFor(resp, "d-f12"); l["L1"] != 1 {
			t.Errorf("d-f12: %v", l)
		}
	})

	t.Run("ranking: L1/L2 above L3", func(t *testing.T) {
		resp := tiered("خانهٔ علم")
		last := 0
		for _, r := range resp.Results {
			if layerRank[r.Layer] < last {
				t.Errorf("ترتیب لایه نقض شد: %s پس از رتبهٔ %d", r.Layer, last)
			}
			last = layerRank[r.Layer]
		}
	})
}

func TestFlexAlignerHonorific(t *testing.T) {
	tok := func(ws ...string) []AlignToken {
		var out []AlignToken
		for _, w := range ws {
			n1 := normN1(w)
			out = append(out, AlignToken{N1: n1, N2: normN2(n1)})
		}
		return out
	}
	q := tok("قال", "رسول", "الله", "انما", "الاعمال", "بالنیات")
	withHon := tok("قال", "رسول", "الله", "صلی", "الله", "علیه", "وآله", "انما", "الاعمال", "بالنیات")
	withOther := tok("قال", "رسول", "الله", "فی", "کتابه", "العزیز", "ذلک", "انما", "الاعمال", "بالنیات")
	a := Align(q, withHon, nil, DefaultScoreProfile)
	b := Align(q, withOther, nil, DefaultScoreProfile)
	if a.Counts.Honorific != 4 || a.Counts.Insertions != 0 {
		t.Errorf("شمارش دعایی: %+v", a.Counts)
	}
	if !(a.Score > b.Score) || a.Score < 0.85 {
		t.Errorf("صلوات افزوده باید ارزان‌تر از افزودهٔ عادی باشد: %.3f در برابر %.3f", a.Score, b.Score)
	}
	if a.Score >= 1 {
		t.Errorf("افزودهٔ دعایی بی‌هزینه نیست: %.3f", a.Score)
	}
}

func normN1(w string) string  { s, _ := norm.NormalizeN1(w); return s }
func normN2(n1 string) string { return norm.WordToN2(n1) }
