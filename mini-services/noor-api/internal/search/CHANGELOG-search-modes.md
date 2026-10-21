# تغییرات بک‌اند جست‌وجو — قرارداد دوحالته (text / words) و بهینه‌سازی سرعت

فرانت‌اند دست نخورده است. حالت‌های قدیمی (`strict_phrase`، `normalized_phrase`، `linguistic`،
`tiered`، `long_quote`، `similar_quote`، `all_words`، `any_words`، `near`) همچنان پذیرفته می‌شوند
و نتیجهٔ دقیقاً یکسان با معادل تازه‌شان می‌دهند (`TestModesEquivalentResults`).
**نمایه نیازی به بازسازی ندارد** (طرح نمایه و قواعد نرمال‌سازی `n1-1.4.0` تغییر نکرده است).

## ۱. قرارداد تازه

```jsonc
// متن (عبارت با ترتیب)
{"query": "...", "mode": "text", "flex": "exact|written|spelling|similar", // پیش‌فرض similar
 "sort": "relevance|similarity|source", "diacritics": "...", "expand_morphology": false,
 "near_spelling": false, "min_score": 0.7, "layers": ["L1","L4"], "result_layers": ["L4"]}

// واژه‌ها (بی‌ترتیب)
{"query": "...", "mode": "words", "words": {"match": "all|any", "distance": 0, "ordered": false}}
```

| درخواست تازه | حالت داخلی (همان موتور قبلی) |
|---|---|
| `text` + `flex=exact` | `strict_phrase` |
| `text` + `flex=written` | `normalized_phrase` |
| `text` + `flex=spelling` | `linguistic` |
| `text` + `flex=similar` (پیش‌فرض) | `tiered` |
| `text` + `flex=similar` + `sort=similarity` | `similar_quote` |
| `long_quote` (قدیمی) | `tiered` (فقط سقف طول فرق داشت) |
| `words` (پیش‌فرض all) | `all_words` |
| `words` + `match=any` | `any_words` |
| `words` + `distance=N` (+`ordered`) | `near` با `slop=N` |

ترکیب‌های ناسازگار به‌جای نادیده‌گرفته‌شدن، خطای ۴۰۰ با پیام فارسی می‌دهند:
`near_spelling`/`layers`/`sort=similarity` فقط با `flex=similar`؛ `expand_morphology` فقط با
`spelling`/`similar`؛ در `words` هیچ‌کدام از این‌ها و `flex` معتبر نیست؛ `any` با `distance`/`ordered`
ترکیب نمی‌شود؛ `ordered` بدون `distance` معنا ندارد؛ `distance` بین ۰ تا ۵۰.

سقف طول: یک سقف برای هر خانواده — همهٔ سطوح `text` ۸۱۹۲ نویسه، `words` ۲۰۴۸ نویسه؛
`match=any` حداکثر ۳۲ واژهٔ متمایز.

پاسخ (فیلدهای افزوده، سازگار با قبل): `effective_mode`، `effective_flex`، `result_layers` و
`similar_coverage` با مقدار تازهٔ `not_run` (وقتی L4 خواسته شد ولی پرسش کمتر از ۳ واژه بود؛
همراه با یادداشت در `notice`).

`result_layers` فیلتر **نمایش** است: روی همان اجرای کش‌شده اعمال می‌شود (کلید کش را عوض نمی‌کند)،
`total_results` و صفحه‌بندی روی فهرست فیلترشده‌اند و `layer_counts`/شمارش‌ها کل اجرا را نشان می‌دهند.
کلید کش از حالت داخلی ساخته می‌شود، پس درخواست قدیمی و تازهٔ هم‌معنا یک کش مشترک دارند
(`sort` به دو مقدار معنادار `""`/`source` یکتا می‌شود).

## ۲. تغییرات رفتاری (اصلاح خطا)

- **گونهٔ فارسی با ی عربی/نیم‌فاصله** (`TestPersianVariantArabicYehZWNJ` شما): گونه‌های
  `normalized_phrase` حالا روی ستون `n2k` جست‌وجو می‌شوند و تفاوت املایی واقعی در diffs می‌آید.
- **L4 برای پرسش سه‌واژه‌ای واقعاً اجرا می‌شود.** پیش‌تر نگهبان `m < 4` در `similarShard` آن را
  بی‌صدا خالی برمی‌گرداند در حالی که پاسخ `partial` می‌گفت. anchorهای سه‌واژه‌ای سقف کل ۱۰۰۰
  (تقسیم بر شاردها، حداقل ۵۰ در هر شارد) دارند و پوشش همچنان `partial` اعلام می‌شود.
- برای پرسش سه‌واژه‌ای دیگر دو یادداشت تکراری «حداقل واقعی‌اند» نمی‌آید؛ یادداشت سقف‌های تعاملی
  فقط وقتی می‌آید که واقعاً سقفی فعال شده باشد.

## ۳. بهینه‌سازی‌ها (همه نتیجه‌-نگه‌دار؛ با آزمون مرجع)

