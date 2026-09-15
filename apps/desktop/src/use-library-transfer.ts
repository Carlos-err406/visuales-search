import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { distinctDownloadUrls } from "@visuales/core/search-tree";
import { useDesktopSettings } from "./use-desktop-settings";

export function useLibraryTransfer() {
  const settings = useDesktopSettings();
  const busy = useRef(false);
  const [submitting, setSubmitting] = useState<"download" | "queue" | null>(null);
  const [submittingUrl, setSubmittingUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), 4000);
    return () => clearTimeout(timer);
  }, [message]);
  async function start(url: string | string[], queue: boolean) {
    if (busy.current) return false;
    busy.current = true;
    setSubmitting(queue ? "queue" : "download");
    setSubmittingUrl(typeof url === "string" ? url : null);
    setError("");
    setMessage("");
    try {
      // The host resolves the latest saved defaults and enforces update/quit gates.
      await invoke("start_download", {
        urls: distinctDownloadUrls(new Set(typeof url === "string" ? [url] : url)),
        queue,
      });
      setMessage(queue ? "Transfer added to queue" : "Transfer started");
      return true;
    } catch (reason) {
      setError(String(reason));
      return false;
    } finally {
      busy.current = false;
      setSubmitting(null);
      setSubmittingUrl(null);
    }
  }
  return {
    output: settings.snapshot?.settings.output ?? "",
    submitting,
    submittingUrl,
    error: error || settings.error,
    message,
    start,
  };
}
