import * as fs from "node:fs/promises";
import lockfile from "proper-lockfile";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { ensureDownloadCacheDirectory } from "../lib/cache.js";
import { CONFIG } from "../lib/types.js";
import { readDownloadFileDetails, removeDownloadFileDetails } from "./file-details.js";
import { getProcessRows, type ProcessRow } from "../lib/process-list.js";
import type { DownloadOptions, DownloadProgress } from "./types.js";
import { queueRank, compareQueueRank, orderedQueue, type QueueRank, type QueueMove } from "./queue-order.js";
export { queueRank, compareQueueRank, orderedQueue, type QueueMove } from "./queue-order.js";

export type DownloadTaskStatus = "queued" | "running" | "completed" | "failed" | "interrupted";
export type DownloadTaskInterruptedCause = "canceled" | "process-exited" | "signal" | "unknown";
export type StoredDownloadOptions = Omit<DownloadOptions, "timeout"> & { timeout: number | "Infinity" };

export interface DownloadTaskRecord {
  id: string;
  url: string;
  urls?: string[];
  output: string;
  options: StoredDownloadOptions;
  status: DownloadTaskStatus;
  pid?: number;
  logFile?: string;
  createdAt: number;
  updatedAt: number;
  queuedAt?: number;
  queueOrder?: number;
  startedAt?: number;
  completedAt?: number;
  interruptedAt?: number;
  interruptedCause?: DownloadTaskInterruptedCause;
  lastError?: string;
  retryPaths?: string[];
  /** Display-only total from a complete cached listing, never download/verification progress. */
  sizeEstimate?: { totalBytes: number; totalFiles: number };
  lastProgress?: {
    url?: string;
    fileName: string;
    progress: number;
    downloadedSize: number;
    totalSize: number;
    speed: string;
    updatedAt: number;
  };
  overallProgress?: {
    completedFiles: number;
    totalFiles: number;
    downloadedBytes: number;
    totalBytes: number;
    speedBytes: number;
    updatedAt: number;
    activeFiles?: {
      url?: string;
      fileName: string;
      progress: number;
      downloadedSize: number;
      totalSize: number;
      speed: string;
    }[];
  };
}

interface DownloadTaskStore {
  version: 1;
  tasks: DownloadTaskRecord[];
}

const TASKS_FILE_NAME = "tasks.json";
const TASK_PROGRESS_WRITE_INTERVAL_MS = 2000;
const TASK_PROGRESS_ACTIVE_GRACE_MS = 10_000;
const QUEUE_POLL_INTERVAL_MS = 3000;
const lastProgressWrite = new Map<string, number>();

function tasksFilePath(): string {
  return path.join(CONFIG.DOWNLOAD_CACHE_DIR, TASKS_FILE_NAME);
}

function normalizeTaskUrls(urls: string | string[]): string[] {
  return Array.isArray(urls) ? urls : [urls];
}

export function createDownloadTaskId(urls: string | string[], output: string): string {
  return createHash("sha1")
    .update(`${normalizeTaskUrls(urls).join("\0")}\0${path.resolve(output)}`)
    .digest("hex")
    .slice(0, 10);
}

export function getDownloadTaskLogPath(id: string): string {
  return path.join(CONFIG.DOWNLOAD_CACHE_DIR, `${id}.log`);
}

function storeDownloadOptions(options: DownloadOptions): StoredDownloadOptions {
  return {
    ...options,
    output: path.resolve(options.output),
    timeout: Number.isFinite(options.timeout) ? options.timeout : "Infinity",
    verbose: false,
  };
}

function normalizeStoredOptions(
  options: Partial<StoredDownloadOptions> & { timeout?: number | string | null }
): StoredDownloadOptions {
  return {
    output: path.resolve(options.output ?? "."),
    resume: options.resume ?? true,
    maxRetries: options.maxRetries ?? 3,
    timeout: options.timeout === null || options.timeout === undefined ? "Infinity" : normalizeTimeout(options.timeout),
    concurrent: options.concurrent ?? 5,
    connections: options.connections ?? 3,
    compact: options.compact ?? false,
    exclude: options.exclude ?? [],
    verbose: false,
  };
}

function normalizeTimeout(timeout: number | string): number | "Infinity" {
  return timeout === "Infinity" || timeout === Infinity ? "Infinity" : Number(timeout);
}

