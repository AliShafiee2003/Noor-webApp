/**
 * کلاینت تایپ‌دار API v1 — میزکار پژوهشی نور
 * همهٔ درخواست‌های شبکه از این ماژول عبور می‌کنند (fetch خام ممنوع).
 * - Base: /api/v1 — درخواست‌ها از پل BFF داخلی Next (src/app/api/v1) به سرویس Go می‌روند؛
 *   مبدأ همیشه هم‌مبدأ صفحه است و کنترل Origin سمت API به‌اشتباه فعال نمی‌شود.
 * - credentials: include (کوکی نشست)
 * - خطا همیشه به ApiError با {code,message,trace_id,retryable} نگاشت می‌شود.
 * - توکن CSRF فقط در حافظهٔ ماژول نگه داشته می‌شود.
 */
import type { ApiErrorCode } from "@/lib/types";

export const API_BASE = "/api/v1";
const CSRF_HEADER = "X-Noor-CSRF";

/**
 * نشانی فایل رسانه‌ای سند (pdf/image/audio) — برای src تگ‌های <img>/<audio> و
 * pdf.js. دانلود باینری از api.get عبور نمی‌کند (JSON-parse اجباری دارد)؛
 * کوکی نشست هم‌مبدأ همراه درخواست می‌رود و مسیر اختصاصی استریم Next (بدون بافر)
 * هدر Range را به سرویس Go می‌رساند.
 */
export function mediaFileUrl(docUid: string): string {
  return `${API_BASE}/documents/${encodeURIComponent(docUid)}/file`;
}

export type QueryParams = Record<
  string,
  string | number | boolean | null | undefined
>;

export class ApiError extends Error {
  readonly code: ApiErrorCode | string;
  readonly traceId: string | null;
  readonly retryable: boolean;
  readonly status: number;

  constructor(args: {
    code: ApiErrorCode | string;
    message: string;
    traceId?: string | null;
    retryable?: boolean;
    status?: number;
  }) {
    super(args.message);
    this.name = "ApiError";
    this.code = args.code;
    this.traceId = args.traceId ?? null;
    this.retryable = args.retryable ?? false;
    this.status = args.status ?? 0;
  }
}

const NETWORK_ERROR_MESSAGE =
  "ارتباط با سرور برقرار نشد؛ اتصال خود را بررسی کنید و دوباره تلاش کنید.";
const TIMEOUT_ERROR_MESSAGE =
  "پاسخ سرور بیش از حد طول کشید؛ کمی بعد دوباره تلاش کنید.";
const BAD_RESPONSE_MESSAGE =
  "پاسخ نامعتبری از سرور دریافت شد؛ دوباره تلاش کنید. اگر تکرار شد با مدیر سامانه در تماس باشید.";

/** مهلت پیش‌فرض هر درخواست — دانلود فایل از مسیر api عبور نمی‌کند (href/open). */
const DEFAULT_TIMEOUT_MS = 15_000;

/* ---------- CSRF (فقط حافظه) ---------- */

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export function getCsrfToken(): string | null {
  return csrfToken;
}

/* ---------- ساخت نشانی ---------- */

/** نشانی کامل API؛ همهٔ درخواست‌ها مسیر نسبی و هم‌مبدأ دارند. */
export function apiUrl(path: string, params?: QueryParams): string {
  const qs = new URLSearchParams();
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === "") continue;
      qs.set(key, String(value));
    }
  }
  const query = qs.toString();
  return query ? `${API_BASE}${path}?${query}` : `${API_BASE}${path}`;
}

/* ---------- درخواست پایه ---------- */

export interface RequestOptions {
  path: string;
  params?: QueryParams;
  body?: unknown;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  signal?: AbortSignal;
}

async function parseErrorBody(
  response: Response,
): Promise<{ code: string; message: string; traceId: string | null; retryable: boolean } | null> {
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    /* بدنهٔ غیر JSON */
  }
  const err =
    payload && typeof payload === "object" && "error" in payload
      ? (payload as { error: Record<string, unknown> }).error
      : null;
  if (err && typeof err.message === "string") {
    return {
      code: typeof err.code === "string" ? err.code : "internal",
      message: err.message,
      traceId: typeof err.trace_id === "string" ? err.trace_id : null,
      retryable: err.retryable === true,
    };
  }
  return null;
}

function fallbackError(response: Response): ApiError {
  const fallbackByStatus: Record<number, string> = {
    401: "نشست شما معتبر نیست؛ دوباره وارد شوید.",
    403: "اجازهٔ انجام این کار را ندارید.",
    404: "مورد درخواستی یافت نشد.",
    429: "تعداد درخواست‌ها بیش از حد مجاز است؛ کمی بعد دوباره تلاش کنید.",
    503: "سامانه موقتاً در دسترس نیست؛ کمی بعد دوباره تلاش کنید.",
  };

  return new ApiError({
    code: "internal",
    message:
      fallbackByStatus[response.status] ??
      "پاسخ نامعتبری از سرور دریافت شد؛ دوباره تلاش کنید.",
    retryable: response.status >= 500 || response.status === 429,
    status: response.status,
  });
}

