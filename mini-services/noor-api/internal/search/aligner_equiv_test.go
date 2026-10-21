package search

import (
	"math/rand"
	"reflect"
	"strings"
	"testing"

	"noor/internal/norm"
)

// واژگان آزمون: پیشوندها، همزه/الف، ة/ه، املای نزدیک، عبارت دعایی و پرتکرارها.
var alignVocab = []string{
	"قال", "رسول", "الله", "عن", "أبي", "ابي", "عبد", "العلم", "علم", "والعلم", "بالعلم", "خير", "من", "المال",
	"رحمة", "رحمه", "الصلاة", "الصلوة", "مسألة", "مسالة", "كتاب", "الكتاب", "كتب", "كاتب", "مكتوب",
	"صلى", "عليه", "وآله", "وسلم", "ع", "ص", "عج", "قده", "السلام", "في", "على", "علي", "إلى", "الى",
	"يقول", "يقوله", "تقول", "فقال", "وقال", "الناس", "للناس", "لله", "والله", "بالله", "حديث", "حدیث",
	"محمد", "محمود", "أحمد", "احمد", "إبراهيم", "ابراهيم", "الرحمن", "الرحمان", "هذا", "هذه", "ذلك",
}

func alignTok(w string) AlignToken {
	ts := norm.TokenizeAligned(w)
	if len(ts) == 0 {
		return AlignToken{N1: w, N2: w}
	}
	return AlignToken{N1: ts[0].N1, N2: ts[0].N2}
}

func randSeq(r *rand.Rand, n int) []AlignToken {
	out := make([]AlignToken, n)
	for i := range out {
		out[i] = alignTok(alignVocab[r.Intn(len(alignVocab))])
	}
	return out
}

// perturb پنجرهٔ متن از روی پرسش: حذف/افزوده/جایگزینی/جابه‌جایی/بلوک + حاشیهٔ تصادفی.
func perturb(r *rand.Rand, q []AlignToken) []AlignToken {
	d := append([]AlignToken(nil), q...)
	for k := r.Intn(5); k > 0; k-- {
		if len(d) == 0 {
			break
		}
		i := r.Intn(len(d))
		switch r.Intn(6) {
		case 0:
			d = append(d[:i], d[i+1:]...)
		case 1:
			d = append(d[:i], append([]AlignToken{alignTok(alignVocab[r.Intn(len(alignVocab))])}, d[i:]...)...)
		case 2:
			d[i] = alignTok(alignVocab[r.Intn(len(alignVocab))])
		case 3:
			if i+1 < len(d) {
				d[i], d[i+1] = d[i+1], d[i]
			}
		case 4:
			if L := 2 + r.Intn(3); i+L <= len(d) {
				blk := append([]AlignToken(nil), d[i:i+L]...)
				rest := append(append([]AlignToken(nil), d[:i]...), d[i+L:]...)
				p := r.Intn(len(rest) + 1)
				d = append(append(append([]AlignToken(nil), rest[:p]...), blk...), rest[p:]...)
			}
		case 5:
			d = append(d[:i], append([]AlignToken{alignTok("صلى"), alignTok("الله"), alignTok("عليه"), alignTok("وآله")}, d[i:]...)...)
		}
	}
	pre, post := randSeq(r, r.Intn(6)), randSeq(r, r.Intn(6))
	return append(append(pre, d...), post...)
}

func testWeight(seed int64) func(string) float64 {
	r := rand.New(rand.NewSource(seed))
	df := map[string]int{}
	for _, w := range alignVocab {
		df[alignTok(w).N2] = 1 + r.Intn(5000)
	}
	return func(n2 string) float64 { return TokenWeight(df[n2], 10000) }
}

