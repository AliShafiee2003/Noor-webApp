package search

import (
	"math/rand"
	"strings"
	"testing"

	"noor/internal/norm"
)

// TestExactAtMatchesRuneCheck مقایسهٔ بایتی L1 دقیقاً همان runesEqual+wholeWordAt روی []rune است
// (UTF-8 معتبر، نیم‌فاصله، اعراب، علائم و متن نامعتبر که به مسیر rune می‌رود).
func TestExactAtMatchesRuneCheck(t *testing.T) {
	parts := append([]string{" ", " ", "\u200c", "،", ":", "(", ")", "«", "»", "ُ", "َ", "\n", "\xff", "ـ", "x"}, alignVocab...)
	r := rand.New(rand.NewSource(11))
	checked := 0
	for k := 0; k < 800; k++ {
		var b strings.Builder
		for n := 3 + r.Intn(25); n > 0; n-- {
			b.WriteString(parts[r.Intn(len(parts))])
			if r.Intn(3) > 0 {
				b.WriteByte(' ')
			}
		}
		text := b.String()
		toks := norm.TokenizeAligned(text)
		if len(toks) == 0 {
			continue
		}
		orig := []rune(text)
		origF := func() []rune { return orig }
		for a := 0; a < len(toks); a++ {
			for m := 1; m <= 3 && a+m <= len(toks); m++ {
				s, e := toks[a].Start, toks[a+m-1].End
				// پرسش = همان بازهٔ متن (L1 مثبت) یا بازهٔ متن دیگری (منفی)
				for _, qs := range []string{string(orig[s:e]), string(orig[toks[r.Intn(len(toks))].Start:toks[len(toks)-1].End])} {
					q := parseFTSQuery(qs, false)
					if len(q.toks) == 0 {
						continue
					}
					want := runesEqual(orig[s:e], q.core) && wholeWordAt(orig, s, e)
					got := e-s == len(q.core) && q.exactAt(text, toks[a], toks[a+m-1], s, e, origF)
					if got != want {
						t.Fatalf("text=%q span=[%d,%d) q=%q: got %v want %v", text, s, e, qs, got, want)
					}
					checked++
				}
			}
		}
	}
	if checked < 1000 {
		t.Fatalf("too few checks: %d", checked)
	}
}
