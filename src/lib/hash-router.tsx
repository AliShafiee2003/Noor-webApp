/**
 * فاز ۲ (دور ۱۸-فیکس ۱۲) — روتر مسیر واقعی (بدون hash).
 *
 * تصمیم کاربر: ساختارِ لینک انگلیسی (library/read)، فقط نام کتاب فارسی، و
 * معنادار. hash را مرورگر هرگز کدگشا نشان نمی‌دهد (%D8…)، پس حذف کامل شد و
 * نشانی‌ها فقط در path+query می‌نشینند:
 *   - خانه:            /
 *   - کتابخانه:        /library
 *   - اطلاعات اثر:     /library/{نام-کتاب}?w={uid}
 *   - مطالعه:          /library/{نام-کتاب}/read?d={docUid}&pg=16
 *   - بقیهٔ بخش‌ها:     /head[/seg]?query عیناً (search، topics، …)
 *
 * «route» داخلی همان قرارداد قدیمی می‌ماند (headهای book/read/…) تا همهٔ
 * viewها بی‌تغییر کار کنند؛ فقط نگاشت نشانی↔روت این‌جاست. uid همیشه در query
 * سفر می‌کند (p؛ w برای اثر و d برای سند) و slug صرفاً نمایشی است و هرگز
 * اعتبارسنجی نمی‌شود؛ دو اثر با نام یکسان هم با query تفکیک می‌شوند.
 * قالب‌های قدیمی (#/book/…، #/read/{slug}/{uid}، لینک‌های سروریِ اشتراک) در
 * ورود یک‌بار به قالب جدید ترجمه و با replaceState بازآر می‌شوند.
 * مقصدِ پس از ورود فقط در حافظهٔ ماژول نگه داشته می‌شود (نه localStorage).
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type RouteQuery = Record<string, string | undefined | null>;

export interface RouteInfo {
  /** مسیر روت — مثال: "/book/w-12" (headهای app-shell همان قرارداد قدیمی) */
  path: string;
  segments: string[];
  query: Record<string, string>;
  /** نشانی کامل فعال (pathname+search، بدون origin) — برای key و مقصد ورود */
  fullHash: string;
}

const DEFAULT_PATH = "/home";

/** سگمنت بی‌نام وقتی نام اثر هنوز در دسترس نیست (اثرِ هویت مسیر نام را می‌نویسد) */
const UNNAMED = "book";

/* ---------- کدگشایی/ترجمهٔ pg ---------- */

/** pg پایدار ریدر: «p-016» → «16» (فقط نمایش؛ برابری با pg غیرعددی p-front هم رد می‌شود) */
export function pgTerm(value: string): string {
  const m = /^p-(\d+)$/.exec(value);
  return m ? String(Number.parseInt(value.slice(2), 10)) : value;
}

/* ---------- پارس: نشانی → روت ---------- */

export function parseHash(raw: string | null | undefined): RouteInfo {
  let p = raw ?? "";
  if (typeof window !== "undefined" && (p === "" || p === "#")) {
    p = window.location.pathname + window.location.search;
  }
  // ورودی تنها-hash (قالب قدیمی #/read/…) — بدنهٔ hash همان مسیر است
  if (p.startsWith("#")) p = p.slice(1) || window.location.pathname + window.location.search;

  const qIndex = p.indexOf("?");
  const pathPart = qIndex >= 0 ? p.slice(0, qIndex) : p;
  const queryPart = qIndex >= 0 ? p.slice(qIndex + 1) : "";

  const normalized = pathPart === "" || pathPart === "/" ? "/" : pathPart.startsWith("/") ? pathPart : `/${pathPart}`;
  const segments = normalized.split("/").filter(Boolean).map(decodeSegment);

  const query: Record<string, string> = {};
  if (queryPart) {
    new URLSearchParams(queryPart).forEach((value, key) => {
      query[key] = value;
    });
  }
  return routeFromSegments(normalized, segments, query);
}

