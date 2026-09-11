import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowUpRight, Download, FolderOutput, ListFilter, Play, Power, RefreshCw, Square } from "lucide-react";
import { Select as SelectPrimitive } from "@base-ui/react/select";
import { summarizeTransfer, summarizeTransfers } from "@visuales/core/download/transfer-summary";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { IconButton } from "./icon-button";
import { useAppearance } from "./use-appearance";
import { isDesktop } from "./use-transfers";
import { formatBytes, isActive, type Task } from "./task-view";
import { selectTrayTasks, trayFilters, type TrayFilter } from "./tray-view";
import appIcon from "../app-icon.svg?no-inline";
import "./tray-popup.css";

type TaskAction = "open_output_folder" | "cancel_download_task" | "resume_download_task";

export function TrayPopup() {
  useAppearance();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [filter, setFilter] = useState<TrayFilter>("active");
  const [filterOpen, setFilterOpen] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [actionError, setActionError] = useState("");
  const [taskErrors, setTaskErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Set<string>>(new Set());
  const busy = useRef(new Set<string>());
  const forceRefresh = useRef(false);

  useEffect(() => {
    let disposed = false;
    let timer: number;
    const refresh = async () => {
      const stale = window.setTimeout(() => {
        if (!disposed) {
          setTasks(null);
          setError("Transfer status unavailable");
        }
      }, 8000);
      try {
        if (!isDesktop()) throw new Error("Open the desktop app to see transfers.");
        const force = forceRefresh.current;
        forceRefresh.current = false;
        const next = await invoke<Task[]>("list_download_tasks", { refresh: force });
        if (!disposed) {
          setTasks(next);
          setError("");
        }
      } catch {
        if (!disposed) {
          setTasks(null);
          setError("Transfer status unavailable");
        }
      } finally {
        window.clearTimeout(stale);
        if (!disposed) timer = window.setTimeout(() => void refresh(), 2000);
      }
    };
    void refresh();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [attempt]);

  useEffect(() => {
    const refreshOnFocus = () => {
      setTasks(null);
      setAttempt((value) => value + 1);
    };
    window.addEventListener("focus", refreshOnFocus);
    return () => window.removeEventListener("focus", refreshOnFocus);
  }, []);

  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      // Escape closes the status menu first, not the whole native popup.
      if (event.key === "Escape" && !event.defaultPrevented && !filterOpen && isDesktop()) {
        void invoke("dismiss_tray").catch(() => {});
      }
    };
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [filterOpen]);

  async function act(command: "open_downloads" | "quit_from_tray") {
    setActionError("");
    try {
      await invoke(command);
    } catch {
      setActionError(command === "open_downloads" ? "Could not open Downloads" : "Could not quit Visuales");
    }
  }

  async function taskAction(command: TaskAction, task: Task) {
    if (busy.current.has(task.id)) return;
    busy.current.add(task.id);
    setPending(new Set(busy.current));
    setTaskErrors((current) => ({ ...current, [task.id]: "" }));
    try {
      await invoke(command, command === "open_output_folder" ? { path: task.output } : { id: task.id });
    } catch (error) {
      setTaskErrors((current) => ({ ...current, [task.id]: String(error) }));
    } finally {
      busy.current.delete(task.id);
      setPending(new Set(busy.current));
      if (command !== "open_output_folder") {
        forceRefresh.current = true;
        setAttempt((value) => value + 1);
      }
    }
  }

  const summary = useMemo(() => tasks && summarizeTransfers(tasks), [tasks]);
  const visible = useMemo(() => selectTrayTasks(tasks ?? [], filter), [tasks, filter]);
  return (
    <main className="tray-popup" aria-label="Visuales transfers">
      <header className="tray-header">
        <h1>
          <img src={appIcon} alt="" />
          Visuales
        </h1>
        <div className="tray-header-actions">
          <Select
            items={trayFilters}
            value={filter}
            onValueChange={(value) => {
              if (value) setFilter(value);
            }}
            onOpenChange={setFilterOpen}
          >
            <SelectPrimitive.Trigger
              render={
                <IconButton
                  label="Transfer status"
                  tooltip="Filter transfers"
                  description={`Showing: ${trayFilters.find((item) => item.value === filter)?.label}`}
                  className="tray-filter"
                />
              }
            >
              <ListFilter size={17} />
              {filter !== "active" && <span className="tray-filter-indicator" aria-hidden="true" />}
            </SelectPrimitive.Trigger>
            <SelectContent
              className="tray-filter-options"
              align="end"
              alignItemWithTrigger={false}
              finalFocus={(interaction) => interaction === "keyboard"}
            >
              {trayFilters.map(({ value, label }) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <IconButton
            label="Open Downloads"
            description="Open the main Downloads view."
            onClick={() => void act("open_downloads")}
          >
            <ArrowUpRight size={17} />
          </IconButton>
        </div>
      </header>
      <div className="tray-transfers">
        {error ? (
          <div className="tray-empty">
            <span role="status">{error}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                forceRefresh.current = true;
                setAttempt((n) => n + 1);
              }}
            >
              <RefreshCw size={14} />
              Retry
            </Button>
          </div>
        ) : !tasks ? (
          <div className="tray-empty" role="status">
            <Spinner size={20} />
            <span>Loading transfers</span>
          </div>
        ) : !visible.length ? (
          <div className="tray-empty">
            <Download size={24} aria-hidden="true" />
            <span>{filter === "active" ? "No active transfers" : "No matching transfers"}</span>
          </div>
        ) : (
          visible.map((record) => {
            const task = summarizeTransfer(record);
            const updating = pending.has(task.id);
            return (
              <article className="tray-transfer" key={task.id} aria-label={task.name}>
                <div className="tray-transfer-heading">
                  <span className="tray-transfer-name">{task.name}</span>
                  <div className="tray-task-actions" aria-busy={updating}>
                    {task.status !== "running" && (
                      <span className={`tray-task-status ${task.status}`}>{task.status}</span>
                    )}
                    <IconButton
                      label={`Open output folder for ${task.name}`}
                      tooltip="Open download folder"
                      description="Show this transfer's destination in your file manager."
                      disabled={updating}
                      disabledReason="Wait for this task to finish updating."
                      onClick={() => void taskAction("open_output_folder", record)}
                    >
                      <FolderOutput size={15} />
                    </IconButton>
                    {updating ? (
                      <span className="tray-action-pending" role="status" aria-label={`Updating ${task.name}`}>
                        <Spinner size={15} />
                      </span>
                    ) : isActive(record) ? (
                      <IconButton
                        label={`Interrupt ${task.name}`}
                        tooltip={task.status === "queued" ? "Cancel queued download" : "Interrupt download"}
                        description={
                          task.status === "queued"
                            ? "Leave the queue. You can resume this task later."
                            : "Stop this transfer. Partial files are kept so you can resume later."
                        }
                        onClick={() => void taskAction("cancel_download_task", record)}
                      >
                        <Square size={14} />
                      </IconButton>
                    ) : ["interrupted", "failed"].includes(task.status) ? (
                      <IconButton
                        label={`Resume ${task.name}`}
                        tooltip="Resume download"
                        description="Continue this task using existing partial files where possible."
                        onClick={() => void taskAction("resume_download_task", record)}
                      >
                        <Play size={15} />
                      </IconButton>
                    ) : null}
                  </div>
                </div>
                {(task.progress !== null ||
                  task.totalFiles > 0 ||
                  task.status === "running" ||
                  (task.downloadedBytes ?? 0) > 0) && (
                  <div className="tray-transfer-detail">
                    <span>
                      {task.progress !== null && `${Math.floor(task.progress)}% · `}
                      {task.totalFiles > 0
                        ? `${task.completedFiles} of ${task.totalFiles} files`
                        : task.status === "running"
                          ? "Discovering files"
                          : ""}
                    </span>
                    {task.downloadedBytes !== null && (task.downloadedBytes > 0 || task.totalBytes !== null) && (
                      <span>
                        {task.totalBytes !== null
                          ? `${formatBytes(task.downloadedBytes)} / ${formatBytes(task.totalBytes)}`
                          : `${formatBytes(task.downloadedBytes)} downloaded`}
                      </span>
                    )}
                    {task.speedBytes !== null && <span>{formatBytes(task.speedBytes)}/s</span>}
                  </div>
                )}
                {task.progress !== null && (
                  <Progress aria-label={`Download progress for ${task.name}`} value={task.progress} />
                )}
                {(taskErrors[task.id] || record.lastError) && (
                  <p className="tray-task-error" role={taskErrors[task.id] ? "alert" : undefined}>
                    {taskErrors[task.id] || record.lastError}
                  </p>
                )}
              </article>
            );
          })
        )}
      </div>
      {actionError && (
        <p className="tray-error" role="alert">
          {actionError}
        </p>
      )}
      <footer className="tray-footer">
        <Button variant="ghost" size="sm" onClick={() => void act("quit_from_tray")}>
          <Power size={14} />
          Quit Visuales
        </Button>
        {summary?.speedBytes !== null && summary?.speedBytes !== undefined && (
          <span className="tray-total-speed" aria-label="Combined download speed">
            {formatBytes(summary.speedBytes)}/s
          </span>
        )}
      </footer>
    </main>
  );
}
