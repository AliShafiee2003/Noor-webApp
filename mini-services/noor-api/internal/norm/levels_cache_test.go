package norm

import (
	"strconv"
	"sync"
	"testing"
	"unicode/utf8"
)

// TestLevelsCacheBoundedAndCorrect کش سطوح: مقدار درست، ادغام pending و تخلیه در سقف.
func TestLevelsCacheBoundedAndCorrect(t *testing.T) {
	c := newLevelsCache()
	n := levelCacheCap + 50_000
	for i := 0; i < n; i++ {
		k := strconv.Itoa(i)
		c.put(k, levels3{k, k + "1", k + "2"})
		if size := len(*c.snap.Load()) + len(c.pending); size > levelCacheCap {
			t.Fatalf("cache exceeded cap: %d", size)
		}
	}
	hits := 0
	for i := n - 1000; i < n; i++ {
		k := strconv.Itoa(i)
		l, ok := c.get(k)
		if !ok {
			continue
		}
		hits++
		if l.n0 != k || l.n1 != k+"1" || l.n2 != k+"2" {
			t.Fatalf("wrong value for %s: %+v", k, l)
		}
	}
	if hits != 1000 {
		t.Fatalf("recent keys must survive the flush: %d/1000", hits)
	}
}

// TestWordLevelsConcurrent همان سطوح بی‌کش، زیر خواندن/نوشتن هم‌زمان (با -race).
func TestWordLevelsConcurrent(t *testing.T) {
	words := []string{"کتاب‌ها", "الصَّلَوٰةَ", "مسئلهٔ", "خانه‌ی", "أبيه", "رسول", "الله", "علیه‌السلام"}
	for i := 0; i < 3000; i++ {
		words = append(words, "واژه"+strconv.Itoa(i))
	}
	var wg sync.WaitGroup
	for g := 0; g < 4; g++ {
		wg.Add(1)
		go func(g int) {
			defer wg.Done()
			for i := range words {
				w := words[(i*7+g)%len(words)]
				n0, n1, n2 := wordLevels(w)
				e0, _ := NormalizeN0(w)
				e1, _ := NormalizeN1(w)
				if n0 != e0 || n1 != e1 || n2 != WordToN2(e1) {
					t.Errorf("%q: cached levels differ", w)
					return
				}
			}
		}(g)
	}
	wg.Wait()
}

func TestDecodeRuneMatchesStdlib(t *testing.T) {
	var buf []byte
	for b0 := 0; b0 < 256; b0++ {
		for _, b1 := range []int{0x00, 0x41, 0x7F, 0x80, 0x9F, 0xA0, 0xBF, 0xC0, 0xFF} {
			for _, tail := range [][]byte{nil, {0x80}, {0x80, 0x80}} {
				buf = append(append(buf[:0], byte(b0), byte(b1)), tail...)
				s := string(buf)
				for _, end := range []int{1, len(s)} {
					x := s[:end]
					r1, n1 := decodeRune(x, 0)
					r2, n2 := utf8.DecodeRuneInString(x)
					if r1 != r2 || n1 != n2 {
						t.Fatalf("% x: got %U/%d want %U/%d", x, r1, n1, r2, n2)
					}
				}
			}
		}
	}
}

func TestTokenizeAlignedInvalidUTF8(t *testing.T) {
	for _, s := range []string{"علم \xff نافع", "\xd8", "قال\xc3( رسول", "a\x80b c", "سلام"} {
		got := TokenizeAligned(s)
		want := TokenizeAligned(string([]rune(s)))
		if len(got) != len(want) {
			t.Fatalf("%q: %d tokens vs %d", s, len(got), len(want))
		}
		for i := range got {
			if got[i] != want[i] {
				t.Fatalf("%q token %d: %+v vs %+v", s, i, got[i], want[i])
			}
		}
	}
}
