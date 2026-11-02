import type { NextRequest } from "next/server";

/**
 * مسیر اختصاصی استریم فایل رسانه‌ای (pdf/image/audio) — فاز رسانه.
 *
 * چرا جدا از catch-all [...path]؟ آن پل بدنهٔ هر پاسخ را کامل بافر می‌کند
 * (یافتهٔ دور ۱۴ دربارهٔ JSON) که برای PDF تا ~۵۸۰MB و جست‌وجوی صوتی با Range
 * نامناسب است. سگمنت داینامیک اختصاصی بر catch-all تقدم دارد، پس بقیهٔ
 * اندپوینت‌های JSON دست‌نخورده می‌مانند و فقط فایل رسانه‌ای استریم می‌شود.
 * هدر Range به بالا-دست (http.ServeContent در Go) می‌رسد و 206/304 مستقیم
 * به مرورگر برمی‌گردد — pdf.js و <audio> فقط بایت‌های لازم را می‌کشند.
 */
export const dynamic = "force-dynamic";

const UPSTREAM = "http://127.0.0.1:8080";

/** هدرهای درخواست که برای رسانه باید عبور کنند */
const PASS_REQUEST = ["cookie", "range", "if-range", "if-none-match", "if-modified-since", "accept"] as const;

/** هدرهای پاسخ رسانه که به مرورگر برمی‌گردند.
 *  content-disposition عمداً عبور نمی‌کند: کروم پاسخ PDF دارای این هدر را در fetch
 *  قطع می‌کند (204 بی‌بدنه) و pdf.js با UnexpectedResponse شکست می‌خورد. */
const PASS_RESPONSE = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "etag",
  "last-modified",
  "cache-control",
] as const;

async function proxyMedia(req: NextRequest, ctx: { params: Promise<{ uid: string }> }) {
  const { uid } = await ctx.params; // Next 16: params یک Promise است
  const target = `${UPSTREAM}/api/v1/documents/${encodeURIComponent(uid)}/file`;

  const headers = new Headers();
  for (const h of PASS_REQUEST) {
    const v = req.headers.get(h);
    if (v !== null) headers.set(h, v);
  }
  headers.set("accept-encoding", "identity");

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      signal: req.signal,
      redirect: "manual",
      cache: "no-store",
    });
  } catch {
    return Response.json(
      {
        error: {
          code: "unavailable",
          message: "سامانه موقتاً در دسترس نیست؛ کمی بعد دوباره تلاش کنید.",
          trace_id: null,
          retryable: true,
        },
      },
      { status: 503 },
    );
  }

  if (upstream.status === 304 || upstream.status === 204 || !upstream.ok) {
    // خطاها/پاسخ‌های بدون بدنه کوچک‌اند — بافر مثل پل JSON
    const buf = await upstream.arrayBuffer();
    const errHeaders = new Headers();
    const ct = upstream.headers.get("content-type");
    if (ct) errHeaders.set("content-type", ct);
    if (upstream.status === 304 || upstream.status === 204) {
      return new Response(null, { status: upstream.status, headers: errHeaders });
    }
    return new Response(buf, { status: upstream.status, headers: errHeaders });
  }

  const respHeaders = new Headers();
  for (const h of PASS_RESPONSE) {
    const v = upstream.headers.get(h);
    if (v !== null) respHeaders.set(h, v);
  }
  // بدنهٔ استریم مستقیم — هیچ بافری
  return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
}

export const GET = proxyMedia;
export const HEAD = proxyMedia;