function isProcessAlive(pid: number | undefined): boolean {
  if (!pid) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function loadTaskStore(): Promise<DownloadTaskStore> {
  await ensureDownloadCacheDirectory();

  try {
    const content = await fs.readFile(tasksFilePath(), "utf-8");
    const store = JSON.parse(content) as DownloadTaskStore;
    return {
      version: 1,
      tasks: Array.isArray(store.tasks)
        ? store.tasks.map((task) => ({
            ...task,
            interruptedCause: normalizeInterruptedCause(task),
            options: normalizeStoredOptions(task.options),
          }))
        : [],
    };
  } catch {
    return { version: 1, tasks: [] };
  }
}

function normalizeInterruptedCause(task: DownloadTaskRecord): DownloadTaskInterruptedCause | undefined {
  if (task.status !== "interrupted") return task.interruptedCause;
  if (task.interruptedCause && task.interruptedCause !== "unknown") return task.interruptedCause;
  if (task.logFile) return "process-exited";
  return "unknown";
}

async function saveTaskStore(store: DownloadTaskStore): Promise<void> {
  await ensureDownloadCacheDirectory();
  const filePath = tasksFilePath();
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

  try {
    await fs.writeFile(temporaryPath, JSON.stringify(store, null, 2));
    for (let attempt = 0; ; attempt++) {
      try {
        await fs.rename(temporaryPath, filePath);
        break;
      } catch (error) {
        // Windows readers or antivirus scans can briefly deny an atomic replacement.
        if (attempt >= 5 || !["EPERM", "EACCES", "EBUSY"].includes((error as NodeJS.ErrnoException).code ?? ""))
          throw error;
        await new Promise((resolve) => setTimeout(resolve, 25 * 2 ** attempt));
      }
    }
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
  }
}

function normalizeTaskStatus(task: DownloadTaskRecord, processes: () => ProcessRow[]): DownloadTaskRecord {
  const isActive = task.status === "running" || task.status === "queued";
  const recoveringInterrupted =
    task.status === "interrupted" && task.interruptedCause !== "canceled" && hasProgressSinceInterrupted(task);
  if (!isActive && !recoveringInterrupted) return task;

  const livePid = getLiveTaskPid(task, processes);
  const processAlive = Boolean(livePid);
  const recentlyProgressed = hasRecentProgress(task);

  if (recoveringInterrupted) {
    return {
      ...task,
      status: "running",
      pid: livePid,
      startedAt: task.startedAt ?? latestProgressUpdatedAt(task),
      interruptedAt: undefined,
      interruptedCause: undefined,
      updatedAt: Date.now(),
    };
  }

  if (task.status === "running" && processAlive && task.pid !== livePid) {
    return { ...task, pid: livePid, updatedAt: Date.now() };
  }

  if (task.status === "running" && recentlyProgressed) return task;

  if (task.status === "queued" && processAlive && hasProgressSinceQueued(task)) {
    return {
      ...task,
      status: "running",
      pid: livePid,
      startedAt: task.startedAt ?? latestProgressUpdatedAt(task),
      queuedAt: undefined,
      updatedAt: Date.now(),
    };
  }

  if (task.status === "queued" && processAlive && task.pid !== livePid) {
    return { ...task, pid: livePid, updatedAt: Date.now() };
  }

  if (!isActive || processAlive) return task;

  return {
    ...task,
    status: "interrupted",
    interruptedAt: task.interruptedAt ?? Date.now(),
    interruptedCause: task.interruptedCause ?? "process-exited",
    updatedAt: Date.now(),
    pid: undefined,
  };
}

function hasProgressSinceQueued(task: DownloadTaskRecord): boolean {
  const progressUpdatedAt = latestProgressUpdatedAt(task);
  if (!progressUpdatedAt) return false;

  return progressUpdatedAt >= (task.queuedAt ?? task.startedAt ?? task.createdAt ?? 0);
}

function hasProgressSinceInterrupted(task: DownloadTaskRecord): boolean {
  const progressUpdatedAt = latestProgressUpdatedAt(task);
  if (!progressUpdatedAt || !task.interruptedAt) return false;

  return progressUpdatedAt > task.interruptedAt;
}

function latestProgressUpdatedAt(task: DownloadTaskRecord): number | undefined {
  return Math.max(task.lastProgress?.updatedAt ?? 0, task.overallProgress?.updatedAt ?? 0) || undefined;
}

function hasRecentProgress(task: DownloadTaskRecord): boolean {
  const progressUpdatedAt = latestProgressUpdatedAt(task);
  if (!progressUpdatedAt) return false;

  return Date.now() - progressUpdatedAt <= TASK_PROGRESS_ACTIVE_GRACE_MS;
}

function getLiveTaskPid(task: DownloadTaskRecord, processes: () => ProcessRow[]): number | undefined {
  if (isProcessAlive(task.pid)) return task.pid;
  return getLiveTaskPids(task, processes())[0];
}

function getLiveTaskPids(task: DownloadTaskRecord, rows = getProcessRows()): number[] {
  const urls = normalizeTaskUrls(task.urls ?? task.url);

  return rows
    .filter(({ command }) => isTaskProcessCommand(command, urls))
    .map(({ pid }) => pid)
    .filter((pid) => isProcessAlive(pid));
}

function isTaskProcessCommand(command: string, urls: string[]): boolean {
  return command.includes(" download ") && urls.every((url) => command.includes(url));
}

export async function listDownloadTasks(): Promise<DownloadTaskRecord[]> {
  return withTaskLock(listDownloadTasksUnlocked);
}

async function listDownloadTasksUnlocked(): Promise<DownloadTaskRecord[]> {
  const store = await loadTaskStore();
  let rows: ProcessRow[] | undefined;
  // Query once per snapshot, and only when a recorded PID is missing or dead.
  const processes = () => (rows ??= getProcessRows());
  const normalizedTasks = store.tasks.map((task) => normalizeTaskStatus(task, processes));

  if (JSON.stringify(normalizedTasks) !== JSON.stringify(store.tasks)) {
    await saveTaskStore({ ...store, tasks: normalizedTasks });
  }

  return normalizedTasks.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function findDownloadTask(idOrUrl: string): Promise<DownloadTaskRecord | null> {
  const tasks = await listDownloadTasks();
  return tasks.find((task) => task.id === idOrUrl || task.url === idOrUrl || task.urls?.includes(idOrUrl)) ?? null;
}

/** Persist a live worker's file limit without altering its queue position or other options. */
export async function updateDownloadTaskConcurrency(id: string, concurrent: number, pid: number): Promise<boolean> {
  if (!Number.isSafeInteger(concurrent) || concurrent < 1)
    throw new Error("File concurrency must be a positive whole number.");
  return withTaskLock(async () => {
    const store = await loadTaskStore();
    const task = store.tasks.find((item) => item.id === id);
    if (!task || task.pid !== pid || (task.status !== "running" && task.status !== "queued")) return false;
    if (task.options.concurrent !== concurrent) {
      task.options.concurrent = concurrent;
      await saveTaskStore(store);
    }
    return true;
  });
}

/** Claim the original task before launching a selective retry; never share its recorder with another worker. */
export async function claimDownloadFileRetry(
  id: string,
  paths?: string[],
  pid = process.pid
): Promise<DownloadTaskRecord> {
  return withTaskLock(async () => {
    const tasks = await listDownloadTasksUnlocked();
    const task = tasks.find((item) => item.id === id || item.url === id || item.urls?.includes(id));
    if (!task) throw new Error("Download task not found");
    if (task.status === "running" || task.status === "queued")
      throw new Error("Wait for this transfer to stop before retrying its files.");
    const details = await readDownloadFileDetails(task.id);
    if (!details) throw new Error("No file details were recorded for this transfer.");
    const selected = paths ?? details.files.filter((file) => file.status === "failed").map((file) => file.path);
    if (!selected.length) throw new Error("No failed files to retry.");
    for (const name of selected) {
      const file = details.files.find((item) => item.path === name);
      if (!file || file.status !== "failed") throw new Error(`Not a recorded failed file: ${name}`);
    }
    const next: DownloadTaskRecord = {
      ...task,
      status: "running",
      pid,
      retryPaths: [...new Set(selected)],
      startedAt: Date.now(),
      updatedAt: Date.now(),
      completedAt: undefined,
      interruptedAt: undefined,
      interruptedCause: undefined,
      lastError: undefined,
    };
    await saveTaskStore({ version: 1, tasks: tasks.map((item) => (item.id === task.id ? next : item)) });
    return next;
  });
}

export async function clearDownloadTasks(): Promise<number> {
  return withTaskLock(clearDownloadTasksUnlocked);
}

async function clearDownloadTasksUnlocked(): Promise<number> {
  const tasks = await listDownloadTasksUnlocked();
  await saveTaskStore({ version: 1, tasks: [] });
  lastProgressWrite.clear();

  return tasks.length;
}

/**
 * Removes a single task record by id or URL. A still-live process is stopped first so a detached
 * download is not left running with no record to track or cancel it. Returns the removed record,
 * or `null` when no task matches. Downloaded files and partial data are left untouched — only the
 * task record and its log are discarded.
 */
export async function deleteDownloadTask(idOrUrl: string): Promise<DownloadTaskRecord | null> {
  return withTaskLock(() => deleteDownloadTaskUnlocked(idOrUrl));
}

async function deleteDownloadTaskUnlocked(idOrUrl: string): Promise<DownloadTaskRecord | null> {
  const store = await loadTaskStore();
  const index = store.tasks.findIndex(
    (task) => task.id === idOrUrl || task.url === idOrUrl || task.urls?.includes(idOrUrl)
  );
  if (index === -1) return null;

  const [task] = store.tasks.splice(index, 1);
  if (isProcessAlive(task.pid)) {
    try {
      process.kill(task.pid as number, "SIGTERM");
    } catch {
      // The process may exit between the liveness check and the signal; removing the record is enough.
    }
  }

  await saveTaskStore(store);
  lastProgressWrite.delete(task.id);
  await removeTaskLogFile(task);
  await removeDownloadFileDetails(task.id);

  return task;
}

async function removeTaskLogFile(task: DownloadTaskRecord): Promise<void> {
  const logFile = task.logFile ?? getDownloadTaskLogPath(task.id);
  try {
    await fs.rm(logFile, { force: true });
  } catch {
    // A missing or unremovable log should not fail the delete.
  }
}

export async function startDownloadTask(
  urls: string | string[],
  options: DownloadOptions
): Promise<DownloadTaskRecord> {
  return startDownloadTaskWithPid(urls, options, process.pid);
}

/**
 * Registers a task as `queued` so it shows up in `visuales tasks` while it parks. The worker
 * later calls {@link waitForQueueSlot}, which atomically claims its turn and marks it running.
 */
export async function enqueueDownloadTask(
  urls: string | string[],
  options: DownloadOptions,
  pid: number = process.pid,
  logFile?: string
): Promise<DownloadTaskRecord> {
  return startDownloadTaskWithPid(urls, options, pid, logFile, "queued");
}

export async function startDownloadTaskWithPid(
  urls: string | string[],
  options: DownloadOptions,
  pid: number,
  logFile?: string,
  initialStatus: Extract<DownloadTaskStatus, "queued" | "running"> = "running",
  failedOnly = false
): Promise<DownloadTaskRecord> {
  return withTaskLock(() => registerTask(urls, options, pid, logFile, initialStatus, failedOnly));
}

async function registerTask(
  urls: string | string[],
  options: DownloadOptions,
  pid: number,
  logFile: string | undefined,
  initialStatus: Extract<DownloadTaskStatus, "queued" | "running">,
  failedOnly = false
): Promise<DownloadTaskRecord> {
  const store = await loadTaskStore();
  const normalizedUrls = normalizeTaskUrls(urls);
  const id = createDownloadTaskId(normalizedUrls, options.output);
  const now = Date.now();
  const existing = store.tasks.find((task) => task.id === id);
  if (failedOnly && existing?.status !== "failed")
    throw new Error("This transfer is no longer failed. Refresh downloads before retrying.");
  if (
    existing &&
    existing.retryPaths?.length &&
    (existing.status === "running" || existing.status === "queued") &&
    existing.pid !== pid &&
    isProcessAlive(existing.pid)
  )
    throw new Error("This transfer already has an active worker.");
  const status = initialStatus === "queued" && existing?.status === "running" ? "running" : initialStatus;
  const isQueued = status === "queued";
  const record: DownloadTaskRecord = {
    id,
    url: normalizedUrls[0],
    urls: normalizedUrls.length > 1 ? normalizedUrls : undefined,
    output: path.resolve(options.output),
    options: storeDownloadOptions(options),
    status,
    pid,
    logFile: logFile ?? existing?.logFile,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    // Keep the position from when it first joined the queue; only stamp a fresh time when it
    // was not already waiting (a re-download of the same target, or the worker re-registering).
    queuedAt: isQueued ? (existing?.status === "queued" ? (existing.queuedAt ?? now) : now) : undefined,
    queueOrder: isQueued
      ? existing?.status === "queued"
        ? queueRank(existing)[0]
        : Math.max(now, ...store.tasks.filter((task) => task.status === "queued").map((task) => queueRank(task)[0] + 1))
      : undefined,
    startedAt: isQueued ? existing?.startedAt : now,
    interruptedAt: undefined,
    interruptedCause: undefined,
    completedAt: undefined,
    lastError: undefined,
    retryPaths: undefined,
    lastProgress: existing?.lastProgress,
  };

  if (existing) {
    Object.assign(existing, record);
  } else {
    store.tasks.push(record);
  }

  await saveTaskStore(store);
  return record;
}

/** Move against the latest shared queue, never against a stale client snapshot. */
export async function moveQueuedDownloadTask(idOrUrl: string, move: QueueMove): Promise<DownloadTaskRecord[]> {
  if (
    !(
      move === "up" ||
      move === "down" ||
      move === "next" ||
      (typeof move === "number" && Number.isSafeInteger(move) && move > 0)
    )
  ) {
    throw new Error("Queue position must be a positive integer, up, down, or next");
  }
  return withTaskLock(async () => {
    const tasks = await listDownloadTasksUnlocked();
    const task = tasks.find((item) => item.id === idOrUrl || item.url === idOrUrl || item.urls?.includes(idOrUrl));
    if (!task) throw new Error("Download task not found");
    if (task.status !== "queued") throw new Error("Only queued downloads can be reordered");
    const queue = orderedQueue(tasks);
    const from = queue.findIndex((item) => item.id === task.id);
    const to =
      move === "next"
        ? 0
        : move === "up"
          ? Math.max(0, from - 1)
          : move === "down"
            ? Math.min(queue.length - 1, from + 1)
            : move - 1;
    if (to >= queue.length) throw new Error(`Queue position must be between 1 and ${queue.length}`);
    queue.splice(from, 1);
    queue.splice(to, 0, task);
    queue.forEach((item, index) => {
      item.queueOrder = index;
    });
    await saveTaskStore({ version: 1, tasks });
    return queue;
  });
}

export interface QueuePosition {
  runningCount: number;
  aheadCount: number;
}

/**
 * A queued task may start once nothing is `running` and it is the frontmost waiter (earliest
 * persisted order, falling back to `queuedAt`, ties broken by id). Callers must hold the task
 * lock through the running transition. Pure so it can be unit-tested directly.
 */
export function isQueuedTaskReady(tasks: DownloadTaskRecord[], taskId: string): boolean {
  const me = tasks.find((task) => task.id === taskId);
  if (!me || me.status !== "queued") return false;
  if (tasks.some((task) => task.status === "running")) return false;

  const myRank = queueRank(me);
  return !tasks.some(
    (task) => task.status === "queued" && task.id !== taskId && compareQueueRank(queueRank(task), myRank) < 0
  );
}

export function getQueuePosition(tasks: DownloadTaskRecord[], taskId: string): QueuePosition {
  const me = tasks.find((task) => task.id === taskId);
  const myRank = me ? queueRank(me) : ([0, taskId] as QueueRank);

  return {
    runningCount: tasks.filter((task) => task.status === "running").length,
    aheadCount: tasks.filter(
      (task) => task.status === "queued" && task.id !== taskId && compareQueueRank(queueRank(task), myRank) < 0
    ).length,
  };
}

/**
 * Parks a queued task until it is cleared to start. Returns `true` when the slot is acquired, or
 * `false` when the task is no longer queued (it was canceled while waiting), so the caller can
 * bail out instead of downloading. The gate re-evaluates every {@link QUEUE_POLL_INTERVAL_MS};
 * a running task that finishes or whose process dies (marked interrupted by liveness checks)
 * both free the slot.
 */
export async function waitForQueueSlot(
  taskId: string,
  onWait?: (position: QueuePosition) => void,
  ownerPid: number = process.pid
): Promise<boolean> {
  for (;;) {
    const result = await claimQueuedDownloadTask(taskId, ownerPid);
    if (result === "acquired") return true;
    if (result === "canceled") return false;
    if (onWait) onWait(getQueuePosition(await listDownloadTasks(), taskId));
    await sleep(QUEUE_POLL_INTERVAL_MS);
  }
}

/** Readiness and claiming share the reorder lock, so a moved waiter cannot also pass the gate. */
export async function claimQueuedDownloadTask(
  taskId: string,
  ownerPid: number = process.pid
): Promise<"acquired" | "waiting" | "canceled"> {
  return withTaskLock(async () => {
    const tasks = await listDownloadTasksUnlocked();
    const me = tasks.find((task) => task.id === taskId);
    if (!me || me.status !== "queued" || (me.pid && me.pid !== ownerPid)) return "canceled";
    if (!isQueuedTaskReady(tasks, taskId)) return "waiting";
    await updateTaskUnlocked(taskId, {
      status: "running",
      pid: ownerPid,
      startedAt: Date.now(),
      queuedAt: undefined,
      queueOrder: undefined,
      interruptedAt: undefined,
      interruptedCause: undefined,
    });
    return "acquired";
  });
}

export async function completeDownloadTask(id: string): Promise<void> {
  const task = await findDownloadTask(id);
  const overallProgress = task?.overallProgress ? getCompletedOverallProgress(task.overallProgress) : undefined;

  await updateTask(id, {
    status: "completed",
    pid: undefined,
    completedAt: Date.now(),
    interruptedAt: undefined,
    interruptedCause: undefined,
    lastError: undefined,
    overallProgress,
    retryPaths: undefined,
  });
}

export async function failDownloadTask(id: string, error: unknown): Promise<void> {
  await updateTask(id, {
    status: "failed",
    pid: undefined,
    interruptedAt: undefined,
    interruptedCause: undefined,
    lastError: error instanceof Error ? error.message : String(error),
    retryPaths: undefined,
  });
}

export async function interruptDownloadTask(id: string, cause: DownloadTaskInterruptedCause = "signal"): Promise<void> {
  await updateTask(id, {
    status: "interrupted",
    pid: undefined,
    interruptedAt: Date.now(),
    interruptedCause: cause,
  });
}

export async function cancelDownloadTask(idOrUrl: string): Promise<DownloadTaskRecord | null> {
  const task = await findDownloadTask(idOrUrl);
  if (!task) return null;
  const livePids = getLiveTaskPids(task);
  const pids = [
    ...new Set([task.pid, ...livePids].filter((pid): pid is number => Boolean(pid) && isProcessAlive(pid))),
  ];

  if (task.status !== "running" && task.status !== "queued" && pids.length === 0) {
    return task;
  }

  if (pids.length === 0) {
    const interruptedAt = Date.now();
    await interruptDownloadTask(task.id, "process-exited");
    return { ...task, status: "interrupted", pid: undefined, interruptedAt, interruptedCause: "process-exited" };
  }

  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // If the process exits between the liveness check and signal, still mark the task resumable.
    }
  }

  const interruptedAt = Date.now();
  await interruptDownloadTask(task.id, "canceled");
  return { ...task, status: "interrupted", pid: undefined, interruptedAt, interruptedCause: "canceled" };
}

