import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { canonicalTreeUrl } from "@visuales/core/search-tree";
import type { LibraryEntry } from "@visuales/core/library-types";
import { messageForDisplay } from "@visuales/core/uri-display";

type Request = { loading?: boolean; error?: string };

export function useSearchDates(enabled: boolean) {
  const [listings, setListings] = useState<Record<string, LibraryEntry[]>>({});
  const [requests, setRequests] = useState<Record<string, Request>>({});
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const entries = useMemo(
    () =>
      new Map(
        Object.values(listings)
          .flat()
          .map((entry) => [canonicalTreeUrl(entry.encodedUrl), entry])
      ),
    [listings]
  );
  async function load(url: string) {
    if (!enabled || pending.current || requests[url]) return;
    pending.current = true;
    setRequests((current) => ({ ...current, [url]: { loading: true } }));
    try {
      const entries = await invoke<LibraryEntry[]>("list_library_directory", {
        url,
        refresh: false,
        requireDates: true,
      });
      if (mounted.current) {
        setListings((current) => ({ ...current, [url]: entries }));
        setRequests((current) => ({ ...current, [url]: {} }));
      }
    } catch (error) {
      if (mounted.current)
        setRequests((current) => ({ ...current, [url]: { error: messageForDisplay(String(error)) } }));
    } finally {
      pending.current = false;
    }
  }
  function retry() {
    setRequests((current) => Object.fromEntries(Object.entries(current).filter(([, request]) => !request.error)));
  }
  return {
    enabled,
    entries,
    requests,
    load,
    retry,
    loading: enabled && Object.values(requests).some((request) => request.loading),
    error: enabled ? Object.values(requests).find((request) => request.error)?.error : undefined,
  };
}
