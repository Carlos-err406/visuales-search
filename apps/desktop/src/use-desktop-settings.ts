import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { downloadDefaults } from "@visuales/core/download/defaults";
import type { DesktopSettings, DesktopSettingsSnapshot } from "@visuales/core/desktop-settings-types";
import { isDesktop } from "./use-transfers";

const previewDefaults: DesktopSettings = {
  output: "~/Downloads/Visuales",
  concurrent: downloadDefaults.concurrent,
  connections: downloadDefaults.connections,
  maxRetries: downloadDefaults.maxRetries,
  exclude: [],
};

export function useDesktopSettings() {
  const [snapshot, setSnapshot] = useState<DesktopSettingsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const request = isDesktop()
      ? invoke<DesktopSettingsSnapshot>("get_desktop_settings")
      : Promise.resolve({ settings: previewDefaults, defaults: previewDefaults });
    void request
      .then((next) => {
        if (active) setSnapshot(next);
      })
      .catch((error) => {
        if (active) setError(String(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  async function save(settings: DesktopSettings) {
    if (!isDesktop()) throw new Error("Open the desktop app to save settings.");
    if (busy.current) throw new Error("Settings are already being saved.");
    busy.current = true;
    setSaving(true);
    try {
      const next = await invoke<DesktopSettingsSnapshot>("save_desktop_settings", { settings });
      setSnapshot(next);
      return next;
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  return { snapshot, loading, error, saving, save, reload: () => setAttempt((value) => value + 1) };
}
