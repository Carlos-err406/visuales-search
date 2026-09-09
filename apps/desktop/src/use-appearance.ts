import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { setTheme } from "@tauri-apps/api/app";
import { isDesktop } from "./use-transfers";

export type Appearance = "system" | "light" | "dark";
const storageKey = "visuales.appearance";
const parseAppearance = (value: unknown): Appearance => (value === "light" || value === "dark" ? value : "system");

export function useAppearance() {
  const [appearance, setAppearance] = useState<Appearance>(() =>
    parseAppearance(document.documentElement.dataset.appearance)
  );
  const [storageError, setStorageError] = useState("");
  const [nativeError, setNativeError] = useState("");
  const nativeSync = useRef(Promise.resolve());

  useLayoutEffect(() => {
    const system = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.appearance = appearance;
      document.documentElement.classList.toggle(
        "dark",
        appearance === "dark" || (appearance === "system" && system.matches)
      );
    };
    apply();
    system.addEventListener("change", apply);
    return () => system.removeEventListener("change", apply);
  }, [appearance]);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) {
        setAppearance(parseAppearance(event.newValue));
        setStorageError("");
      }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  useEffect(() => {
    if (!isDesktop()) return;
    let active = true;
    setNativeError("");
    // Serialize native changes so a slow earlier request cannot override the latest choice.
    nativeSync.current = nativeSync.current
      .then(async () => {
        if (active) await setTheme(appearance === "system" ? null : appearance);
      })
      .catch(() => {
        if (active) setNativeError("Could not update the native window appearance. Choose another theme to retry.");
      });
    return () => {
      active = false;
    };
  }, [appearance]);

  function choose(value: Appearance) {
    setStorageError("");
    try {
      localStorage.setItem(storageKey, value);
    } catch {
      setStorageError("Could not save appearance. This choice applies only until the app closes.");
    }
    setAppearance(value);
  }

  return { appearance, choose, error: [storageError, nativeError].filter(Boolean).join(" ") };
}

export type AppearanceController = ReturnType<typeof useAppearance>;
