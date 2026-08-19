import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { formatDistanceToNow } from "date-fns";
import colors from "ansi-colors";
import { ensureDownloadCacheDirectory } from "../../lib/cache.js";
import { CONFIG } from "../../lib/types.js";
import type { DownloadOptions, DownloadProgress } from "./types.js";
import { formatSize } from "./utils.js";

export type DownloadTaskStatus = "running" | "completed" | "failed" | "interrupted";
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
  startedAt?: number;
  completedAt?: number;
  interruptedAt?: number;
  lastError?: string;
  lastProgress?: {
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
const STATUS_BAR_WIDTH = 28;
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
            options: normalizeStoredOptions(task.options),
          }))
        : [],
    };
  } catch {
    return { version: 1, tasks: [] };
  }
}

async function saveTaskStore(store: DownloadTaskStore): Promise<void> {
  await ensureDownloadCacheDirectory();
  await fs.writeFile(tasksFilePath(), JSON.stringify(store, null, 2));
}

function normalizeTaskStatus(task: DownloadTaskRecord): DownloadTaskRecord {
  if (task.status !== "running" || isProcessAlive(task.pid)) return task;

  return {
    ...task,
    status: "interrupted",
    interruptedAt: task.interruptedAt ?? Date.now(),
    updatedAt: Date.now(),
    pid: undefined,
  };
}

