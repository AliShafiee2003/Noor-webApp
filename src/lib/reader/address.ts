export function readerAddressText(work: string, volume: string, page: string | null | undefined, url: string): string {
  return [work, volume ? `جلد ${volume}` : "", page ? `صفحهٔ ${page}` : ""].filter(Boolean).join("، ") + "\n" + url;
}