/** کدگشایی امن سگمنت (%23 فیکس‌های پیشین، %D8 فارسی، …) */
function decodeSegment(seg: string): string {
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

/** نگاشت قالب معنایی /library/… به روت داخلی (فقط دو head of book و read) */
function routeFromSegments(
  normalized: string,
  segments: string[],
  query: Record<string, string>,
): RouteInfo {
  if (segments[0] === "library" && segments.length > 1) {
    if (segments[segments.length - 1] === "read") {
      const doc = query.d ?? "";
      return {
        path: `/read/${doc}`,
        segments: ["read", doc],
        query,
        fullHash: fullOf(normalized, query),
      };
    }
    const uid = query.w ?? "";
    if (uid) {
      return {
        path: `/book/${uid}`,
        segments: ["book", uid],
        query,
        fullHash: fullOf(normalized, query),
      };
    }
    // /library/{slug?} بدون w → فهرست کتابخانه (برش دستیِ کاربر چیزی نشکند)
    return {
      path: "/library",
      segments: ["library"],
      query,
      fullHash: fullOf(normalized, query),
    };
  }
  return { path: normalized, segments, query, fullHash: fullOf(normalized, query) };
}

/** fullHash = نشانی کانونی: مسیر + query بازسازی‌شده */
function fullOf(normalizedPath: string, query: Record<string, string>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) sp.set(k, v);
  const qs = sp.toString();
  return qs ? `${normalizedPath}?${qs}` : normalizedPath;
}

/* ---------- روت → نشانی ---------- */

