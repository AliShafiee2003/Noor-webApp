/**
 * روتر سادهٔ hash-based — مسیر نسبی روی route «/» (محدودیت پیش‌نمایش سندباکس).
 * قالب: #/path?query — مثال: #/search?q=...&mode=normalized_phrase&scope=library
 * مقصدِ پس از ورود فقط در حافظهٔ ماژول نگه داشته می‌شود (نه localStorage).
 */
"use client";

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
  /** مسیر بدون # و بدون query — مثال: "/book/w-12" */
  path: string;
  segments: string[];
  query: Record<string, string>;
  /** کل hash شامل «#» — برای لینک‌دهی */
  fullHash: string;
}

const DEFAULT_PATH = "/home";

export function parseHash(raw: string | null | undefined): RouteInfo {
  let h = raw ?? "";
  if (typeof window !== "undefined" && h === "") h = window.location.hash;
  if (h.startsWith("#")) h = h.slice(1);
  if (!h || h === "/") h = DEFAULT_PATH;

  const qIndex = h.indexOf("?");
  const pathPart = qIndex >= 0 ? h.slice(0, qIndex) : h;
  const queryPart = qIndex >= 0 ? h.slice(qIndex + 1) : "";

  const normalized = pathPart.startsWith("/") ? pathPart : `/${pathPart}`;
  const segments = normalized.split("/").filter(Boolean).map(decodeURIComponent);

  const query: Record<string, string> = {};
  if (queryPart) {
    const sp = new URLSearchParams(queryPart);
    sp.forEach((value, key) => {
      query[key] = value;
    });
  }

  return {
    path: normalized,
    segments,
    query,
    fullHash: `#${normalized}${queryPart ? `?${queryPart}` : ""}`,
  };
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

/* ----- ساخت hash ----- */

export function buildHash(to: string, query?: RouteQuery): string {
  let hash = to.startsWith("#") ? to : `#${to.startsWith("/") ? to : `/${to}`}`;
  // اگر «to» خودش query دارد، جدا می‌کنیم
  const qIndex = hash.indexOf("?");
  let pathPart = qIndex >= 0 ? hash.slice(0, qIndex) : hash;
  const queryPart = qIndex >= 0 ? hash.slice(qIndex + 1) : "";
  if (pathPart === "#" || pathPart === "#/") pathPart = `#${DEFAULT_PATH}`;

  const sp = new URLSearchParams(queryPart);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") continue;
      sp.set(key, value);
    }
  }
  const qs = sp.toString();
  return `${pathPart}${qs ? `?${qs}` : ""}`;
}

/* ----- Context ----- */

interface RouterContextValue {
  route: RouteInfo;
  navigate: (to: string, query?: RouteQuery, opts?: { replace?: boolean }) => void;
  buildHref: (to: string, query?: RouteQuery) => string;
}

const RouterContext = createContext<RouterContextValue | null>(null);

export function HashRouterProvider({ children }: { children: React.ReactNode }) {
  const [route, setRoute] = useState<RouteInfo>(() => ({
    path: DEFAULT_PATH,
    segments: [DEFAULT_PATH.slice(1)],
    query: {},
    fullHash: `#${DEFAULT_PATH}`,
  }));

  useEffect(() => {
    const apply = () => setRoute(parseHash(window.location.hash));
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);

  // پرش به بالای صفحه در تغییر مسیر
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [route.path]);

  const navigate = useCallback(
    (to: string, query?: RouteQuery, opts?: { replace?: boolean }) => {
      const full = buildHash(to, query);
      if (opts?.replace) {
        window.history.replaceState(null, "", full);
        setRoute(parseHash(full));
      } else if (window.location.hash === full) {
        setRoute(parseHash(full));
      } else {
        window.location.hash = full;
      }
    },
    [],
  );

  const buildHref = useCallback((to: string, query?: RouteQuery) => {
    return buildHash(to, query);
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

/* ----- لینک hash با معنای صحیح anchor ----- */

export function HashLink({
  to,
  query,
  className,
  children,
  ariaLabel,
  ...rest
}: {
  to: string;
  query?: RouteQuery;
  className?: string;
  children: React.ReactNode;
  ariaLabel?: string;
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  const { buildHref } = useRoute();
  return (
    <a
      href={buildHref(to, query)}
      className={className}
      aria-label={ariaLabel}
      {...rest}
    >
      {children}
    </a>
  );
}
