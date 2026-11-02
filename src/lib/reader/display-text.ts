/** Correct isolated abbreviation shaping without changing code-point offsets. */
export function displayBookText(text: string): string {
  // Some sources force isolated answer markers (e.g. ج‍ 90) into a joining form.
  // Replace that joiner with a non-joiner at the same offset; preserve word joins.
  return text.replace(/(^|\s)([\u0621-\u064a])\u200d(?=\s|[0-9۰-۹٠-٩:：])/gu, "$1$2\u200c");
}
