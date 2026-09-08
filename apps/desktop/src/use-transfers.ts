import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Task } from "./task-view";

export const isDesktop = () => "__TAURI_INTERNALS__" in window;

export function useTransfers(paused = false) {
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const [tasks, setTasks] = useState<Task[]>([]);
  const [connectionError, setConnectionError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const busy = useRef(new Set<string>());
  const mounted = useRef(false);
  const inFlight = useRef<Promise<void> | null>(null);
  const manualRefreshPending = useRef(false);

  const refresh = useCallback(async (force = false): Promise<void> => {
    if (!isDesktop() || pausedRef.current) return;
    if (inFlight.current) {
      await inFlight.current;
      if (!force) return;
    }
    if (!mounted.current || pausedRef.current) return;
    if (inFlight.current) return inFlight.current;
    const request = (async () => {
      try {
        const next = await invoke<Task[]>("list_download_tasks");
        if (mounted.current && !pausedRef.current) {
          setTasks(next);
          setConnectionError("");
        }
      } catch (error) {
        if (mounted.current && !pausedRef.current) setConnectionError(String(error));
      } finally {
        inFlight.current = null;
      }
    })();
    inFlight.current = request;
    return request;
  }, []);

  // Background synchronization must not toggle the manual refresh control.
  const refreshManually = async () => {
    if (!isDesktop() || !mounted.current || manualRefreshPending.current) return;
    manualRefreshPending.current = true;
    setRefreshing(true);
    try {
      await refresh(true);
    } finally {
      manualRefreshPending.current = false;
      if (mounted.current) setRefreshing(false);
    }
  };

  useEffect(() => {
    mounted.current = true;
    if (!isDesktop())
      return () => {
        mounted.current = false;
      };
    let stopped = false;
    let timer: number;
    const poll = async () => {
      await refresh();
      if (!stopped) timer = window.setTimeout(() => void poll(), 2000);
    };
    void poll();
    const unlisten = listen("tasks-changed", () => void refresh(true));
    void unlisten.catch((error) => {
      if (!stopped) setConnectionError(String(error));
    });
    return () => {
      stopped = true;
      mounted.current = false;
      clearTimeout(timer);
      void unlisten.then((stop) => stop()).catch(() => {});
    };
  }, [refresh]);

  const act = async (command: "resume_download_task" | "cancel_download_task" | "delete_download_task", id: string) => {
    if (busy.current.has(id)) return;
    busy.current.add(id);
    setPending(new Set(busy.current));
    try {
      await invoke(command, { id });
      await refresh(true);
    } finally {
      busy.current.delete(id);
      if (mounted.current) setPending(new Set(busy.current));
    }
  };

  return { tasks, refresh, refreshManually, refreshing, connectionError, pending, act };
}
