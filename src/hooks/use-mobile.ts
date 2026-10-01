import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}

/** زیر نقطهٔ xl (<1280) — ستون زمینه در کتاب‌خوان مخفی است و پنل‌ها در Sheet می‌آیند.
 * توجه: محتوای Sheet/Dialog در body پرتال می‌شود و کلاس xl:hidden والد اثر ندارد؛
 * برای گیت‌کردن رندر شیت باید از این قلاب استفاده شود. */
export function useIsCompact() {
  const [isCompact, setIsCompact] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia("(max-width: 1279.98px)")
    const onChange = () => {
      setIsCompact(window.innerWidth < 1280)
    }
    mql.addEventListener("change", onChange)
    setIsCompact(window.innerWidth < 1280)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isCompact
}