export interface CancelAllDownloadsResult {
  interrupted: DownloadTaskRecord[];
  failures: { id: string; message: string }[];
}

/** Stop one shared snapshot while holding the queue-claim lock, including hidden/CLI tasks. */
export async function cancelAllDownloadTasks(): Promise<CancelAllDownloadsResult> {
  return withTaskLock(async () => {
    const tasks = await listDownloadTasksUnlocked();
    const result: CancelAllDownloadsResult = { interrupted: [], failures: [] };
    let rows: ProcessRow[] | undefined;
    for (const task of tasks) {
      if (task.status !== "running" && task.status !== "queued") continue;
      const pids = isProcessAlive(task.pid) ? [task.pid!] : getLiveTaskPids(task, (rows ??= getProcessRows()));
      const errors: string[] = [];
      for (const pid of pids) {
        try {
          if (pid === process.pid) throw new Error("Cannot interrupt the process handling this request");
          process.kill(pid, "SIGTERM");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH")
            errors.push(error instanceof Error ? error.message : String(error));
        }
      }
      if (errors.length) result.failures.push({ id: task.id, message: errors.join("; ") });
      // Even if a queued worker cannot be signaled, revoke its slot so it cannot start.
      if (errors.length && task.status === "running") continue;
      Object.assign(task, {
        status: "interrupted",
        pid: undefined,
        interruptedAt: Date.now(),
        interruptedCause: "canceled",
        updatedAt: Date.now(),
        queuedAt: undefined,
        queueOrder: undefined,
        lastProgress: task.lastProgress ? { ...task.lastProgress, speed: "0 B/s" } : undefined,
        overallProgress: task.overallProgress ? { ...task.overallProgress, speedBytes: 0, activeFiles: [] } : undefined,
      });
      lastProgressWrite.delete(task.id);
      result.interrupted.push(task);
    }
    if (result.interrupted.length) await saveTaskStore({ version: 1, tasks });
    return result;
  });
}

