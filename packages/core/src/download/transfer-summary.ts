import type { DownloadTaskRecord } from "./tasks.js";

export function transferName(task: DownloadTaskRecord): string {
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

export function transferSpeed(task: DownloadTaskRecord, now = Date.now()): number | null {
  const progress = task.overallProgress;
  if (task.status !== "running" || !progress || !Number.isFinite(progress.updatedAt)) return null;
  const age = now - progress.updatedAt;
  if (age < 0 || age > 10000) return null;
  return Number.isFinite(progress.speedBytes) && progress.speedBytes >= 0 ? progress.speedBytes : null;
}

const count = (value: number | undefined) => (Number.isSafeInteger(value) && value! >= 0 ? value! : 0);
const bytes = (value: number | undefined) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

export function transferByteProgress(task: DownloadTaskRecord): number | null {
  const overall = task.overallProgress;
  if (
    !overall ||
    !Number.isFinite(overall.totalBytes) ||
    overall.totalBytes <= 0 ||
    !Number.isFinite(overall.downloadedBytes) ||
    overall.downloadedBytes < 0
  )
    return null;
  // A running transfer still needs final verification, even if its known bytes are present.
  return Math.max(0, Math.min(99.9, (overall.downloadedBytes / overall.totalBytes) * 100));
}

export function summarizeTransfer(task: DownloadTaskRecord, now = Date.now()) {
  const total = count(task.overallProgress?.totalFiles);
  const completed = Math.min(total, count(task.overallProgress?.completedFiles));
  return {
    id: task.id,
    name: transferName(task),
    status: task.status,
    speedBytes: transferSpeed(task, now),
    completedFiles: completed,
    totalFiles: total,
    downloadedBytes: bytes(task.overallProgress?.downloadedBytes),
    totalBytes: task.overallProgress?.totalBytes ? bytes(task.overallProgress.totalBytes) : null,
    progress: task.status === "completed" ? 100 : task.status === "queued" ? null : transferByteProgress(task),
  };
}

export function summarizeTransfers(tasks: DownloadTaskRecord[], now = Date.now()) {
  const active = tasks
    .filter((task) => task.status === "running" || task.status === "queued")
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const running = active.filter((task) => task.status === "running");
  const speeds = running.map((task) => transferSpeed(task, now));
  return {
    running: running.length,
    queued: active.length - running.length,
    // A missing worker speed makes the combined speed unknown, not an undercount.
    speedBytes: speeds.length && speeds.every((speed) => speed !== null) ? speeds.reduce((a, b) => a + b, 0) : null,
    transfers: active.map((task) => summarizeTransfer(task, now)),
  };
}

export type TransferSummary = ReturnType<typeof summarizeTransfers>;
