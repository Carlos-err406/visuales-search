import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { SearchIndexAction, SearchIndexStatus } from "@visuales/core/search-index-types";
import { isDesktop } from "./use-transfers";

export function useSearchIndex() {
  const [status, setStatus] = useState<SearchIndexStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const acting = useRef(false);
  const revision = useRef(0);
  useEffect(() => {
    if (!isDesktop()) return;
    let stopped = false;
    let pending = false;
    async function refresh() {
      if (pending || acting.current) return;
      pending = true;
      const request = revision.current;
      try {
        const value = await invoke<SearchIndexStatus>("search_index_status");
        if (!stopped && request === revision.current && value?.revision) {
          setStatus(value);
          setError("");
        }
      } catch (reason) {
        if (!stopped && request === revision.current) setError(String(reason));
      } finally {
        pending = false;
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    const listener = listen("file-index-changed", () => void refresh());
    return () => {
      stopped = true;
      window.clearInterval(timer);
      void listener.then((stop) => stop()).catch(() => {});
    };
  }, []);
  async function control(action: SearchIndexAction) {
    if (!isDesktop() || acting.current) return;
    acting.current = true;
    revision.current++;
    setBusy(true);
    setError("");
    try {
      setStatus(await invoke<SearchIndexStatus>("search_index_control", { action }));
    } catch (reason) {
      setError(String(reason));
    } finally {
      acting.current = false;
      setBusy(false);
    }
  }
  return { status, error, busy, control };
}

export type SearchIndexController = ReturnType<typeof useSearchIndex>;
