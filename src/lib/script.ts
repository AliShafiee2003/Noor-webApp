/**
 * شناسایی اسکریپت متن — حالت چهارم قلم (متون انگلیسی/لاتین):
 * بلوکی که هیچ نویسهٔ عربی ندارد و دست‌کم ۸ حرف لاتین دارد، متن لاتین فرض می‌شود
 * → dir="ltr" + lang="en" + قلم var(--font-latin).
 * در متن آمیختهٔ عربی/لاتین حدس نمی‌زنیم؛ استک چنداسکریپتی (src/lib/fonts.ts) خودش
 * ران‌های لاتین را با قلم لاتین رندر می‌کند.
 */

const ARABIC_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0600, 0x06ff], // Arabic
  [0x0750, 0x077f], // Arabic Supplement
  [0x08a0, 0x08ff], // Arabic Extended-A
  [0xfb50, 0xfdff], // Arabic Presentation Forms-A
  [0xfe70, 0xfeff], // Arabic Presentation Forms-B
];

const LATIN_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x41, 0x5a], // A-Z
  [0x61, 0x7a], // a-z
  [0xc0, 0x024f], // Latin-1 Supplement + Latin Extended-A/B
  [0x1e00, 0x1eff], // Latin Extended Additional
];

function inRanges(cp: number, ranges: ReadonlyArray<readonly [number, number]>): boolean {
  for (const [lo, hi] of ranges) {
    if (cp >= lo && cp <= hi) return true;
  }
  return false;
}

/** آستانهٔ حداقل حروف لاتین — از برچسب‌های کوتاه مثل «AWB» یا «IBN» پرهیز می‌کند */
const MIN_LATIN_LETTERS = 8;

/**
 * آیا این متن «بلوک لاتین» است؟
 * هیچ نویسهٔ عربی + ≥۸ حرف لاتین → انگلیسی/لاتین خالص.
 * (اعداد و نقطه‌گذاری در تصمیم نقش ندارند.)
 */
export function isLatinBlock(text: string): boolean {
  if (!text) return false;
  let latin = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (inRanges(cp, ARABIC_RANGES)) return false; // یک نویسهٔ عربی کافی است
    if (inRanges(cp, LATIN_RANGES)) latin++;
  }
  return latin >= MIN_LATIN_LETTERS;
}