| بخش | تغییر | آزمون هم‌ارزی |
|---|---|---|
| ساخت نتایج | `Result` کامل (snippet، نقش‌ها، عنوان‌ها) فقط برای صفحهٔ نمایش ساخته و نگه داشته می‌شود، نه برای ۱۰٬۰۰۰ نتیجه | `TestModesEquivalentResults` و کل مجموعه |
| تأیید L1 | مقایسهٔ بایتی بازهٔ متن با پرسش، بدون تبدیل کل passage به `[]rune` | `TestExactAtMatchesRuneCheck` |
| aligner | کلاس جفت‌واژه‌ها کش می‌شود، بافرها بازاستفاده، برچسب‌ها فقط در traceback | `TestAlignerMatchesReference` (نسخهٔ قدیم به‌عنوان مرجع) |
| هرس L4 | کران بالای دقیق امتیاز پیش از DP؛ پنجره‌ای که حتماً زیر `min_score` است هم‌تراز نمی‌شود | `TestAlignerBelowIsSound` |
| پنجره‌های L4 | یک پرس‌وجوی SQL برای هر خوشه از پنجره‌های نزدیک یک سند (به‌جای یکی برای هر پنجره که از ابتدای سند اسکن می‌کرد) + واکشی دسته‌ای | `TestWindowPassagesMatchesPerWindowQuery` |
| anchorهای L4 | یک جست‌وجوی map برای هر واژه (کلید + پرچم جفت) و محاسبهٔ یک‌بارهٔ `ReuseKey` | کل مجموعه |
| واژه‌بندی (`norm`) | کش سطوح بی‌قفل (عکس فوری + افزوده) به‌جای `sync.Map`، رمزگشایی درون‌خطی UTF-8، پیش‌تخصیص دقیق‌تر، کشف UTF-8 نامعتبر در همان گذر | `TestTokenizeAlignedMatchesReference` (نسخهٔ قدیم)، `TestLevelsCacheBoundedAndCorrect`، `TestWordLevelsConcurrent` |
| `EditDistance1` | پیش‌فیلتر طول و نسخهٔ `[]rune` | `TestEditDistance1RunesMatchesString` |
| snippet | `runeSpan` بدون تبدیل کل متن | کل مجموعه |

### سنجش (پیکرهٔ Zipf ≈ ۱٫۰۶ میلیون واژه، ۴ شارد، کش نتایج خاموش، ۲ هسته)

`NOOR_BENCH=1 NOOR_BENCH_DIR=/tmp/zipf go test ./internal/search -run TestZipfLatency -v`

| مورد | p50 قبل | p50 بعد | p95 قبل | p95 بعد |
|---|---|---|---|---|
| written ۱ واژهٔ پرتکرار (~۹٬۹۰۰ نتیجه) | 1067ms | 165ms | 1292ms | 235ms |
| written ۱ واژهٔ میانه | 62ms | 21ms | 100ms | 44ms |
| exact ۴ واژه | 1.6ms | 0.6ms | 1.7ms | 0.9ms |
| written ۳ واژه | 1.2ms | 0.8ms | 1.4ms | 1.0ms |
| spelling ۳ واژه | 1.5ms | 1.2ms | 1.9ms | 1.8ms |
| similar ۱ واژه | 42ms | 19ms | 120ms | 61ms |
| similar ۳ واژه* | 1.6ms | 6.8ms | 2.9ms | 158ms |
| similar ۱۲ واژه + ۱ جایگزینی | 122ms | 59ms | 708ms | 217ms |
| similar ۴۰ واژه + ۲ حذف | 1587ms | 323ms | 1783ms | 387ms |
| words/all ۳ واژه | 1.5ms | 1.3ms | 2.8ms | 2.0ms |
| words/any ۳ واژه | 114ms | 55ms | 218ms | 89ms |

\* پیش‌تر L4 سه‌واژه‌ای اصلاً اجرا نمی‌شد (خطای بالا)؛ حالا اجرا می‌شود و سقف‌دار است.

## ۴. فایل‌ها

- `internal/search`: `modes.go` (تازه)، `engine.go`، `fts5_engine.go`، `fts5_query.go`،
  `fts5_similar.go`، `aligner.go`، `golden.go`؛ آزمون‌های تازه: `modes_test.go`،
  `aligner_equiv_test.go`، `aligner_ref_test.go`، `exact_at_test.go`، `window_passages_test.go`،
  `bench_zipf_test.go`؛ `TestTieredAcceptsLongPaste` با قرارداد تازهٔ سقف طول به‌روز شد.
- **بیرون از پوشهٔ search** (لازم برای کامپایل): `internal/norm/levels.go` (`EditDistance1Runes`،
  کش سطوح، واژه‌بندی سریع‌تر)، `internal/norm/norm.go` (`WordBoundaryRunes`)،
  `internal/norm/flex.go` (ترتیب ارزان‌تر بررسی‌های `isFootnoteRef`)؛ آزمون‌ها:
  `levels_cache_test.go`، `tokenize_ref_test.go`.
- `httpapi` و `cmd/*` تغییری ندارند (`NearOpts` نام مستعار همان struct بی‌نام قبلی است).
