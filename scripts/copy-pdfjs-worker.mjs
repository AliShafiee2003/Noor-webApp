// کپی worker آفلاین pdf.js به public — در صورت تغییر نسخه‌ی pdfjs-dist اجرای
// postinstall آن را همگام نگه می‌دارد (worker از URL سرو می‌شود نه از bundler،
// تا مسیر آن از Turbopack dev/build و next start عبور کند).
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs");
const dstDir = join(root, "public", "pdfjs");
const dst = join(dstDir, "pdf.worker.min.mjs");

function workerVersion(path) {
  try {
    const text = readFileSync(path, "utf8");
    const m = text.match(/pdfjsVersion\s*=\s*["']([^"']+)["']/);
    return m ? m[1] : statSync(path).size.toString();
  } catch {
    return null;
  }
}

if (!existsSync(src)) {
  console.error("[copy-pdfjs] worker source not found:", src);
  process.exit(1);
}
if (!existsSync(dstDir)) mkdirSync(dstDir, { recursive: true });
const srcVer = workerVersion(src);
const dstVer = existsSync(dst) ? workerVersion(dst) : null;
if (srcVer === null || srcVer !== dstVer) {
  copyFileSync(src, dst);
  console.log(`[copy-pdfjs] worker copied (${dstVer ?? "none"} -> ${srcVer})`);
} else {
  console.log(`[copy-pdfjs] worker up to date (${srcVer})`);
}