export async function updateDownloadTaskProgress(id: string, progress: DownloadProgress, force = false): Promise<void> {
  const now = Date.now();
  const lastWrite = lastProgressWrite.get(id) ?? 0;
  // Reconciliation can reduce bytes to zero. Lifecycle snapshots must not be lost just
  // because they arrive inside the throttle window or don't look like 100% completion.
  if (!force && !progress.checkpoint && progress.progress < 100 && now - lastWrite < TASK_PROGRESS_WRITE_INTERVAL_MS)
    return;

  lastProgressWrite.set(id, now);
  const task = await findDownloadTask(id);
  const updates: Partial<DownloadTaskRecord> = {
    lastProgress: {
      url: progress.url,
      fileName: progress.fileName,
      progress: progress.progress,
      downloadedSize: progress.downloadedSize,
      totalSize: progress.totalSize,
      speed: progress.speed,
      updatedAt: now,
    },
    overallProgress: progress.overall
      ? {
          ...progress.overall,
          updatedAt: now,
        }
      : undefined,
  };

  if (task?.status === "queued" || task?.status === "interrupted") {
    updates.status = "running";
    updates.startedAt = task.startedAt ?? now;
    updates.queuedAt = undefined;
    updates.pid = process.pid;
    updates.interruptedAt = undefined;
    updates.interruptedCause = undefined;
  }

  await updateTask(id, updates);
}

