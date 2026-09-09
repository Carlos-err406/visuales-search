import { useCallback, useEffect, useRef, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { isDesktop } from "./use-transfers";

type Phase = "idle" | "checking" | "current" | "available" | "downloading" | "downloaded" | "restarting" | "ready";
type Info = { currentVersion: string; supported: boolean; reason: string | null; automatic: boolean };
type Progress = { received: number; total: number | null };

export function useAppUpdates() {
  const [info, setInfo] = useState<Info | null>(null);
  const [phase, setPhaseState] = useState<Phase>("idle");
  const phaseRef = useRef<Phase>("idle");
  const [version, setVersion] = useState("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<Progress>({ received: 0, total: null });
  const [dismissed, setDismissed] = useState(false);
  const [lastChecked, setLastChecked] = useState<number | null>(null);
  const mounted = useRef(false);
  const busy = useRef(false);
  const setPhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    if (mounted.current) setPhaseState(next);
  }, []);

  const check = useCallback(
    async (manual = true) => {
      if (!isDesktop() || busy.current || ["downloaded", "ready", "restarting"].includes(phaseRef.current)) return;
      // Keep the checked version stable until download; remind on the next scheduled check.
      if (phaseRef.current === "available") {
        if (!manual) setDismissed(false);
        return;
      }
      busy.current = true;
      setError("");
      setPhase("checking");
      try {
        const nextInfo = await invoke<Info>("app_update_info");
        if (!mounted.current) return;
        setInfo(nextInfo);
        if (!nextInfo.supported || (!manual && !nextInfo.automatic)) {
          setPhase("idle");
          return;
        }
        const next = await invoke<string | null>("check_app_update");
        if (!mounted.current) return;
        setVersion(next || "");
        setLastChecked(Date.now());
        setDismissed(false);
        setPhase(next ? "available" : "current");
      } catch (error) {
        if (mounted.current) {
          setError(String(error));
          setPhase("idle");
        }
      } finally {
        busy.current = false;
      }
    },
    [setPhase]
  );

  useEffect(() => {
    mounted.current = true;
    let timer: number | undefined;
    if (isDesktop()) {
      void check(false);
      timer = window.setInterval(() => void check(false), 6 * 60 * 60 * 1000);
    }
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [check]);

  const download = async () => {
    if (busy.current || phaseRef.current !== "available") return;
    busy.current = true;
    setDismissed(false);
    setError("");
    setProgress({ received: 0, total: null });
    setPhase("downloading");
    const channel = new Channel<Progress>();
    channel.onmessage = (next) => {
      if (mounted.current && phaseRef.current === "downloading") setProgress(next);
    };
    try {
      await invoke("download_app_update", { onProgress: channel });
      setPhase("downloaded");
    } catch (error) {
      if (mounted.current) setError(String(error));
      setPhase("available");
    } finally {
      busy.current = false;
    }
  };

  const restart = async () => {
    if (busy.current || !["downloaded", "ready"].includes(phaseRef.current)) return;
    let installed = phaseRef.current === "ready";
    busy.current = true;
    setError("");
    setPhase("restarting");
    try {
      if (!installed) {
        await invoke("install_app_update");
        installed = true;
      }
      await invoke("restart_after_update");
    } catch (error) {
      if (mounted.current) setError(String(error));
      // A failed relaunch can retry without replacing the app a second time.
      setPhase(installed ? "ready" : "downloaded");
    } finally {
      busy.current = false;
    }
  };

  return {
    info,
    phase,
    version,
    error,
    progress,
    lastChecked,
    noticeVisible:
      (phase === "available" && !dismissed) || ["downloading", "downloaded", "restarting", "ready"].includes(phase),
    dismiss: () => {
      if (phaseRef.current === "available") setDismissed(true);
    },
    check,
    download,
    restart,
    blocksTransfers: phase === "restarting" || phase === "ready",
  };
}

export type AppUpdates = ReturnType<typeof useAppUpdates>;