/** مسیرهای احراز هویت که 401 آن‌ها رویداد سراسری نشست را روشن نمی‌کند */
const AUTH_PATHS_401_SILENT = /^\/auth\/(login|session|logout|accept-invite|mfa\/verify|mfa\/setup|mfa\/enable)$/;

async function execute<T>(options: RequestOptions, csrf: string | null): Promise<T> {
  const { path, params, body, method = "GET", signal } = options;

  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const isMutation = method !== "GET";
  if (isMutation && csrf) headers[CSRF_HEADER] = csrf;

  /* ترکیب مهلت پیش‌فرض با signal صادرکننده — لغو خود caller حفظ می‌شود */
  const timeoutSignal = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
  const abort = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  let response: Response;
  try {
    response = await fetch(apiUrl(path, params), {
      method,
      headers,
      credentials: "include",
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: abort,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new ApiError({
        code: "timeout",
        message: TIMEOUT_ERROR_MESSAGE,
        retryable: true,
        status: 0,
      });
    }
    throw new ApiError({
      code: "unavailable",
      message: NETWORK_ERROR_MESSAGE,
      retryable: true,
      status: 0,
    });
  }

  if (!response.ok) {
    /* خودترمیمی CSRF: توکن فقط در حافظه است و در بازخوانی کامل صفحه/HMR
       ممکن است هنوز نیامده یا پاک شده باشد. در این حالت یک‌بار نشست را
       می‌پرسیم (تازه‌ترین توکن) و همان درخواست را تکرار می‌کنیم — بدون
       حلقهٔ بی‌پایان و بدون از دست رفتن کاربر (§۴۱).
       خطای تلاشِ دوباره عیناً برگردانده می‌شود نه پیام جایگزینِ 403 اولی
       (رفع پیام گمراه‌کنندهٔ «پاسخ نامعتبری…» در موفقیتِ واقعی — دور ۱۴). */
    const parsed = await parseErrorBody(response);
    if (response.status === 403 && parsed?.code === "csrf" && isMutation && !csrf) {
      const session = await fetch(apiUrl("/auth/session"), {
        headers: { Accept: "application/json" },
        credentials: "include",
      }).catch(() => null);
      if (session && session.ok) {
        const data = (await session.json().catch(() => null)) as { csrf?: unknown } | null;
        if (data && typeof data.csrf === "string" && data.csrf) {
          setCsrfToken(data.csrf);
          return execute<T>(options, data.csrf);
        }
      }
    }
    /* نشست باطل‌شده/منقضی: رویداد سراسری برای بازگشت لطیف به صفحهٔ ورود
       (به‌جای پوستهٔ مردهٔ «احراز‌شده» که همهٔ درخواست‌هایش 401 می‌خورد). */
    if (
      response.status === 401 &&
      typeof window !== "undefined" &&
      !AUTH_PATHS_401_SILENT.test(path)
    ) {
      window.dispatchEvent(new CustomEvent("noor:unauthorized"));
    }
    if (parsed) {
      throw new ApiError({ ...parsed, status: response.status });
    }
    throw fallbackError(response);
  }

  if (response.status === 204 || response.status === 205) return undefined as T;
  const contentLength = response.headers.get("content-length");
  if (contentLength === "0") return undefined as T;

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new ApiError({
      code: "internal",
      message: BAD_RESPONSE_MESSAGE,
      retryable: true,
      status: response.status,
    });
  }
  return data as T;
}

async function request<T>(options: RequestOptions): Promise<T> {
  const { method = "GET" } = options;
  return execute<T>(options, method === "GET" ? null : csrfToken);
}

/* ---------- توابع عمومی ---------- */

export const api = {
  get<T>(path: string, params?: QueryParams, signal?: AbortSignal): Promise<T> {
    return request<T>({ path, params, method: "GET", signal });
  },
  post<T>(path: string, body?: unknown, params?: QueryParams, signal?: AbortSignal): Promise<T> {
    return request<T>({ path, body, params, signal, method: "POST" });
  },
  put<T>(path: string, body?: unknown, params?: QueryParams): Promise<T> {
    return request<T>({ path, body, params, method: "PUT" });
  },
  patch<T>(path: string, body?: unknown, params?: QueryParams): Promise<T> {
    return request<T>({ path, body, params, method: "PATCH" });
  },
  del<T>(path: string, params?: QueryParams): Promise<T> {
    return request<T>({ path, params, method: "DELETE" });
  },
};

/** پیام فارسی هر خطا — برای نمایش یکدست در رابط */
export function errorMessage(err: unknown, fallback?: string): string {
  if (err instanceof ApiError) return err.message;
  return fallback ?? NETWORK_ERROR_MESSAGE;
}
