# قلم‌های محلی میزکار نور — مجوزها و منابع

تمام قلم‌ها **محلی** هستند: از طریق بسته‌های `@fontsource/*` به‌صورت وابستگی npm ثبت و در باندل ساخته می‌شوند؛ **هیچ CDN یا درخواست بیرونی** برای قلم انجام نمی‌شود (§۴۱).

## خانواده‌ها و نقش‌ها

| نقش | قلم | بسته | نسخه | مجوز |
|---|---|---|---|---|
| رابط و فارسی (UI) | Vazirmatn | `@fontsource/vazirmatn` | 5.x | SIL OFL 1.1 — `LICENSE-Vazirmatn.txt` |
| نثر عربی (متن/پاورقی عربی) | Amiri | `@fontsource/amiri` | 5.x | SIL OFL 1.1 — `LICENSE-Amiri.txt` |
| متن قرآنی (آیه/ayahWord) | Amiri Quran | `@fontsource/amiri-quran` | 5.3.0 | SIL OFL 1.1 — `LICENSE-AmiriQuran.txt` |
| متن قرآنی (گزینهٔ دوم کاربر) | Scheherazade New | `@fontsource/scheherazade-new` | 5.3.0 | SIL OFL 1.1 — `LICENSE-ScheherazadeNew.txt` |
| متون لاتین/انگلیسی (خودشناسایی) | Source Serif 4 | `@fontsource/source-serif-4` | 5.3.0 | SIL OFL 1.1 — `LICENSE-SourceSerif4.txt` |
| متون لاتین (گزینهٔ دوم کاربر) | Inter | `@fontsource/inter` | 5.3.0 | SIL OFL 1.1 — `LICENSE-Inter.txt` |

## قواعد تخصیص (پرکاربردترین بخش)

1. **قلم قرآنی بر اساس نقش تگ است، نه حدس زبان کتاب**: بلوک `ayah_quote` و اسپن‌های `ayah_text` / `ayahWord` همیشه `var(--font-quran)` می‌گیرند.
2. **fallback چنداسکریپتی**: استک‌ها طوری چیده شده‌اند که در پاراگراف آمیختهٔ عربی/فارسی/لاتین، هر نویسه با قلم نقش خودش رندر شود (لاتین → قلم لاتین انتخابی، عربی → قلم نثر، فارسی → وزیرمتن).
3. **شناسایی خودکار متن انگلیسی**: بلوکی که نویسهٔ عربی ندارد و ≥۸ حرف لاتین دارد، به‌صورت `dir="ltr"` + `lang="en"` با `var(--font-latin)` رندر می‌شود (`src/lib/script.ts`).
4. **متن قرآنی پیش‌فرض**: ۲۴px و line-height ≈ ۲٫۰ (`quran_font_size` / `quran_line_height` در ترجیحات کاربر).
5. کاربر می‌تواند قلم نثر عربی، قلم قرآنی و قلم لاتین را از «تنظیمات ← خواندن» یا پاپ‌آور کتاب‌خوان عوض کند (`PUT /workspace/prefs`).

## آزمون قلم قرآنی

معیار: وضوح حرکت‌گذاری، فاصله‌گذاری و عدم برخورد اعراب — روی نمونهٔ واقعی آیات همین مجموعه (جست‌وجوی طلایی «الكعبة بيت الله») آزمایش شد؛ پیش‌فرض **Amiri Quran** است و گزینهٔ Scheherazade New برای کاربر باقی مانده است.
