"use client";
import { useEffect, useState } from "react";

export function useReaderFullscreen() {
  const [supported, setSupported] = useState(false);
  const [active, setActive] = useState(false);
  useEffect(() => {
    const sync = () => { setSupported(!!document.fullscreenEnabled && typeof document.documentElement.requestFullscreen === "function"); setActive(!!document.fullscreenElement); };
    const timer = setTimeout(sync, 0);
    document.addEventListener("fullscreenchange", sync);
    return () => { clearTimeout(timer); document.removeEventListener("fullscreenchange", sync); };
  }, []);
  const toggle = async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  };
  return { supported, active, toggle };
}
