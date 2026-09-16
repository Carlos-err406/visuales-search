import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AlertCircle,
  Check,
  ChevronRight,
  File,
  FolderOutput,
  ListPlus,
  Play,
  RefreshCw,
  Square,
  X,
} from "lucide-react";
import type { DownloadFileDetail, DownloadFileDetails } from "@visuales/core/download/file-details";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { IconButton } from "./icon-button";
import { formatBytes, isActive, taskName, taskProgress, taskSize, taskSpeed, type Task } from "./task-view";
import type { TransferCommand } from "./use-transfers";
import { hasOpenOverlay } from "./overlay-state";

const WIDTH_KEY = "visuales.transfer-inspector-width";
const MIN_WIDTH = 320;
const MAX_WIDTH = 680;
const clampWidth = (width: number) => Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width));

function savedWidth() {
  try {
    const value = Number(localStorage.getItem(WIDTH_KEY));
    return value > 0 && Number.isFinite(value) ? clampWidth(value) : 460;
  } catch {
    return 460;
  }
}

function fileStatus(file: DownloadFileDetail, task: Task) {
  if (file.status === "completed" && file.verified === false) return "Unverified";
  if (file.status === "downloading" && task.status !== "running") return "Interrupted";
  return file.status[0].toUpperCase() + file.status.slice(1);
}

function fileTelemetry(file: DownloadFileDetail, task: Task): string[] {
  if (file.status !== "downloading" || task.status !== "running") return [];
  const now = Date.now();
  const fresh = (time?: number) => time !== undefined && now >= time && now - time <= 10000;
  if (fresh(file.progressUpdatedAt)) {
    const parts = file.speedBytes === undefined ? [] : [`${formatBytes(file.speedBytes)}/s`];
    if (file.connections) {
      const { active, chunksCompleted, chunksTotal } = file.connections;
      parts.push(`${active} ${active === 1 ? "connection" : "connections"}`);
      if (chunksCompleted !== undefined && chunksTotal !== undefined)
        parts.push(`${chunksCompleted}/${chunksTotal} chunks`);
    }
    if (parts.length) return parts;
  }
  // Workers started before detailed telemetry still publish per-file speeds in task summaries.
  const overall = task.overallProgress;
  const speed = fresh(overall?.updatedAt)
    ? overall?.activeFiles?.find((active) => active.url === file.url)?.speed
    : undefined;
  if (speed) return [speed];
  const last = task.lastProgress;
  return fresh(last?.updatedAt) && last?.url === file.url && last.speed ? [last.speed] : [];
}

