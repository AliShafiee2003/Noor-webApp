package search

// citations_test.go — آزمون کلیدهای استناد (مورد ۳ دور ممیزی): قرارداد کلیدها،
// بازهٔ آیه، واریانت ارقام و هم‌خوانی با QuranScopeKeys.
import "testing"

func TestCitationKeysBasics(t *testing.T) {
        raw := `[{"sure":"2","aya":"213","address":"البقرة: ٢١٣","block_id":"b-0006"}]`
        keys := CitationKeys(raw)
        want := map[string]bool{"s2": true, "s2:a213": true}
        if len(keys) != len(want) {
                t.Fatalf("تعداد کلیدها: got %v want %v", keys, want)
        }
        for _, k := range keys {
                if !want[k] {
                        t.Fatalf("کلید غیرمنتظره: %s (all: %v)", k, keys)
                }
        }
}

func TestCitationKeysRangeExpands(t *testing.T) {
        raw := `[{"sure":"55","aya_from":"33","aya_to":"35"}]`
        keys := CitationKeys(raw)
        want := []string{"s55", "s55:a33", "s55:a34", "s55:a35"}
        if len(keys) != len(want) {
                t.Fatalf("بازهٔ آیه باز نشد: got %v want %v", keys, want)
        }
        for i, k := range want {
                if keys[i] != k {
                        t.Fatalf("کلید %d: got %s want %s", i, keys[i], k)
                }
        }
}

func TestCitationKeysPersianDigits(t *testing.T) {
        // ارقام فارسی در sure/aya — باید شکل نرمال و شکل خام هر دو ایندکس شوند
        raw := `[{"sure":"٢","aya":"۲۱۳"}]`
        keys := CitationKeys(raw)
        has := map[string]bool{}
        for _, k := range keys {
                has[k] = true
        }
        // شکل نرمال
        if !has["s2"] || !has["s2:a213"] {
                t.Fatalf("شکل نرمال ارقام ایندکس نشد: %v", keys)
        }
        // شکل خام (تطبیق verifier روی رشتهٔ خام است)
        if !has["s٢"] || !has["s٢:a۲۱۳"] {
                t.Fatalf("شکل خام ارقام ایندکس نشد: %v", keys)
        }
}

func TestCitationKeysEmpty(t *testing.T) {
        for _, raw := range []string{"", "null", "[]", "not-json"} {
                if got := CitationKeys(raw); got != nil {
                        t.Fatalf("ورودی %q باید nil بدهد؛ got %v", raw, got)
                }
        }
}

func TestQuranScopeKeysMatchesCitationKeys(t *testing.T) {
        // کلیدهای پرس‌وجو باید زیرمجموعهٔ کلیدهای ایندکس‌شده باشند (superset بودن فیلتر)
        // فقط برای پرس‌وجوهایی که verifier هم می‌پذیرد (تطبیق خام سوره).
        raw := `[{"sure":"55","aya_from":"33","aya_to":"41"},{"sure":"57","aya":"4"}]`
        indexed := map[string]bool{}
        for _, k := range CitationKeys(raw) {
                indexed[k] = true
        }
        for _, q := range []*QuranRef{
                {Sure: "55"}, {Sure: "55", Aya: "35"}, {Sure: "57", Aya: "4"}, {Sure: "114"},
        } {
                for _, k := range QuranScopeKeys(q) {
                        if q.Sure == "114" {
                                // سورهٔ ناموجود در داده — کلید نباید در ایندکسِ این passage باشد
                                if indexed[k] {
                                        t.Fatalf("کلید %s نباید تطبیق می‌داد", k)
                                }
                                continue
                        }
                        if !indexed[k] {
                                t.Fatalf("کلید پرس‌وجو %s (q=%+v) در کلیدهای ایندکس نیست → recall می‌شکند", k, q)
                        }
                }
        }
}

func TestQuranScopeKeysExact(t *testing.T) {
        // سوره همیشه خام؛ آیه: خام + نرمال (برای بازه)
        got := QuranScopeKeys(&QuranRef{Sure: "55", Aya: "۳۵"})
        want := []string{"s55:a۳۵", "s55:a35"}
        if len(got) != len(want) {
                t.Fatalf("got %v want %v", got, want)
        }
        for i := range want {
                if got[i] != want[i] {
                        t.Fatalf("کلید %d: got %s want %s", i, got[i], want[i])
                }
        }
        // آیهٔ لاتین → یک کلید
        if got := QuranScopeKeys(&QuranRef{Sure: "2", Aya: "213"}); len(got) != 1 || got[0] != "s2:a213" {
                t.Fatalf("آیهٔ لاتین: got %v", got)
        }
        // بدون آیه → فقط سوره
        if got := QuranScopeKeys(&QuranRef{Sure: "55"}); len(got) != 1 || got[0] != "s55" {
                t.Fatalf("سورهٔ تنها: got %v", got)
        }
}

func TestQuranScopeKeysNil(t *testing.T) {
        if got := QuranScopeKeys(nil); got != nil {
                t.Fatalf("nil باید nil بدهد؛ got %v", got)
        }
        if got := QuranScopeKeys(&QuranRef{Sure: ""}); got != nil {
                t.Fatalf("سورهٔ خالی باید nil بدهد؛ got %v", got)
        }
}
