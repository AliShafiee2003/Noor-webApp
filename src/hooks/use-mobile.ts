import * as React from "react"

const MOBILE_BREAKPOINT = 780

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState(() =>
    typeof window === "undefined" ? false : window.innerWidth < MOBILE_BREAKPOINT
  )

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = (e: MediaQueryListEvent) => {
      setIsMobile(e.matches)
    }
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return isMobile
}

/** زیر نقطهٔ xl (<1280) — ستون زمینه در کتاب‌خوان مخفی است و پنل‌ها در Sheet می‌آیند.
 * توجه: محتوای Sheet/Dialog در body پرتال می‌شود و کلاس xl:hidden والد اثر ندارد؛
 * برای گیت‌کردن رندر شیت باید از این قلاب استفاده شود. */
export function useIsCompact() {
  const [isCompact, setIsCompact] = React.useState(() =>
    typeof window === "undefined" ? false : window.innerWidth < 1280
  )

  React.useEffect(() => {
    const mql = window.matchMedia("(max-width: 1279.98px)")
    const onChange = (e: MediaQueryListEvent) => {
      setIsCompact(e.matches)
    }
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return isCompact
}