async function updateTask(id: string, updates: Partial<DownloadTaskRecord>): Promise<void> {
  return withTaskLock(() => updateTaskUnlocked(id, updates));
}

async function updateTaskUnlocked(id: string, updates: Partial<DownloadTaskRecord>): Promise<void> {
  const store = await loadTaskStore();
  const task = store.tasks.find((candidate) => candidate.id === id);
  if (!task) return;

  // In-flight worker callbacks must not undo an explicit cancellation. A new run
  // clears this state through registerTask/claimDownloadFileRetry, under the same lock.
  if (task.status === "interrupted" && task.interruptedCause === "canceled") return;

  Object.assign(task, updates, { updatedAt: Date.now() });
  await saveTaskStore(store);
}

async function withTaskLock<T>(operation: () => Promise<T>): Promise<T> {
  await fs.mkdir(CONFIG.DOWNLOAD_CACHE_DIR, { recursive: true });
  const release = await lockfile.lock(tasksFilePath(), {
    realpath: false,
    retries: { retries: 100, minTimeout: 50, maxTimeout: 150 },
  });
  try {
    return await operation();
  } finally {
    await release();
  }
}

export function getCompletedOverallProgress(
  progress: NonNullable<DownloadTaskRecord["overallProgress"]>
): NonNullable<DownloadTaskRecord["overallProgress"]> {
  const totalBytes = Math.max(progress.totalBytes, progress.downloadedBytes);
  return {
    ...progress,
    completedFiles: progress.totalFiles,
    downloadedBytes: totalBytes,
    totalBytes,
    speedBytes: 0,
    activeFiles: [],
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