function FileList({
  files,
  task,
  retryDisabled,
  onRetry,
}: {
  files: DownloadFileDetail[];
  task: Task;
  retryDisabled: boolean;
  onRetry: (paths?: string[]) => void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ finished: task.status !== "completed" });
  const rows = useMemo(() => {
    const groups = [
      { id: "downloading", label: "Downloading", files: [] as DownloadFileDetail[] },
      { id: "pending", label: "Pending", files: [] as DownloadFileDetail[] },
      { id: "attention", label: "Needs attention", files: [] as DownloadFileDetail[] },
      { id: "finished", label: "Finished", files: [] as DownloadFileDetail[] },
    ];
    for (const file of files) {
      const status = fileStatus(file, task);
      const group = status === "Downloading" ? 0 : status === "Waiting" ? 1 : status === "Completed" ? 3 : 2;
      groups[group].files.push(file);
    }
    type Row = { key: string } & (
      | { kind: "group"; id: string; label: string; count: number }
      | { kind: "file"; file: DownloadFileDetail }
    );
    const result: Row[] = [];
    for (const group of groups) {
      if (!group.files.length) continue;
      result.push({
        kind: "group",
        key: `group:${group.id}`,
        id: group.id,
        label: group.label,
        count: group.files.length,
      });
      if (!collapsed[group.id])
        for (const file of group.files) {
          result.push({ kind: "file", key: `file:${file.url}\n${file.path}`, file });
        }
    }
    return result;
  }, [files, task.status, collapsed]);
  const list = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroll.current,
    estimateSize: (index) => (rows[index].kind === "group" ? 38 : 76),
    getItemKey: (index) => rows[index].key,
    overscan: 6,
  });
  return (
    <div className="inspector-files" ref={scroll} tabIndex={0} aria-label="Transfer files">
      <ul style={{ height: list.getTotalSize(), position: "relative" }}>
        {list.getVirtualItems().map((item) => {
          const row = rows[item.index];
          if (row.kind === "group")
            return (
              <li
                key={item.key}
                ref={list.measureElement}
                data-index={item.index}
                className="inspector-file-group"
                style={{ position: "absolute", width: "100%", transform: `translateY(${item.start}px)` }}
              >
                <Button
                  variant="ghost"
                  aria-label={`${row.label} files (${row.count})`}
                  aria-expanded={!collapsed[row.id]}
                  onClick={() => setCollapsed((current) => ({ ...current, [row.id]: !current[row.id] }))}
                >
                  <ChevronRight size={14} className={collapsed[row.id] ? "" : "group-expanded"} aria-hidden="true" />
                  <span>{row.label}</span>
                  <span className="secondary">{row.count}</span>
                </Button>
              </li>
            );
          const file = row.file;
          const status = fileStatus(file, task);
          const active = status === "Downloading";
          const telemetry = fileTelemetry(file, task);
          const percent = file.totalBytes ? Math.min(100, (file.downloadedBytes / file.totalBytes) * 100) : null;
          return (
            <li
              key={item.key}
              ref={list.measureElement}
              data-index={item.index}
              aria-posinset={item.index + 1}
              aria-setsize={rows.length}
              className={`inspector-file ${status.toLowerCase()}`}
              style={{ position: "absolute", width: "100%", transform: `translateY(${item.start}px)` }}
            >
              <div className="inspector-file-name">
                {status === "Completed" ? (
                  <Check size={15} />
                ) : status === "Failed" || status === "Unverified" ? (
                  <AlertCircle size={15} />
                ) : active ? (
                  <Spinner size={15} />
                ) : (
                  <File size={15} />
                )}
                <span>{file.path}</span>
                {file.status === "failed" && (
                  <IconButton
                    label={`Retry ${file.path}`}
                    description={
                      isActive(task)
                        ? "Available when this transfer stops."
                        : "Retry only this file, keeping partial data."
                    }
                    disabled={retryDisabled}
                    onClick={() => onRetry([file.path])}
                  >
                    <RefreshCw size={15} />
                  </IconButton>
                )}
              </div>
              <div className="inspector-file-meta">
                <span>{status}</span>
                <span>
                  {formatBytes(file.downloadedBytes)} /{" "}
                  {file.totalBytes === null
                    ? "Unknown size"
                    : `${file.estimated ? "~" : ""}${formatBytes(file.totalBytes)}`}
                </span>
              </div>
              {telemetry.length > 0 && (
                <div className="inspector-file-telemetry">
                  {telemetry.map((value) => (
                    <span key={value}>{value}</span>
                  ))}
                </div>
              )}
              {active && <Progress aria-label={`Progress for file ${file.path}`} value={percent} />}
              {file.error && <p className="task-error">{file.error}</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function TransferInspector({
  task,
  pending,
  blocked,
  error,
  onClose,
  onOpen,
  onAction,
  onRetry,
}: {
  task: Task;
  pending: boolean;
  blocked: boolean;
  error?: string;
  onClose: () => void;
  onOpen: () => void;
  onAction: (command: TransferCommand, id: string) => void;
  onRetry: (paths?: string[]) => void;
}) {
  const [width, setWidth] = useState(savedWidth);
  const [details, setDetails] = useState<{ id: string; data: DownloadFileDetails | null } | null>(null);
  const [failure, setFailure] = useState<{ id: string; message: string } | null>(null);
  const [retry, setRetry] = useState(0);
  const panel = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const name = taskName(task);
  const percent = taskProgress(task);
  const data = details?.id === task.id ? details.data : undefined;
  const loadError = failure?.id === task.id ? failure.message : undefined;

  useEffect(() => {
    closeButton.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const data = await invoke<DownloadFileDetails | null>("get_download_files", { id: task.id });
        if (!stopped) {
          setDetails({ id: task.id, data });
          setFailure(null);
        }
      } catch (error) {
        if (!stopped) setFailure({ id: task.id, message: String(error) });
      }
      if (!stopped && isActive(task)) timer = setTimeout(() => void load(), 1500);
    };
    void load();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [task.id, task.status, retry, pending]);

  useEffect(() => {
    try {
      localStorage.setItem(WIDTH_KEY, String(width));
    } catch {
      /* Private storage is optional. */
    }
  }, [width]);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      if (hasOpenOverlay()) return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onClose]);

  function resize(value: number) {
    const parentWidth = panel.current?.parentElement?.clientWidth ?? 1000;
    setWidth(clampWidth(Math.min(value, parentWidth - 340)));
  }

  return (
    <aside
      ref={panel}
      className="transfer-inspector"
      aria-label="Transfer details"
      style={{ "--inspector-width": `${width}px` } as CSSProperties}
    >
      <div
        role="separator"
        tabIndex={0}
        aria-label="Resize transfer details"
        aria-orientation="vertical"
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        aria-valuenow={width}
        className="inspector-resize"
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          resize(
            event.key === "Home"
              ? MIN_WIDTH
              : event.key === "End"
                ? MAX_WIDTH
                : width + (event.key === "ArrowLeft" ? 20 : -20)
          );
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          drag.current = { x: event.clientX, width: panel.current?.getBoundingClientRect().width ?? width };
          event.currentTarget.setPointerCapture(event.pointerId);
          event.preventDefault();
          event.currentTarget.focus();
        }}
        onPointerMove={(event) => {
          if (drag.current) resize(drag.current.width + drag.current.x - event.clientX);
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
      />
      <header className="inspector-header">
        <h2>{name}</h2>
        <IconButton ref={closeButton} label="Close transfer details" onClick={onClose}>
          <X size={17} />
        </IconButton>
        <p className="secondary inspector-path">{task.output}</p>
      </header>
      <section className="inspector-summary" aria-label="Transfer summary">
        <div className="inspector-summary-line">
          <span className={`status ${task.status}`}>{task.status}</span>
          <div className="inspector-actions">
            <IconButton label="Open download folder" onClick={onOpen}>
              <FolderOutput size={16} />
            </IconButton>
            {["interrupted", "failed"].includes(task.status) && (
              <IconButton
                label="Add transfer to queue"
                tooltip="Add to queue"
                description="Resume when this transfer reaches the front of the queue. Its destination, settings, and partial files are kept."
                disabled={pending || blocked}
                onClick={() => onAction("queue_download_task", task.id)}
              >
                <ListPlus size={16} />
              </IconButton>
            )}
            {task.status !== "completed" && (
              <IconButton
                label={isActive(task) ? "Interrupt transfer" : "Resume transfer"}
                tooltip={isActive(task) ? "Interrupt transfer" : "Resume now"}
                description={
                  isActive(task)
                    ? "Stop this transfer. Partial files are kept."
                    : "Continue immediately using existing partial files, without waiting in the queue."
                }
                disabled={pending || blocked}
                onClick={() => onAction(isActive(task) ? "cancel_download_task" : "resume_download_task", task.id)}
              >
                {pending ? <Spinner size={16} /> : isActive(task) ? <Square size={15} /> : <Play size={15} />}
              </IconButton>
            )}
          </div>
        </div>
        <div className="inspector-summary-line">
          <span>{percent === null ? "Size unknown" : `${Math.floor(percent)}%`}</span>
          <span className="secondary">{taskSize(task)}</span>
        </div>
        <Progress aria-label="Transfer total progress" value={percent} />
        <div className="inspector-summary-line secondary">
          <span>
            {task.overallProgress
              ? `${task.overallProgress.completedFiles} of ${task.overallProgress.totalFiles} files`
              : task.status === "queued"
                ? "Waiting to start"
                : ""}
          </span>
          <span>{taskSpeed(task)}</span>
        </div>
        {(error || task.lastError) && (
          <p role="alert" className="task-error">
            {error || task.lastError}
          </p>
        )}
      </section>
      <div className="inspector-files-heading">
        <h3>Files</h3>
        {data?.files.some((file) => file.status === "failed") && (
          <Button variant="ghost" disabled={pending || blocked || isActive(task)} onClick={() => onRetry()}>
            <RefreshCw size={14} /> Retry failed
          </Button>
        )}
        <span className="secondary">{data?.files.length ?? ""}</span>
      </div>
      {loadError && (
        <div role="alert" className="inspector-notice">
          <p>{loadError}</p>
          <Button variant="outline" onClick={() => setRetry((value) => value + 1)}>
            <RefreshCw size={14} />
            Retry
          </Button>
        </div>
      )}
      {data === undefined && !loadError && (
        <div className="inspector-notice" role="status">
          <Spinner size={16} />
          Loading files
        </div>
      )}
      {data === null && (
        <p className="inspector-notice">
          {task.status === "queued"
            ? "Files will appear when this transfer starts."
            : "Per-file details were not recorded for this transfer."}
        </p>
      )}
      {data && data.files.length === 0 && (
        <p className="inspector-notice">
          {task.status === "running" ? "Discovering files..." : "No files were recorded."}
        </p>
      )}
      {data && data.files.length > 0 && (
        <FileList
          key={task.id}
          files={data.files}
          task={task}
          retryDisabled={pending || blocked || isActive(task)}
          onRetry={onRetry}
        />
      )}
    </aside>
  );
}
