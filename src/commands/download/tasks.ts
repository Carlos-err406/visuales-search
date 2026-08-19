import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { formatDistanceToNow } from "date-fns";
import colors from "ansi-colors";
import { ensureDownloadCacheDirectory } from "../../lib/cache.js";
import { CONFIG } from "../../lib/types.js";
import { PROGRESS_BAR_COMPLETE, PROGRESS_BAR_INCOMPLETE } from "./progress-style.js";
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

interface WatchDownloadTasksOptions {
  interval?: number | string;
}

interface DownloadWatchFrameResult {
  found: boolean;
  shouldContinue: boolean;
}

interface CapturedOutput<T> {
  result: T;
  output: string;
}

interface PrintDownloadTaskProgressOptions {
  includeDetails?: boolean;
  fileNameWidth?: number;
}

const ANSI_CLEAR_SCREEN = "\x1B[2J";
const ANSI_CLEAR_TO_END = "\x1B[J";
const ANSI_CURSOR_HOME = "\x1B[H";
const ANSI_HIDE_CURSOR = "\x1B[?25l";
const ANSI_SHOW_CURSOR = "\x1B[?25h";
const ANSI_ENTER_ALTERNATE_SCREEN = "\x1B[?1049h";
const ANSI_EXIT_ALTERNATE_SCREEN = "\x1B[?1049l";
const WATCH_MAX_FILE_NAME_WIDTH = 72;
const WATCH_MIN_FILE_NAME_WIDTH = 12;

function isActionableTask(task: DownloadTaskRecord): boolean {
  return task.status === "running" || task.status === "interrupted";
}

function compareWatchTaskOrder(a: DownloadTaskRecord, b: DownloadTaskRecord): number {
  const aTime = a.createdAt || a.startedAt || 0;
  const bTime = b.createdAt || b.startedAt || 0;
  return bTime - aTime || a.id.localeCompare(b.id);
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

export async function watchDownloadTasks(idOrUrl?: string, options: WatchDownloadTasksOptions = {}): Promise<boolean> {
  const intervalMs = parseWatchIntervalMs(options.interval);
  let stopped = false;
  let wakeWatcher: (() => void) | undefined;
  const wake = (): void => {
    wakeWatcher?.();
  };
  const stopWatching = (): void => {
    stopped = true;
    wake();
  };

  process.once("SIGINT", stopWatching);
  process.on("SIGWINCH", wake);
  process.stdout.write(`${ANSI_ENTER_ALTERNATE_SCREEN}${ANSI_HIDE_CURSOR}`);

  try {
    while (!stopped) {
      const frame = await renderDownloadWatchFrame(idOrUrl, intervalMs);
      writeDownloadWatchFrame(frame.output);

      if (!frame.result.found) return false;
      if (!frame.result.shouldContinue || stopped) return true;
      await sleep(intervalMs, (wake) => {
        wakeWatcher = wake;
      });
      wakeWatcher = undefined;
    }

    return true;
  } finally {
    process.removeListener("SIGINT", stopWatching);
    process.removeListener("SIGWINCH", wake);
    process.stdout.write(`${ANSI_SHOW_CURSOR}${ANSI_EXIT_ALTERNATE_SCREEN}`);
  }
}

async function renderDownloadWatchFrame(
  idOrUrl: string | undefined,
  intervalMs: number
): Promise<CapturedOutput<DownloadWatchFrameResult>> {
  return captureConsoleOutput(async () => {
    const frame = await printDownloadWatchFrame(idOrUrl);
    printDownloadWatchFooter(intervalMs);
    return frame;
  });
}

function writeDownloadWatchFrame(output: string): void {
  process.stdout.write(`${ANSI_CLEAR_SCREEN}${ANSI_CURSOR_HOME}${output}${ANSI_CLEAR_TO_END}`);
}

async function captureConsoleOutput<T>(callback: () => Promise<T>): Promise<CapturedOutput<T>> {
  const originalLog = console.log;
  const originalError = console.error;
  const lines: string[] = [];
  const appendLine = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };

  console.log = appendLine;
  console.error = appendLine;

  try {
    const result = await callback();
    return { result, output: lines.length > 0 ? `${lines.join("\n")}\n` : "" };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

async function printDownloadWatchFrame(idOrUrl: string | undefined): Promise<DownloadWatchFrameResult> {
  printDownloadWatchHeading(idOrUrl);

  if (idOrUrl) {
    const task = await findDownloadTask(idOrUrl);
    if (!task) {
      console.error(colors.red(`No download task found for '${idOrUrl}'.`));
      console.log(colors.gray("Run `visuales tasks` to see known tasks."));
      return { found: false, shouldContinue: false };
    }

    printDownloadTaskProgress(task);
    return { found: true, shouldContinue: task.status === "running" };
  }

  const tasks = await listDownloadTasks();
  const displayedTasks = tasks.filter(isActionableTask).sort(compareWatchTaskOrder);

  if (tasks.length === 0) {
    console.log(colors.yellow("No download tasks found."));
    return { found: true, shouldContinue: false };
  }

  if (displayedTasks.length === 0) {
    console.log(colors.yellow("No running or interrupted download tasks found."));
    console.log(colors.gray("Run `visuales tasks --all` to see completed and failed task history."));
    return { found: true, shouldContinue: false };
  }

  for (const task of displayedTasks) {
    printDownloadTaskProgress(task, { includeDetails: false, fileNameWidth: WATCH_MAX_FILE_NAME_WIDTH });
    console.log();
  }

  return { found: true, shouldContinue: displayedTasks.some((task) => task.status === "running") };
}

function printDownloadWatchHeading(idOrUrl: string | undefined): void {
  const scope = idOrUrl ? `Task: ${idOrUrl}` : "Scope: running and interrupted tasks";
  console.log(colors.blue.bold("\nDownload Watch:"));
  console.log(colors.gray("──────────────────────────────────────────────────"));
  console.log(`${colors.gray(scope)} ${colors.gray(`refreshed ${new Date().toLocaleTimeString()}`)}`);
  console.log();
}

function printDownloadWatchFooter(intervalMs: number): void {
  console.log(colors.gray("──────────────────────────────────────────────────"));
  console.log(colors.gray(`Refreshing every ${intervalMs / 1000}s. Press Ctrl-C to stop watching.`));
}

function parseWatchIntervalMs(interval: number | string | undefined): number {
  const seconds = interval === undefined ? 2 : Number(interval);
  const safeSeconds = Number.isFinite(seconds) ? Math.max(1, seconds) : 2;
  return safeSeconds * 1000;
}

async function sleep(ms: number, registerWake?: (wake: () => void) => void): Promise<void> {
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, ms);
    registerWake?.(() => {
      clearTimeout(timeout);
      resolve(undefined);
    });
  });
}

