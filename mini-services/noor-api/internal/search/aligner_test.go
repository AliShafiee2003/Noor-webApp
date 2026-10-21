package search

import (
	"strings"
	"testing"

	"noor/internal/norm"
)

func TestAlignerExactMatch(t *testing.T) {
	q := strings.Fields("قال رسول الله انما الاعمال بالنیات")
	doc := strings.Fields("و روی فی الحدیث انه قال رسول الله انما الاعمال بالنیات و لکل امریء ما نوی")

	res := AlignQueryToText(q, doc, nil, 1000)
	if res.Score < 0.99 {
		t.Errorf("تطابق کامل باید امتیاز ۱.۰ داشته باشد، گرفت: %f", res.Score)
	}
}

func TestAlignerTransposition(t *testing.T) {
	q := strings.Fields("رسول الله قال انما الاعمال")
	doc := strings.Fields("قال رسول الله انما الاعمال بالنیات")

	res := AlignQueryToText(q, doc, nil, 1000)
	if res.Score < 0.75 {
		t.Errorf("جابه‌جایی مجاور باید امتیاز بالای ۰.۷۵ داشته باشد، گرفت: %f", res.Score)
	}
}

func TestAlignerMonotonicity(t *testing.T) {
	// افزایش تغییرات باید امتیاز را کاهش دهد یا ثابت نگه دارد (یکنوایی)
	q := strings.Fields("قال رسول الله انما الاعمال بالنیات و لکل امریء ما نوی")
	doc0 := strings.Fields("قال رسول الله انما الاعمال بالنیات و لکل امریء ما نوی")
	doc1 := strings.Fields("قال رسول الله انما الاعمال الصالحات بالنیات و لکل امریء ما نوی") // ۱ کلمه اضافه
	doc2 := strings.Fields("قیل ان النبی قال الاعمال الصالحات بالنیات و لکل امریء ما نوی")   // چند تغییر

	s0 := AlignQueryToText(q, doc0, nil, 1000).Score
	s1 := AlignQueryToText(q, doc1, nil, 1000).Score
	s2 := AlignQueryToText(q, doc2, nil, 1000).Score

	if s0 < s1 {
		t.Errorf("نقض یکنوایی: s0 (%f) < s1 (%f)", s0, s1)
	}
	if s1 < s2 {
		t.Errorf("نقض یکنوایی: s1 (%f) < s2 (%f)", s1, s2)
	}
}

func alignToks(s string) []AlignToken {
	var out []AlignToken
	for _, w := range strings.Fields(s) {
		n1, _ := normalizeForTest(w)
		out = append(out, AlignToken{N1: n1, N2: n2ForTest(n1)})
	}
	return out
}

func TestAlignerSpanAndCounts(t *testing.T) {
	q := alignToks("قال رسول الله انما الاعمال بالنیات")
	d := alignToks("و روی فی الحدیث انه قال رسول الله انما الاعمال بالنیات و لکل امریء ما نوی")
	r := Align(q, d, nil, DefaultScoreProfile)
	if r.Score != 1 || r.Coverage != 1 {
		t.Fatalf("تطابق کامل: score=%v coverage=%v", r.Score, r.Coverage)
	}
	if r.MatchStart != 5 || r.MatchEnd != 11 {
		t.Errorf("بازهٔ دقیق باید [5,11) باشد؛ گرفت [%d,%d)", r.MatchStart, r.MatchEnd)
	}
	if r.Counts.Exact != 6 || r.Counts.Total() != 0 {
		t.Errorf("شمارش نادرست: %+v", r.Counts)
	}
}

func TestAlignerEditsAreCounted(t *testing.T) {
	q := alignToks("قال رسول الله انما الاعمال بالنیات و لکل امریء ما نوی")
	d := alignToks("قال النبی انما الاعمال الصالحه بالنیات و لکل امریء ما نوی")
	r := Align(q, d, nil, DefaultScoreProfile)
	if r.Counts.Insertions != 1 {
		t.Errorf("یک افزوده انتظار می‌رفت: %+v %v", r.Counts, r.Diffs)
	}
	if r.Counts.Substitutions+r.Counts.Deletions < 2 {
		t.Errorf("«رسول الله»→«النبی» باید دست‌کم دو تغییر باشد: %+v %v", r.Counts, r.Diffs)
	}
	if len(r.Diffs) == 0 {
		t.Error("فهرست تفاوت‌ها خالی است")
	}
}

func TestAlignerOrthographicAndProclitic(t *testing.T) {
	q := alignToks("قال رسول الله الصلاة عمود الدین")
	d := alignToks("فقال رسول اللّه الصلوة عمود الدین")
	r := Align(q, d, nil, DefaultScoreProfile)
	if r.Counts.Total() != 0 {
		t.Errorf("پیشوند ف و رسم‌الخط قرآنی تغییر واژه‌ای نیستند: %+v %v", r.Counts, r.Diffs)
	}
	if r.Counts.Orthographic != 2 {
		t.Errorf("دو تفاوت املایی (پیشوند ف، الصلوة) انتظار می‌رفت: %+v %v", r.Counts, r.Diffs)
	}
	if r.Score < 0.9 {
		t.Errorf("امتیاز باید بالای ۹۰٪ باشد: %v", r.Score)
	}
}

func TestAlignerNearSpelling(t *testing.T) {
	q := alignToks("انما الاعمال بالنیات و لکل امریء ما نوی")
	d := alignToks("انما الاعمل بالنیات و لکل امریء ما نوی")
	r := Align(q, d, nil, DefaultScoreProfile)
	if r.Counts.NearSpelling != 1 {
		t.Errorf("یک واژهٔ نزدیک انتظار می‌رفت: %+v", r.Counts)
	}
}

func TestAlignerBlockMove(t *testing.T) {
	q := alignToks("من کنت مولاه فعلی مولاه اللهم وال من والاه")
	d := alignToks("اللهم وال من والاه من کنت مولاه فعلی مولاه")
	r := Align(q, d, nil, DefaultScoreProfile)
	if r.Counts.BlockMoves != 1 {
		t.Errorf("یک جابه‌جایی بلوکی انتظار می‌رفت: %+v %v", r.Counts, r.Diffs)
	}
	if r.Score < 0.7 {
		t.Errorf("جابه‌جایی بلوکی نباید امتیاز را زیر ۷۰٪ ببرد: %v", r.Score)
	}
	if r.MatchStart != 0 || r.MatchEnd != len(d) {
		t.Errorf("بازه باید کل پنجره را بپوشاند: [%d,%d)", r.MatchStart, r.MatchEnd)
	}
}

func TestAlignerMonotoneChain(t *testing.T) {
	base := "قال رسول الله انما الاعمال بالنیات و لکل امریء ما نوی فمن کانت هجرته"
	q := alignToks(base)
	words := strings.Fields(base)
	prev := 2.0
	// هر گام یک واژهٔ دیگر را جایگزین می‌کند؛ امتیاز هرگز نباید بالا برود
	for k := 0; k <= 6; k++ {
		w := append([]string(nil), words...)
		for x := 0; x < k; x++ {
			w[1+2*x] = "زززز"
		}
		s := Align(q, alignToks(strings.Join(w, " ")), nil, DefaultScoreProfile).Score
		if s > prev+1e-9 {
			t.Fatalf("نقض یکنوایی در گام %d: %v > %v", k, s, prev)
		}
		prev = s
	}
}

func normalizeForTest(w string) (string, []int) { return norm.Normalize(w) }
func n2ForTest(n1 string) string                { return norm.WordToN2(n1) }
