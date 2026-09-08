import type { DownloadTaskRecord } from "@visuales/core";

export type Task = DownloadTaskRecord;
export const isActive = (task: Task) => task.status === "running" || task.status === "queued";

export function taskName(task: Task): string {
  let name = task.url;
  try {
    const url = new URL(task.url);
    const segment = url.pathname.replace(/\/+$/, "").split("/").pop();
    name = segment ? decodeURIComponent(segment) : url.hostname;
  } catch {
    /* Keep the stored source when it cannot be decoded. */
  }
  const extra = (task.urls?.length ?? 1) - 1;
  return extra > 0 ? `${name} + ${extra} more` : name;
}

export function taskProgress(task: Task): number | null {
  if (task.status === "completed") return 100;
  if (task.status === "queued") return 0;
  const overall = task.overallProgress;
  if (overall?.totalBytes) return Math.max(0, Math.min(99.9, (overall.downloadedBytes / overall.totalBytes) * 100));
  if (overall?.totalFiles) return Math.max(0, Math.min(99.9, (overall.completedFiles / overall.totalFiles) * 100));
  if (task.lastProgress?.totalSize) return Math.max(0, Math.min(99.9, task.lastProgress.progress));
  return null;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const unit = Math.max(0, Math.min(3, Math.floor(Math.log(bytes) / Math.log(1024))));
  return `${(bytes / 1024 ** unit).toFixed(unit === 0 ? 0 : 1)} ${["B", "KB", "MB", "GB"][unit]}`;
}

export function taskSpeedBytes(task: Task, now = Date.now()): number | null {
  const progress = task.overallProgress;
  if (task.status !== "running" || !progress || now - progress.updatedAt > 10000) return null;
  return Number.isFinite(progress.speedBytes) ? Math.max(0, progress.speedBytes) : null;
}

export function taskSpeed(task: Task): string {
  const bytes = taskSpeedBytes(task);
  if (bytes !== null) return `${formatBytes(bytes)}/s`;
  if (task.status === "running" && task.lastProgress && Date.now() - task.lastProgress.updatedAt <= 10000) {
    return task.lastProgress.speed || "--";
  }
  return "--";
}

export function taskSize(task: Task): string {
  const progress = task.overallProgress;
  const downloaded = progress?.downloadedBytes ?? task.lastProgress?.downloadedSize ?? 0;
  const total = progress?.totalBytes ?? task.lastProgress?.totalSize ?? 0;
  return total > 0
    ? `${formatBytes(downloaded)} / ${formatBytes(total)}`
    : downloaded > 0
      ? formatBytes(downloaded)
      : "--";
}
