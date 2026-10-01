import "server-only";

/**
 * احراز هویت مسیرهای BFF (§۷-الف) — هویت کاربر از نشست معتبر سامانهٔ Go گرفته می‌شود.
 * هیچ مسیر موازی یا دورزدن RBAC: کوکی کاربر به /auth/session سامانهٔ Go فوروارد
 * می‌شود و در نبود کاربر معتبر، همهٔ مسیرهای این لایه 401 می‌دهند.
 * همهٔ داده‌های خصوصی (هایلایت/اشتراک/PDF) با userUid همین نشست قید می‌شوند.
 */

/** د-۹: نشانی داخلی Go API — در compose با NOOR_API_INTERNAL_URL=http://api:8080 */
const UPSTREAM = process.env.NOOR_API_INTERNAL_URL ?? "http://127.0.0.1:8080";

export interface GoUser {
  uid: string;
  username: string;
  display_name: string;
  role: "admin" | "reader";
}

/** فراخوانی GET /auth/session سامانهٔ Go با کوکی‌های همان درخواست */
export async function resolveGoUser(cookieHeader: string | null): Promise<GoUser | null> {
  if (!cookieHeader) return null;
  try {
    const resp = await fetch(`${UPSTREAM}/api/v1/auth/session`, {
      headers: { cookie: cookieHeader, accept: "application/json" },
      cache: "no-store",
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { user?: GoUser | null };
    if (data.user && typeof data.user.uid === "string" && data.user.uid) return data.user;
    return null;
  } catch {
    return null;
  }
}

export function unauthorized(): Response {
  return Response.json(
    {
      error: {
        code: "unauthenticated",
        message: "برای این کار باید وارد حساب خود شوید.",
        trace_id: null,
        retryable: false,
      },
    },
    { status: 401 },
  );
}

/** درخواست همان‌مبدأ با کوکی کاربر به سامانهٔ Go — بدون هدرهای مبدأ (پل BFF) */
export async function goFetch(
  path: string,
  init: {
    method?: string;
    cookie: string | null;
    body?: unknown;
    signal?: AbortSignal;
    /** هدرهای سفارشی قرارداد (مثل X-Noor-CSRF / X-Noor-MFA) که باید عبور کنند */
    extraHeaders?: Record<string, string>;
  },
): Promise<Response> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  /* کوکی نشست کاربر باید صریحاً در هدر برود — وگرنه Go همه‌جا 401 می‌دهد */
  if (init.cookie) headers.cookie = init.cookie;
  Object.assign(headers, init.extraHeaders ?? {});
  return fetch(`${UPSTREAM}/api/v1${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
    signal: init.signal,
  });
}

/* ---------- ج-۷: پروکسی خالص برای دادهٔ خصوصی کاربر (هایلایت/اشتراک/PDF) ---------- */

/**
 * فوروارد شفاف درخواست به همان مسیر در سامانهٔ Go و بازگرداندن status/بدنه عیناً.
 * هیچ منطق دیتابیسی در Next نیست — مالک داده و همهٔ اعتبارسنجی‌ها Go است.
 * سپر CSRF سمت Go (X-Noor-CSRF) و step-up (X-Noor-MFA) عبور داده می‌شوند؛
 * Origin/Referer عمداً فوروارد نمی‌شود (همان قاعدهٔ پل BFF).
 */
export async function forwardToGo(
  req: Request,
  init: { cookie: string | null; body?: unknown },
): Promise<Response> {
  const url = new URL(req.url);
  const rel = `${url.pathname.replace(/^\/api\/v1/, "")}${url.search}`;
  const extraHeaders: Record<string, string> = {};
  for (const h of ["x-noor-csrf", "x-noor-mfa"] as const) {
    const v = req.headers.get(h);
    if (v) extraHeaders[h] = v;
  }
  const resp = await goFetch(rel, {
    method: req.method,
    cookie: init.cookie,
    body: init.body,
    extraHeaders,
  });
  const text = await resp.text();
  return new Response(text, {
    status: resp.status,
    headers: { "content-type": resp.headers.get("content-type") ?? "application/json" },
  });
}

/** خواندن امن بدنهٔ JSON — خرابی → {} تا Go خودش 400/422 قراردادی بدهد */
export async function readJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}