// TestAlignerMatchesReference: aligner بهینه روی هر ورودی دقیقاً همان نتیجهٔ نسخهٔ پیشین را
// می‌دهد — هم با Align تک‌پنجره‌ای و هم با یک aligner بازاستفاده‌شده برای پنجره‌های پیاپی
// (کش کلاس جفت‌ها، بازنشانی بودجه و بافرهای بازاستفاده).
func TestAlignerMatchesReference(t *testing.T) {
	r := rand.New(rand.NewSource(42))
	old := alignerClassBudget
	defer func() { alignerClassBudget = old }()
	for round := 0; round < 400; round++ {
		if round%3 == 0 {
			alignerClassBudget = 64 // بازنشانی مکرر فرهنگ در میانهٔ پنجره‌ها
		} else {
			alignerClassBudget = old
		}
		q := randSeq(r, 1+r.Intn(30))
		w := testWeight(int64(round))
		if round%7 == 0 {
			w = nil
		}
		al := newAligner(q, w, DefaultScoreProfile)
		for k := 0; k < 12; k++ {
			d := perturb(r, q)
			if k%5 == 4 {
				d = randSeq(r, r.Intn(40))
			}
			want := alignReference(q, d, w, DefaultScoreProfile)
			if got := Align(q, d, w, DefaultScoreProfile); !reflect.DeepEqual(got, want) {
				t.Fatalf("Align ≠ مرجع\nq=%v\nd=%v\ngot=%+v\nwant=%+v", toks(q), toks(d), got, want)
			}
			var got AlignmentResult
			if len(d) == 0 {
				got = AlignmentResult{Algorithm: AlignerAlgorithm, Version: AlignerVersion}
			} else {
				got = al.align(d)
			}
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("aligner بازاستفاده‌شده ≠ مرجع (round=%d k=%d)\nq=%v\nd=%v\ngot=%+v\nwant=%+v", round, k, toks(q), toks(d), got, want)
			}
		}
	}
}

func toks(ts []AlignToken) string {
	var b strings.Builder
	for i, t := range ts {
		if i > 0 {
			b.WriteByte(' ')
		}
		b.WriteString(t.N1)
	}
	return b.String()
}

// TestEditDistance1RunesMatchesString: نسخهٔ rune با نسخهٔ رشته‌ای هم‌ارز است.
func TestEditDistance1RunesMatchesString(t *testing.T) {
	ws := append([]string{"", "ا", "كتاب", "کتاب", "كتابه", "كتب", "مكتوب", "مكتوب", "مكتبو", "رحمة", "رحمه", "رحمت"}, alignVocab...)
	for _, a := range ws {
		for _, b := range ws {
			want := a != b && norm.EditDistance1(a, b)
			got := a != b && norm.EditDistance1Runes([]rune(a), []rune(b))
			if got != want {
				t.Fatalf("EditDistance1(%q,%q): rune=%v string=%v", a, b, got, want)
			}
		}
	}
}

// TestAlignerBelowIsSound هرس کران بالا هرگز پنجره‌ای را که امتیازش به آستانه می‌رسد رد نمی‌کند
// و روی پنجره‌های دور از پرسش واقعاً فعال می‌شود.
func TestAlignerBelowIsSound(t *testing.T) {
	r := rand.New(rand.NewSource(7))
	pruned, total := 0, 0
	for round := 0; round < 300; round++ {
		q := randSeq(r, 1+r.Intn(40))
		w := testWeight(int64(round))
		if round%5 == 0 {
			w = nil
		}
		al := newAligner(q, w, DefaultScoreProfile)
		for k := 0; k < 15; k++ {
			d := perturb(r, q)
			if k%3 == 2 {
				d = randSeq(r, 1+r.Intn(60))
			}
			ref := alignReference(q, d, w, DefaultScoreProfile)
			for _, ms := range []float64{0.5, 0.7, 0.8, 0.95, 1} {
				total++
				if al.below(d, ms) {
					pruned++
					if ref.Score >= ms {
						t.Fatalf("unsound prune: score=%v min=%v\nq=%v\nd=%v", ref.Score, ms, toks(q), toks(d))
					}
				}
			}
			if got := al.align(d); !reflect.DeepEqual(got, ref) {
				t.Fatalf("align after below ≠ مرجع\nq=%v\nd=%v", toks(q), toks(d))
			}
		}
	}
	if pruned == 0 {
		t.Fatal("below never pruned")
	}
	t.Logf("pruned %d/%d", pruned, total)
}
