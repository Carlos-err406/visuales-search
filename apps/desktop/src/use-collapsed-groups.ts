import { useEffect, useMemo, useRef, useState } from "react";

type CollapsedGroups = Record<string, boolean>;

function readGroups(key: string): CollapsedGroups {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, collapsed]) => typeof collapsed === "boolean"));
  } catch {
    return {};
  }
}

export function useCollapsedGroups(key: string, defaults: CollapsedGroups = {}) {
  const [initialDefaults] = useState(defaults);
  const [preferences, setPreferences] = useState(() => readGroups(key));
  const current = useRef(preferences);
  const collapsed = useMemo(() => ({ ...initialDefaults, ...preferences }), [initialDefaults, preferences]);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== key && event.key !== null) return;
      current.current = readGroups(key);
      setPreferences(current.current);
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [key]);

  function setCollapsed(group: string, value: boolean) {
    // Persist only explicit choices, not contextual defaults or navigation overrides.
    const next = { ...current.current, [group]: value };
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // Keep the control usable when storage is unavailable.
    }
    current.current = next;
    setPreferences(next);
  }

  return { collapsed, setCollapsed };
}
