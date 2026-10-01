package search

// citations.go — کلیدهای ایندکس‌پذیر استناد قرآنی (مورد ۳ دور ممیزی).
//
// پیش از این، citationOnly روی OpenSearch با match_all + فیلتر verifier بود که
// روی fixture درست است اما روی کورپوس واقعی همهٔ release را پویش می‌کند. با
// ایندکس‌شدن کلیدهای استناد در فیلد keyword ‏citation_keys، پرس‌وجوی استناد صرف
// به terms filter محدود می‌شود؛ دقت نهایی همچنان همان citationAllows روی متن
// نمایهٔ SQLite است (فیلتر OS فقط recall باید بدهد — superset کافی است).
//
// قرارداد کلیدها:
//   «s{sure}»          — استناد به کل سوره
//   «s{sure}:a{aya}»   — استناد به آیهٔ مشخص (بازهٔ آیه به تک‌آیه‌ها باز می‌شود)
// ارقام با numNorm نرمال می‌شوند (ارقام فارسی/عربی/لاتین هم‌ارزند) و شکل خامِ
// Sure/Aya نیز در صورت تفاوت اضافه می‌شود، چون verifier روی رشتهٔ خام مقایسه
// می‌کند و نبودِ شکل خام یعنی false negative در recall.

import "strings"

// حداکثر بازشدن بازهٔ آیه در یک استناد (بزرگ‌ترین سورهٔ قرآن ۲۸۶ آیه دارد؛
// سقف فقط محافظ در برابر دادهٔ خراب است).
const maxAyaRangeExpansion = 300

// CitationKeys از JSON استنادهای یک passage کلیدهای keyword می‌سازد.
// ورودی همان ستون citations (فرمت xmlparse.Citation) است.
func CitationKeys(raw string) []string {
        refs, err := parseCitations(raw)
        if err != nil || len(refs) == 0 {
                return nil
        }
        seen := map[string]bool{}
        var out []string
        add := func(k string) {
                if k != "" && !seen[k] {
                        seen[k] = true
                        out = append(out, k)
                }
        }
        for _, ref := range refs {
                for _, sure := range sureVariants(ref.Sure) {
                        if sure == "" {
                                continue
                        }
                        add("s" + sure)
                        // آیهٔ واحد
                        if ref.Aya != "" {
                                for _, a := range ayaVariants(ref.Aya) {
                                        add("s" + sure + ":a" + a)
                                }
                        }
                        // بازهٔ آیه — بازشدن به تک‌آیه‌ها (همان معنای between در verifier)
                        if ref.AyaFrom != "" && ref.AyaTo != "" {
                                for _, k := range rangeKeys(sure, ref.AyaFrom, ref.AyaTo) {
                                        add(k)
                                }
                        }
                }
        }
        return out
}

// QuranScopeKeys کلیدهای معادل فیلتر scope.quran برای سمت پرس‌وجو —
// دقیقاً همان چیزی که verifier می‌پذیرد: سوره همیشه مقایسهٔ خام است
// (c.Sure == q.Sure)؛ آیه یا تطبیق خام تک‌آیه است (c.Aya == q.Aya) یا
// بازه‌ای که between آن را نرمال رقم می‌کند. پس دو شکل آیه لازم است و
// سوره فقط شکل خام — نه ضرب دکارتی واریانت‌ها.
func QuranScopeKeys(q *QuranRef) []string {
        if q == nil || q.Sure == "" {
                return nil
        }
        if q.Aya == "" {
                return []string{"s" + q.Sure}
        }
        keys := []string{"s" + q.Sure + ":a" + q.Aya}
        if n := numNorm(q.Aya); n != "" && n != q.Aya {
                keys = append(keys, "s"+q.Sure+":a"+n)
        }
        return keys
}

// sureVariants شکل نرمال رقم + شکل خام سوره (تطبیق verifier روی رشتهٔ خام است).
func sureVariants(sure string) []string {
        return numVariants(sure)
}

// ayaVariants همان منطق برای آیه.
func ayaVariants(aya string) []string {
        return numVariants(aya)
}

func numVariants(s string) []string {
        n := numNorm(s)
        if n == "" {
                if s == "" {
                        return nil
                }
                return []string{s}
        }
        if n == s {
                return []string{n}
        }
        return []string{n, s}
}

// rangeKeys بازهٔ آیهٔ from..to را به کلیدهای تک‌آیه باز می‌کند.
func rangeKeys(sure, from, to string) []string {
        f := numNorm(from)
        t := numNorm(to)
        if f == "" || t == "" {
                return nil
        }
        fi, ti := parseIntSafe(f), parseIntSafe(t)
        if fi <= 0 || ti <= 0 || fi > ti || ti-fi > maxAyaRangeExpansion {
                return nil
        }
        out := make([]string, 0, ti-fi+1)
        for i := fi; i <= ti; i++ {
                out = append(out, "s"+sure+":a"+itoaSafe(i))
        }
        return out
}

func parseIntSafe(s string) int {
        n := 0
        for _, r := range s {
                if r < '0' || r > '9' {
                        return 0
                }
                n = n*10 + int(r-'0')
                if n > 1_000_000 {
                        return 0
                }
        }
        return n
}

func itoaSafe(n int) string {
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

// hasCitations بررسی سریع «آیا JSON استناد خالی است» — برای مسیر ایندکس.
func hasCitations(raw string) bool {
        return raw != "" && raw != "null" && strings.TrimSpace(raw) != ""
}
