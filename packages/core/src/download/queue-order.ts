import type { DownloadTaskRecord } from "./tasks.js";

export type QueueMove = "up" | "down" | "next" | number;
export type QueueRank = [number, string];

export function queueRank(task: DownloadTaskRecord): QueueRank {
  return [task.queueOrder ?? task.queuedAt ?? task.createdAt ?? 0, task.id];
}

export function compareQueueRank(a: QueueRank, b: QueueRank): number {
  return a[0] - b[0] || a[1].localeCompare(b[1]);
}

export function orderedQueue(tasks: DownloadTaskRecord[]): DownloadTaskRecord[] {
  return tasks.filter((task) => task.status === "queued").sort((a, b) => compareQueueRank(queueRank(a), queueRank(b)));
}

export function compareTransferOrder(a: DownloadTaskRecord, b: DownloadTaskRecord): number {
  const group = (task: DownloadTaskRecord) => (task.status === "running" ? 0 : task.status === "queued" ? 1 : 2);
  return (
    group(a) - group(b) ||
    (a.status === "queued" && b.status === "queued"
      ? compareQueueRank(queueRank(a), queueRank(b))
      : (a.status === "running" ? a.createdAt - b.createdAt : b.updatedAt - a.updatedAt) || a.id.localeCompare(b.id))
  );
}
