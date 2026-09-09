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
  const [expanded, setExpanded] = useState(false);
  const mounted = useRef(false);
  const busy = useRef(false);
  const setPhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    if (mounted.current) setPhaseState(next);
  }, []);

  const check = useCallback(
    async (manual = true) => {
      if (!isDesktop() || busy.current || ["downloaded", "ready", "available", "restarting"].includes(phaseRef.current))
        return;
      busy.current = true;
      setError("");
      setPhase("checking");
      if (manual) setExpanded(true);
      try {
        const next = await invoke<string | null>("check_app_update");
        if (!mounted.current) return;
        setVersion(next || "");
        setPhase(next ? "available" : "current");
        if (next) setExpanded(true);
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
    let live = true;
    let timer: number | undefined;
    if (isDesktop()) {
      void invoke<Info>("app_update_info")
        .then((next) => {
          if (!live) return;
          setInfo(next);
          if (next.supported && next.automatic) {
            void check(false);
            timer = window.setInterval(() => void check(false), 6 * 60 * 60 * 1000);
          }
        })
        .catch((error) => {
          if (live) setError(String(error));
        });
    }
    return () => {
      live = false;
      mounted.current = false;
      clearInterval(timer);
    };
  }, [check]);

  const download = async () => {
    if (busy.current || phaseRef.current !== "available") return;
    busy.current = true;
    setError("");
    setProgress({ received: 0, total: null });
    setPhase("downloading");
    const channel = new Channel<Progress>();
    channel.onmessage = (next) => {
      if (mounted.current) setProgress(next);
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
    expanded,
    setExpanded,
    check,
    download,
    restart,
    blocksTransfers: phase === "restarting" || phase === "ready",
  };
}

export type AppUpdates = ReturnType<typeof useAppUpdates>;
