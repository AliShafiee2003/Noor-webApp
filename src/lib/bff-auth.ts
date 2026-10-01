import "server-only";

/**
 * احراز هویت مسیرهای BFF (§۷-الف) — هویت کاربر از نشست معتبر سامانهٔ Go گرفته می‌شود.
 * هیچ مسیر موازی یا دورزدن RBAC: کوکی کاربر به /auth/session سامانهٔ Go فوروارد
 * می‌شود و در نبود کاربر معتبر، همهٔ مسیرهای این لایه 401 می‌دهند.
 * همهٔ داده‌های خصوصی (هایلایت/اشتراک/PDF) با userUid همین نشست قید می‌شوند.
 */

const UPSTREAM = "http://127.0.0.1:8080";

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
  },
): Promise<Response> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  /* کوکی نشست کاربر باید صریحاً در هدر برود — وگرنه Go همه‌جا 401 می‌دهد */
  if (init.cookie) headers.cookie = init.cookie;
  return fetch(`${UPSTREAM}/api/v1${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
    signal: init.signal,
  });
}