function printDownloadTaskProgress(task: DownloadTaskRecord, options: PrintDownloadTaskProgressOptions = {}): void {
  const includeDetails = options.includeDetails ?? true;
  const updatedAge = formatDistanceToNow(new Date(task.updatedAt), { addSuffix: true });
  console.log(`${colors.cyan.bold(task.id)} ${formatStatus(task)} ${colors.gray(`updated ${updatedAge}`)}`);

  if (!task.lastProgress) {
    const waitingMessage =
      task.status === "running" ? "Waiting for the first progress update..." : "No progress saved.";
    console.log(`           ${colors.gray("Progress:")} ${colors.yellow(waitingMessage)}`);
    if (includeDetails) {
      printDownloadTaskDetails(task, false);
    }
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
      printActiveFileProgress(file, options);
    }
  } else {
    console.log(
      `           ${colors.gray("Last file:")} ${colors.white(formatDisplayFileName(task.lastProgress.fileName, options.fileNameWidth))}`
    );
    printActiveFileProgress(task.lastProgress, options);
  }

  console.log(`           ${colors.gray("Sample:")}   ${colors.gray(progressAge)}`);
  if (includeDetails) {
    printDownloadTaskDetails(task, false);
  }
}

function printActiveFileProgress(
  file: {
    fileName: string;
    progress: number;
    downloadedSize: number;
    totalSize: number;
    speed: string;
  },
  options: PrintDownloadTaskProgressOptions = {}
): void {
  const filePercent = clampPercentage(file.progress);
  const fileDownloadedSize = formatSize(file.downloadedSize);
  const fileTotalSize = file.totalSize > 0 ? formatSize(file.totalSize) : "unknown";
  const percent = `${Math.floor(filePercent)}%`;
  const size = `${fileDownloadedSize} / ${fileTotalSize}`;
  const fileBar = renderProgressBar(filePercent);
  const fileNameWidth = calculateFileNameWidth(file.speed, percent, size, options.fileNameWidth);
  const fileName = formatDisplayFileName(file.fileName, fileNameWidth);

  console.log(
    `           ${colors.gray("File:")}    ${fileBar} ${colors.bold.white(percent)} ${colors.gray(size)} ${colors.white(
      fileName
    )} ${colors.gray(file.speed)}`
  );
}

function calculateFileNameWidth(
  speed: string,
  percent: string,
  size: string,
  requestedWidth: number | undefined
): number | undefined {
  if (!requestedWidth) return undefined;

  const columns = process.stdout.columns;
  if (!columns) return requestedWidth;

  const prefixWidth = "           File:    ".length;
  const barWidth = STATUS_BAR_WIDTH + 2;
  const fixedWidth = prefixWidth + barWidth + 1 + percent.length + 1 + size.length + 1 + 1 + speed.length;
  const availableWidth = columns - fixedWidth - 1;
  return Math.max(WATCH_MIN_FILE_NAME_WIDTH, Math.min(requestedWidth, availableWidth));
}

function formatDisplayFileName(fileName: string, width: number | undefined): string {
  if (!width) return fileName;
  return truncateMiddle(fileName, width);
}

function truncateMiddle(value: string, width: number): string {
  if (value.length <= width) return value;
  if (width <= 3) return value.slice(0, width);

  const headLength = Math.ceil((width - 3) / 2);
  const tailLength = Math.floor((width - 3) / 2);
  return `${value.slice(0, headLength)}...${value.slice(-tailLength)}`;
}

function renderProgressBar(percent: number): string {
  const completed = Math.round((percent / 100) * STATUS_BAR_WIDTH);
  const bar = `${PROGRESS_BAR_COMPLETE.repeat(completed)}${PROGRESS_BAR_INCOMPLETE.repeat(
    STATUS_BAR_WIDTH - completed
  )}`;
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