export async function listDownloadTasks(): Promise<DownloadTaskRecord[]> {
  const store = await loadTaskStore();
  const normalizedTasks = store.tasks.map(normalizeTaskStatus);

  if (JSON.stringify(normalizedTasks) !== JSON.stringify(store.tasks)) {
    await saveTaskStore({ ...store, tasks: normalizedTasks });
  }

  return normalizedTasks.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function findDownloadTask(idOrUrl: string): Promise<DownloadTaskRecord | null> {
  const tasks = await listDownloadTasks();
  return tasks.find((task) => task.id === idOrUrl || task.url === idOrUrl || task.urls?.includes(idOrUrl)) ?? null;
}

export async function clearDownloadTasks(): Promise<number> {
  const tasks = await listDownloadTasks();
  await saveTaskStore({ version: 1, tasks: [] });
  lastProgressWrite.clear();

  return tasks.length;
}

export async function startDownloadTask(
  urls: string | string[],
  options: DownloadOptions
): Promise<DownloadTaskRecord> {
  return startDownloadTaskWithPid(urls, options, process.pid);
}

export async function startDownloadTaskWithPid(
  urls: string | string[],
  options: DownloadOptions,
  pid: number,
  logFile?: string
): Promise<DownloadTaskRecord> {
  const store = await loadTaskStore();
  const normalizedUrls = normalizeTaskUrls(urls);
  const id = createDownloadTaskId(normalizedUrls, options.output);
  const now = Date.now();
  const existing = store.tasks.find((task) => task.id === id);
  const record: DownloadTaskRecord = {
    id,
    url: normalizedUrls[0],
    urls: normalizedUrls.length > 1 ? normalizedUrls : undefined,
    output: path.resolve(options.output),
    options: storeDownloadOptions(options),
    status: "running",
    pid,
    logFile: logFile ?? existing?.logFile,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    startedAt: now,
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

export async function completeDownloadTask(id: string): Promise<void> {
  await updateTask(id, {
    status: "completed",
    pid: undefined,
    completedAt: Date.now(),
    lastError: undefined,
  });
}

export async function failDownloadTask(id: string, error: unknown): Promise<void> {
  await updateTask(id, {
    status: "failed",
    pid: undefined,
    lastError: error instanceof Error ? error.message : String(error),
  });
}

export async function interruptDownloadTask(id: string): Promise<void> {
  await updateTask(id, {
    status: "interrupted",
    pid: undefined,
    interruptedAt: Date.now(),
  });
}

export async function cancelDownloadTask(idOrUrl: string): Promise<DownloadTaskRecord | null> {
  const task = await findDownloadTask(idOrUrl);
  if (!task) return null;

  if (task.status !== "running" || !task.pid || !isProcessAlive(task.pid)) {
    await interruptDownloadTask(task.id);
    return { ...task, status: "interrupted", pid: undefined, interruptedAt: Date.now() };
  }

  try {
    process.kill(task.pid, "SIGTERM");
  } catch {
    // If the process exits between the liveness check and signal, still mark the task resumable.
  }

  await interruptDownloadTask(task.id);
  return { ...task, status: "interrupted", pid: undefined, interruptedAt: Date.now() };
}

export async function updateDownloadTaskProgress(id: string, progress: DownloadProgress): Promise<void> {
  const now = Date.now();
  const lastWrite = lastProgressWrite.get(id) ?? 0;
  if (now - lastWrite < TASK_PROGRESS_WRITE_INTERVAL_MS) return;

  lastProgressWrite.set(id, now);
  await updateTask(id, {
    lastProgress: {
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
  });
}

async function updateTask(id: string, updates: Partial<DownloadTaskRecord>): Promise<void> {
  const store = await loadTaskStore();
  const task = store.tasks.find((candidate) => candidate.id === id);
  if (!task) return;

  Object.assign(task, updates, { updatedAt: Date.now() });
  await saveTaskStore(store);
}

function formatStatus(task: DownloadTaskRecord): string {
  if (task.status === "completed") return colors.green("completed");
  if (task.status === "running") return colors.cyan("running");
  if (task.status === "failed") return colors.red("failed");
  return colors.yellow("interrupted");
}

interface PrintDownloadTasksOptions {
  all?: boolean;
}

function isActionableTask(task: DownloadTaskRecord): boolean {
  return task.status === "running" || task.status === "interrupted";
}

export async function printDownloadTasks(options: PrintDownloadTasksOptions = {}): Promise<void> {
  const tasks = await listDownloadTasks();
  const displayedTasks = options.all ? tasks : tasks.filter(isActionableTask);

  if (tasks.length === 0) {
    console.log(colors.yellow("No download tasks found."));
    return;
  }

  if (displayedTasks.length === 0) {
    console.log(colors.yellow("No running or interrupted download tasks found."));
    console.log(colors.gray("Run `visuales tasks --all` to see completed and failed task history."));
    return;
  }

  const heading = options.all ? "Download Tasks:" : "Active Download Tasks:";
  console.log(colors.blue.bold(`\n${heading}`));
  console.log(colors.gray("──────────────────────────────────────────────────"));

  for (const task of [...displayedTasks].reverse()) {
    printDownloadTask(task);
    console.log();
  }
}

export async function printDownloadTaskStatus(idOrUrl: string): Promise<boolean> {
  const task = await findDownloadTask(idOrUrl);
  if (!task) return false;

  console.log(colors.blue.bold("\nDownload Progress:"));
  console.log(colors.gray("──────────────────────────────────────────────────"));
  printDownloadTaskProgress(task);
  return true;
}

function printDownloadTaskProgress(task: DownloadTaskRecord): void {
  const updatedAge = formatDistanceToNow(new Date(task.updatedAt), { addSuffix: true });
  console.log(`${colors.cyan.bold(task.id)} ${formatStatus(task)} ${colors.gray(`updated ${updatedAge}`)}`);

  if (!task.lastProgress) {
    const waitingMessage =
      task.status === "running" ? "Waiting for the first progress update..." : "No progress saved.";
    console.log(`           ${colors.gray("Progress:")} ${colors.yellow(waitingMessage)}`);
    printDownloadTaskDetails(task, false);
    return;
  }

  const progressAge = formatDistanceToNow(new Date(task.lastProgress.updatedAt), { addSuffix: true });

  if (task.overallProgress) {
    const overallPercent = clampPercentage(
      task.status === "completed" ? 100 : calculateOverallPercentage(task.overallProgress)
    );
    const overallBar = renderProgressBar(overallPercent);
    const overallDownloadedSize = formatSize(task.overallProgress.downloadedBytes);
    const overallTotalSize =
      task.overallProgress.totalBytes > 0 ? formatSize(task.overallProgress.totalBytes) : "unknown";

    console.log(
      `           ${colors.gray("Overall:")} ${overallBar} ${colors.bold.white(`${Math.floor(overallPercent)}%`)} ${colors.gray(
        `${overallDownloadedSize} / ${overallTotalSize}`
      )} ${colors.gray(`(${task.overallProgress.completedFiles}/${task.overallProgress.totalFiles} files)`)}`
    );
  }

  const activeFiles = task.overallProgress?.activeFiles;
  if (activeFiles && activeFiles.length > 0) {
    console.log(
      `           ${colors.gray("Active:")}  ${colors.white(`${activeFiles.length} file${activeFiles.length === 1 ? "" : "s"}`)}`
    );
    for (const file of activeFiles) {
      printActiveFileProgress(file);
    }
  } else {
    console.log(`           ${colors.gray("Last file:")} ${colors.white(task.lastProgress.fileName)}`);
    printActiveFileProgress(task.lastProgress);
  }

  console.log(`           ${colors.gray("Sample:")}   ${colors.gray(progressAge)}`);
  printDownloadTaskDetails(task, false);
}

function printActiveFileProgress(file: {
  fileName: string;
  progress: number;
  downloadedSize: number;
  totalSize: number;
  speed: string;
}): void {
  const filePercent = clampPercentage(file.progress);
  const fileDownloadedSize = formatSize(file.downloadedSize);
  const fileTotalSize = file.totalSize > 0 ? formatSize(file.totalSize) : "unknown";
  const fileBar = renderProgressBar(filePercent);

  console.log(
    `           ${colors.gray("File:")}    ${fileBar} ${colors.bold.white(`${Math.floor(filePercent)}%`)} ${colors.gray(
      `${fileDownloadedSize} / ${fileTotalSize}`
    )} ${colors.white(file.fileName)} ${colors.gray(file.speed)}`
  );
}

function renderProgressBar(percent: number): string {
  const completed = Math.round((percent / 100) * STATUS_BAR_WIDTH);
  const bar = `${"=".repeat(completed)}${"-".repeat(STATUS_BAR_WIDTH - completed)}`;
  return colors.green(`[${bar}]`);
}

function clampPercentage(percent: number): number {
  return Math.max(0, Math.min(100, percent));
}

function calculateOverallPercentage(progress: NonNullable<DownloadTaskRecord["overallProgress"]>): number {
  if (progress.totalBytes > 0) {
    return (Math.min(progress.downloadedBytes, progress.totalBytes) / progress.totalBytes) * 100;
  }

  return progress.totalFiles > 0 ? (progress.completedFiles / progress.totalFiles) * 100 : 0;
}

function printDownloadTask(task: DownloadTaskRecord): void {
  const age = formatDistanceToNow(new Date(task.updatedAt), { addSuffix: true });
  console.log(`${colors.cyan.bold(task.id)} ${formatStatus(task)} ${colors.gray(`updated ${age}`)}`);
  printDownloadTaskDetails(task, true);
}

function printDownloadTaskDetails(task: DownloadTaskRecord, includeProgressSummary: boolean): void {
  if (task.urls && task.urls.length > 1) {
    console.log(`           ${colors.gray("Sources:")} ${colors.white(`${task.urls.length} targets`)}`);
    for (const url of task.urls.slice(0, 5)) {
      console.log(`           ${colors.gray("        ")} ${colors.white(url)}`);
    }
    if (task.urls.length > 5) {
      console.log(`           ${colors.gray("        ")} ${colors.gray(`...and ${task.urls.length - 5} more`)}`);
    }
  } else {
    console.log(`           ${colors.gray("Source:")} ${colors.white(task.url)}`);
  }
  console.log(`           ${colors.gray("Target:")} ${colors.white(task.output)}`);
  if (task.pid) {
    console.log(`           ${colors.gray("PID:")}    ${colors.white(task.pid.toString())}`);
  }
  if (task.logFile) {
    console.log(`           ${colors.gray("Log:")}    ${colors.white(task.logFile)}`);
  }

  if (includeProgressSummary && task.lastProgress) {
    const progress = task.overallProgress
      ? `${Math.floor(clampPercentage(calculateOverallPercentage(task.overallProgress)))}% overall`
      : `${Math.floor(task.lastProgress.progress)}% file`;
    const size = task.overallProgress
      ? `${formatSize(task.overallProgress.downloadedBytes)} / ${formatSize(task.overallProgress.totalBytes)}`
      : `${formatSize(task.lastProgress.downloadedSize)} / ${formatSize(task.lastProgress.totalSize)}`;
    console.log(
      `           ${colors.gray("Last:")}   ${colors.white(task.lastProgress.fileName)} ${colors.gray(
        `${progress} ${size} ${task.lastProgress.speed}`
      )}`
    );
  }

  if (task.lastError) {
    console.log(`           ${colors.gray("Error:")}  ${colors.red(task.lastError)}`);
  }

  if (task.status !== "completed") {
    console.log(`           ${colors.gray("Resume:")} ${colors.white(`visuales tasks resume ${task.id}`)}`);
  }
  if (task.status === "running") {
    console.log(`           ${colors.gray("Cancel:")} ${colors.white(`visuales tasks cancel ${task.id}`)}`);
  }
}

export async function clearAndPrintDownloadTasks(): Promise<void> {
  const clearedCount = await clearDownloadTasks();

  if (clearedCount === 0) {
    console.log(colors.yellow("No download tasks found."));
    return;
  }

  console.log(colors.green(`Cleared ${clearedCount} download task${clearedCount === 1 ? "" : "s"}.`));
}
