import type { NextRequest } from "next/server";

/**
 * پل BFF جلوی API — درخواست‌های /api/v1 مرورگر را شفاف به سرویس Go (127.0.0.1:8080) می‌رساند.
 *
 * چرا این پل لازم است؟ مرورگرِ پشت پروکسی پیش‌نمایش سندباکس ممکن است هدر Host
 * بازنویسی‌شده داشته باشد؛ در آن حالت کنترل Origin سمت API (لایهٔ دوم دفاع CSRF)
 * به‌اشتباه درخواست‌های هم‌مبدأ را با پیام «درخواست از مبدأ نامعتبر است» 403 می‌کند.
 * این مسیر سمت سرور فراخوانی می‌شود و هدر Origin/Referer مرورگر به بالا-دست نمی‌رسد،
 * پس بررسی مبدأ همیشه سالم عبور می‌کند. سپر اصلی CSRF همچنان هدر سفارشی
 * X-Noor-CSRF است که دست‌نخورده عبور داده می‌شود (§۴۱) و کوکی SameSite=Lax هم پابرجاست.
 */
export const dynamic = "force-dynamic";

const UPSTREAM = "http://127.0.0.1:8080";

/** هدرهای hop-by-hop که نباید بین لایه‌ها عبور کنند */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
]);

/** هدرهای درخواست که باید پیش از ارسال به بالا-دست حذف شوند */
const STRIP_REQUEST = new Set([
  "host",
  "origin",
  "referer",
  "content-length",
  "accept-encoding",
]);

async function proxy(req: NextRequest): Promise<Response> {
  const incoming = new URL(req.url);
  const relPath = req.nextUrl.pathname.replace(/^\/api\/v1/, "") || "/";
  const target = `${UPSTREAM}/api/v1${relPath}${incoming.search}`;

  const headers = new Headers();
  for (const [key, value] of req.headers.entries()) {
    const k = key.toLowerCase();
    if (HOP_BY_HOP.has(k) || STRIP_REQUEST.has(k)) continue;
    headers.set(key, value);
  }
  /* پاسخ فشرده را خودمان باز نمی‌کنیم؛ ساده و بدون فشرده‌سازی می‌خواهیم */
  headers.set("accept-encoding", "identity");

  const method = req.method;
  const hasBody = method !== "GET" && method !== "HEAD";
  const body = hasBody ? await req.arrayBuffer() : undefined;

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method,
      headers,
      body,
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

  const respHeaders = new Headers();
  for (const [key, value] of upstream.headers.entries()) {
    const k = key.toLowerCase();
    if (
      HOP_BY_HOP.has(k) ||
      k === "content-length" ||
      k === "content-encoding" ||
      k === "set-cookie"
    ) {
      continue;
    }
    respHeaders.set(key, value);
  }
  /* چند set-cookie باید جدا حفظ شوند — getSetCookie همه را می‌دهد */
  for (const cookie of upstream.headers.getSetCookie()) {
    respHeaders.append("set-cookie", cookie);
  }

  /* بدنه کامل خوانده می‌شود (نه استریم) — استریم پاسخ بالا-دست در dev/پشت پراکسی
     ممکن است نیمه‌کته قطع شود و سمت مرورگر json() را بشکند (یافتهٔ دور ۱۴) */
  const buf = await upstream.arrayBuffer();
  /* 204/304 در constructor پاسخ با بدنهٔ غیر null مجاز نیست — بدون بدنه برمی‌گردیم
     (رفع 500 روی DELETEهای بدون محتوا — یافتهٔ دور ۱۴) */
  if (upstream.status === 204 || upstream.status === 304) {
    return new Response(null, { status: upstream.status, headers: respHeaders });
  }
  return new Response(buf, {
    status: upstream.status,
    headers: respHeaders,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
export const OPTIONS = proxy;
