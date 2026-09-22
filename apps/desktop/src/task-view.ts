import type { DownloadTaskRecord } from "@visuales/core";
import {
  transferByteProgress,
  transferName,
  transferSpeed,
  transferTotalBytes,
  transferSizeEstimated,
} from "@visuales/core/download/transfer-summary";

export type Task = DownloadTaskRecord;
export const isActive = (task: Task) => task.status === "running" || task.status === "queued";

export const taskGroups = [
  { id: "running", label: "Downloading" },
  { id: "queued", label: "Pending" },
  { id: "failed", label: "Error" },
  { id: "interrupted", label: "Interrupted" },
  { id: "completed", label: "Finished" },
] satisfies { id: Task["status"]; label: string }[];

export const taskName = transferName;

export function taskProgress(task: Task): number | null {
  if (task.status === "completed") return 100;
  if (task.status === "queued") return 0;
  const overall = task.overallProgress;
  const bytes = transferByteProgress(task);
  if (bytes !== null) return bytes;
  if (transferSizeEstimated(task)) return null;
  if (overall?.totalFiles) return Math.max(0, Math.min(99.9, (overall.completedFiles / overall.totalFiles) * 100));
  if (task.lastProgress?.totalSize) return Math.max(0, Math.min(99.9, task.lastProgress.progress));
  return null;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const unit = Math.max(0, Math.min(3, Math.floor(Math.log(bytes) / Math.log(1024))));
  return `${(bytes / 1024 ** unit).toFixed(unit === 0 ? 0 : 1)} ${["B", "KB", "MB", "GB"][unit]}`;
}

export const taskSpeedBytes = transferSpeed;

export function taskSpeed(task: Task): string {
  const bytes = taskSpeedBytes(task);
  if (bytes !== null) return `${formatBytes(bytes)}/s`;
  if (task.status === "running" && task.lastProgress && Date.now() - task.lastProgress.updatedAt <= 10000) {
    return task.lastProgress.speed || "--";
  }
  return "--";
}

export function taskSize(task: Task): string {
  if (transferSizeEstimated(task)) {
    const downloaded = task.overallProgress?.downloadedBytes;
    const prefix = downloaded === undefined ? "--" : formatBytes(downloaded);
    return `${prefix} / ~${formatBytes(transferTotalBytes(task)!)}`;
  }
  const progress = task.overallProgress;
  const downloaded = progress?.downloadedBytes ?? task.lastProgress?.downloadedSize ?? 0;
  const total = progress?.totalBytes ?? task.lastProgress?.totalSize ?? 0;
  return total > 0
    ? `${formatBytes(downloaded)} / ${formatBytes(total)}`
    : downloaded > 0
      ? formatBytes(downloaded)
      : "--";
}

export function taskProgressLabel(task: Task): string {
  const percent = taskProgress(task);
  return percent !== null
    ? `${Math.floor(percent)}%`
    : transferTotalBytes(task) !== null
      ? "Progress unknown"
      : "Size unknown";
}