/** سگمنت امن مسیر از نام اثر — همان قوانین slugifyFa (بدون براکت/نقطه‌گذاری) */
function safeSlugSegment(raw: string): string {
  // همان قوانین slugifyFa — اینجا inline شده تا چرخهٔ import با href.ts ساخته نشود
  const s = raw
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    .replace(/[\u200c\u200d\u200e\u200f]/g, "-")
    .replace(/[\[\]{}()（）«»"'’‘“”\"…،؛:.,\/\\|?!؟&$%+=~<>@^*#_-]+/g, "-")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return s || raw
    .replace(/[\s%#/\\?&@+]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

/** روت → نشانی سرراست: د و w از self سگمنت‌ها؛ pg عددی؛ slug نمایشی اختیاری */
function routeToUrl(path: string, query: Record<string, string>, slug?: string | null): string {
  const seg = path.split("/").filter(Boolean);
  const head = seg[0] ?? "";
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    sp.set(key, key === "pg" ? pgTerm(value) : value);
  }
  const identitySeg = slug ? safeSlugSegment(slug) : "";
  let urlPath: string;
  if (head === "book" && seg[1]) {
    sp.set("w", decodeURIComponent(seg[1]));
    urlPath = `/library/${identitySeg || UNNAMED}`;
  } else if (head === "read") {
    // قالب قدیمی نام‌دار #/read/{slug}/{d-uid} هم همین‌جا نرمال می‌شود؛
    // uid همیشه سگمنتی است که با «d-» آغاز می‌شود (نام اسلگ هرگز uid نیست).
    const rawDoc = seg[1]?.startsWith("d-") ? seg[1] : seg[2]?.startsWith("d-") ? seg[2] : "";
    const doc = rawDoc ? decodeURIComponent(rawDoc) : "";
    if (doc) sp.set("d", doc);
    if (identitySeg) {
      urlPath = `/library/${identitySeg}/read`;
    } else if (!seg[1]?.startsWith("d-") && seg[1]) {
      // قالب قدیمی نام‌دار بدون slug صریح — بهرهمند از خودِ سگمنت به‌عنوان نام
      urlPath = `/library/${safeSlugSegment(decodeURIComponent(seg[1]))}/read`;
    } else {
      urlPath = `/library/${UNNAMED}/read`;
    }
  } else {
    urlPath = path || "/";
  }
  const qs = sp.toString();
  return `${urlPath}${qs ? `?${qs}` : ""}`;
}

/* ---------- روت از رشتهٔ «to» (فرم روت، فرم نشانی، یا قالب قدیمی) ---------- */

function routeFor(to: string, query?: RouteQuery): RouteInfo {
  let p = to.startsWith("#") ? to.slice(1) : to;
  if (!p.startsWith("/")) p = `/${p}`;
  const qIndex = p.indexOf("?");
  const pathPart = qIndex >= 0 ? p.slice(0, qIndex) : p;
  const queryPart = qIndex >= 0 ? p.slice(qIndex + 1) : "";
  const segments = pathPart.split("/").filter(Boolean).map(decodeSegment);
  const outQuery: Record<string, string> = {};
  if (queryPart) {
    new URLSearchParams(queryPart).forEach((value, key) => {
      outQuery[key] = value;
    });
  }
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") continue;
      outQuery[key] = value;
    }
  }
  // ورودیِ /library/… معنایی نشانی است (w/d را از query می‌خواند)
  // بقیه فرم روت — عین segments میرود به route
  const norm = pathPart === "" || pathPart === "/" ? "/" : pathPart;
  return routeFromSegments(norm, segments, outQuery);
}

/* ----- مقصد پس از ورود (فقط حافظهٔ ماژول) ----- */

let pendingDestination: string | null = null;

export function setPendingDestination(dest: string): void {
  pendingDestination = dest;
}

export function consumePendingDestination(): string | null {
  const dest = pendingDestination;
  pendingDestination = null;
  return dest;
}

/* ----- ساخت نشانی برای لینک‌ها ----- */

export function buildHash(to: string, query?: RouteQuery, slug?: string | null): string {
  const r = routeFor(to, query);
  return routeToUrl(r.path, r.query, slug);
}

/* ----- Context ----- */

interface RouterContextValue {
  route: RouteInfo;
  navigate: (to: string, query?: RouteQuery, opts?: { replace?: boolean; slug?: string | null }) => void;
  buildHref: (to: string, query?: RouteQuery, slug?: string | null) => string;
}

const RouterContext = createContext<RouterContextValue | null>(null);

export function HashRouterProvider({ children }: { children: React.ReactNode }) {
  const [route, setRoute] = useState<RouteInfo>(() => ({
    path: DEFAULT_PATH,
    segments: [DEFAULT_PATH.slice(1)],
    query: {},
    fullHash: DEFAULT_PATH,
  }));

  useEffect(() => {
    /* فاز ۲: قالب‌های قدیمی (#/read/…، #/book/…) یک‌بار ترجمه می‌شوند تا
       نشانی تمیز بماند؛ پس از آن همیشه از pathname خوانده می‌شود. */
    if (typeof window !== "undefined" && window.location.hash.startsWith("#")) {
      const target = routeFor(window.location.hash);
      window.history.replaceState(null, "", routeToUrl(target.path, target.query, null));
    }
    const apply = () =>
      setRoute(parseHash(`${window.location.pathname}${window.location.search}`));
    apply();
    window.addEventListener("popstate", apply);
    return () => window.removeEventListener("popstate", apply);
  }, []);

  // پرش به بالای صفحه در تغییر مسیر
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [route.path]);

  const navigate = useCallback(
    (to: string, query?: RouteQuery, opts?: { replace?: boolean; slug?: string | null }) => {
      const url = buildHash(to, query, opts?.slug);
      const current = window.location.pathname + window.location.search;
      if (opts?.replace) {
        window.history.replaceState(null, "", url);
      } else if (url !== current) {
        window.history.pushState(null, "", url);
      }
      /* پس از pushState رویداد popstate نمی‌آید — روت را مستقیم تازه می‌کنیم */
      setRoute(parseHash(`${window.location.pathname}${window.location.search}`));
    },
    [],
  );

  const buildHref = useCallback((to: string, query?: RouteQuery, slug?: string | null) => {
    return buildHash(to, query, slug);
  }, []);

  const value = useMemo(
    () => ({ route, navigate, buildHref }),
    [route, navigate, buildHref],
  );

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRoute(): RouterContextValue {
  const ctx = useContext(RouterContext);
  if (!ctx) {
    throw new Error("useRoute باید داخل HashRouterProvider استفاده شود.");
  }
  return ctx;
}

/**
 * لینکِ درونی SPA — نشانی واقعی؛ کلیکِ ساده روتر را طی می‌کند
 * (بدون بازآری صفحهٔ کامل). بازکردن با کلید/میان‌بر/راست-کلیک به
 * مرورگر سپرده می‌شود (tooltip و لینک‌پذیری حفظ).
 */
export function HashLink({
  to,
  query,
  slug,
  className,
  children,
  ariaLabel,
  ...rest
}: {
  to: string;
  query?: RouteQuery;
  /** نام اثر برای نشانی معنادار بلافاصله (اگر در دسترس باشد) */
  slug?: string | null;
  className?: string;
  children: React.ReactNode;
  ariaLabel?: string;
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  const { buildHref, navigate } = useRoute();
  const href = buildHref(to, query, slug);
  const onClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    rest.onClick?.(event);
    if (event.defaultPrevented) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to, query, { slug });
  };
  return (
    <a href={href} className={className} aria-label={ariaLabel} {...rest} onClick={onClick}>
      {children}
    </a>
  );
}
