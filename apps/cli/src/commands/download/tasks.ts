import { formatDistanceToNow } from "date-fns";
import colors from "ansi-colors";
import { PROGRESS_BAR_COMPLETE, PROGRESS_BAR_INCOMPLETE } from "./progress-style.js";
import { formatSize } from "./utils.js";
import {
  type DownloadTaskStatus,
  type DownloadTaskInterruptedCause,
  type DownloadTaskRecord,
  listDownloadTasks,
  findDownloadTask,
  clearDownloadTasks,
  queueRank,
  compareQueueRank,
  getCompletedOverallProgress,
} from "@visuales/core/download/tasks";
export * from "@visuales/core/download/tasks";
const STATUS_BAR_WIDTH = 28;
function formatStatus(task: DownloadTaskRecord): string {
  if (task.status === "completed") return colors.green("completed");
  if (task.status === "running") return colors.cyan("running");
  if (task.status === "queued") return colors.magenta("queued");
  if (task.status === "failed") return colors.red("failed");
  return colors.yellow("interrupted");
}

function formatInterruptedCause(cause: DownloadTaskInterruptedCause | undefined): string {
  if (cause === "canceled") return "canceled by user";
  if (cause === "process-exited") return "process exited unexpectedly";
  if (cause === "signal") return "received interrupt signal";
  return "unknown cause";
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
  taskIds: string[];
}

interface CapturedOutput<T> {
  result: T;
  output: string;
}

interface PrintDownloadTaskProgressOptions {
  includeDetails?: boolean;
  fileNameWidth?: number;
  includeTarget?: boolean;
}

interface WatchInputMode {
  restore: () => void;
}

interface SelectedDownloadWatchTasks {
  visibleTasks: DownloadTaskRecord[];
  hiddenTasks: DownloadTaskRecord[];
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
const WATCH_HEADING_LINE_COUNT = 4;
const WATCH_FOOTER_LINE_COUNT = 2;
const WATCH_HIDDEN_SUMMARY_LINE_COUNT = 2;

function isActionableTask(task: DownloadTaskRecord): boolean {
  return task.status === "running" || task.status === "queued" || task.status === "interrupted";
}

function isLiveTask(task: DownloadTaskRecord): boolean {
  return task.status === "running" || task.status === "queued";
}

function compareWatchTaskOrder(a: DownloadTaskRecord, b: DownloadTaskRecord): number {
  const statusOrder = watchStatusRank(a) - watchStatusRank(b);
  if (statusOrder !== 0) return statusOrder;

  if (a.status === "queued" && b.status === "queued") {
    return compareQueueRank(queueRank(a), queueRank(b));
  }

  const aTime = a.createdAt || a.startedAt || 0;
  const bTime = b.createdAt || b.startedAt || 0;
  return bTime - aTime || a.id.localeCompare(b.id);
}

function watchStatusRank(task: DownloadTaskRecord): number {
  if (task.status === "queued") return 0;
  if (task.status === "interrupted") return 1;
  return 2;
}

export function selectDownloadWatchTasks(
  tasks: DownloadTaskRecord[],
  rows: number | undefined = process.stdout.rows
): SelectedDownloadWatchTasks {
  const sortedTasks = tasks.filter(isActionableTask).sort(compareWatchTaskOrder);
  const leadingTasks = sortedTasks.filter((task) => task.status !== "running");
  const runningTasks = sortedTasks.filter((task) => task.status === "running");
  if (!rows || rows <= 0) return { visibleTasks: [...leadingTasks, ...runningTasks], hiddenTasks: [] };

  const visibleLeadingTasks: DownloadTaskRecord[] = [];
  const visibleRunningTasks: DownloadTaskRecord[] = [];
  let remainingRows = Math.max(1, rows - WATCH_HEADING_LINE_COUNT - WATCH_FOOTER_LINE_COUNT);

  for (const [index, task] of runningTasks.entries()) {
    const hiddenRunningTasks = runningTasks.length - index - 1;
    const hiddenLeadingTasks = leadingTasks.length;
    const reservedRows = hiddenRunningTasks + hiddenLeadingTasks > 0 ? WATCH_HIDDEN_SUMMARY_LINE_COUNT : 0;
    const taskRows = estimateCompactWatchTaskLineCount(task);

    if (visibleRunningTasks.length > 0 && taskRows + reservedRows > remainingRows) {
      break;
    }

    visibleRunningTasks.push(task);
    remainingRows -= taskRows;
  }

  for (const [index, task] of leadingTasks.entries()) {
    const hiddenLeadingTasks = leadingTasks.length - index - 1;
    const hiddenRunningTasks = runningTasks.length - visibleRunningTasks.length;
    const reservedRows = hiddenLeadingTasks + hiddenRunningTasks > 0 ? WATCH_HIDDEN_SUMMARY_LINE_COUNT : 0;
    const taskRows = estimateCompactWatchTaskLineCount(task);

    if (visibleLeadingTasks.length + visibleRunningTasks.length > 0 && taskRows + reservedRows > remainingRows) {
      break;
    }

    visibleLeadingTasks.push(task);
    remainingRows -= taskRows;
  }

  const visibleTasks = [...visibleLeadingTasks, ...visibleRunningTasks];
  const visibleTaskIds = new Set(visibleTasks.map((task) => task.id));

  return {
    visibleTasks,
    hiddenTasks: sortedTasks.filter((task) => !visibleTaskIds.has(task.id)),
  };
}

function estimateCompactWatchTaskLineCount(task: DownloadTaskRecord): number {
  if (task.status === "queued") return 5;
  if (!task.lastProgress) return 5;

  let lineCount = 3;
  if (task.overallProgress) lineCount += 1;

  const activeFiles = task.status === "completed" ? [] : task.overallProgress?.activeFiles;
  if (activeFiles && activeFiles.length > 0) {
    lineCount += 1 + activeFiles.length;
  } else if (task.status !== "completed") {
    lineCount += 2;
  }

  if (task.status === "interrupted") lineCount += 1;
  return lineCount;
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
  const watchedTaskIds = new Set<string>();
  let shouldPrintSummary = false;
  let stopped = false;
  let wakeWatcher: (() => void) | undefined;
  const wake = (): void => {
    wakeWatcher?.();
  };
  const stopWatching = (): void => {
    stopped = true;
    shouldPrintSummary = true;
    wake();
  };

  process.once("SIGINT", stopWatching);
  process.on("SIGWINCH", wake);
  const inputMode = enterWatchInputMode(stopWatching);
  process.stdout.write(`${ANSI_ENTER_ALTERNATE_SCREEN}${ANSI_HIDE_CURSOR}`);

  try {
    while (!stopped) {
      const frame = await renderDownloadWatchFrame(idOrUrl, intervalMs);
      writeDownloadWatchFrame(frame.output);
      for (const taskId of frame.result.taskIds) {
        watchedTaskIds.add(taskId);
      }

      if (!frame.result.found) return false;
      if (!frame.result.shouldContinue || stopped) {
        shouldPrintSummary = true;
        return true;
      }
      await sleep(intervalMs, (wake) => {
        wakeWatcher = wake;
      });
      wakeWatcher = undefined;
    }

    return true;
  } finally {
    process.removeListener("SIGINT", stopWatching);
    process.removeListener("SIGWINCH", wake);
    inputMode?.restore();
    process.stdout.write(`${ANSI_SHOW_CURSOR}${ANSI_EXIT_ALTERNATE_SCREEN}`);
    if (shouldPrintSummary) {
      await printDownloadWatchSummary([...watchedTaskIds]);
    }
  }
}

function enterWatchInputMode(stopWatching: () => void): WatchInputMode | undefined {
  if (!process.stdin.isTTY) return undefined;

  const stdin = process.stdin;
  const wasRaw = stdin.isRaw;
  const onData = (data: Buffer): void => {
    if (data.includes(3)) {
      stopWatching();
    }
  };

  stdin.setRawMode(true);
  stdin.resume();
  stdin.on("data", onData);

  return {
    restore: () => {
      stdin.removeListener("data", onData);
      stdin.setRawMode(wasRaw);
      stdin.pause();
    },
  };
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
      return { found: false, shouldContinue: false, taskIds: [] };
    }

    printDownloadTaskProgress(task);
    return { found: true, shouldContinue: isLiveTask(task), taskIds: [task.id] };
  }

  const tasks = await listDownloadTasks();
  const displayedTasks = tasks.filter(isActionableTask);

  if (tasks.length === 0) {
    console.log(colors.yellow("No download tasks found."));
    return { found: true, shouldContinue: false, taskIds: [] };
  }

  if (displayedTasks.length === 0) {
    console.log(colors.yellow("No running or interrupted download tasks found."));
    console.log(colors.gray("Run `visuales tasks --all` to see completed and failed task history."));
    return { found: true, shouldContinue: false, taskIds: [] };
  }

  const { visibleTasks, hiddenTasks } = selectDownloadWatchTasks(tasks);

  for (const task of visibleTasks) {
    printDownloadWatchTaskProgress(task, { includeDetails: false, fileNameWidth: WATCH_MAX_FILE_NAME_WIDTH });
    console.log();
  }

  printHiddenWatchTasksSummary(hiddenTasks);

  return {
    found: true,
    shouldContinue: displayedTasks.some(isLiveTask),
    taskIds: displayedTasks.map((task) => task.id),
  };
}

function printHiddenWatchTasksSummary(tasks: DownloadTaskRecord[]): void {
  if (tasks.length === 0) return;

  const running = tasks.filter((task) => task.status === "running").length;
  const interrupted = tasks.filter((task) => task.status === "interrupted").length;
  const queued = tasks.filter((task) => task.status === "queued").length;
  const parts = [
    formatHiddenWatchTaskCount(running, "running"),
    formatHiddenWatchTaskCount(interrupted, "interrupted"),
    formatHiddenWatchTaskCount(queued, "queued"),
  ].filter((part) => part.length > 0);

  console.log(
    colors.gray(`... ${tasks.length} more task${tasks.length === 1 ? "" : "s"} hidden (${parts.join(", ")}).`)
  );
  console.log(colors.gray("Use `visuales tasks watch <id>` for a single task view."));
}

function formatHiddenWatchTaskCount(count: number, label: string): string {
  if (count === 0) return "";
  return `${count} ${label}`;
}

function printDownloadWatchTaskProgress(task: DownloadTaskRecord, options: PrintDownloadTaskProgressOptions): void {
  if (task.status === "queued") {
    printQueuedWatchTaskProgress(task, options);
    return;
  }

  printDownloadTaskProgress(task, options);
}

function printQueuedWatchTaskProgress(task: DownloadTaskRecord, options: PrintDownloadTaskProgressOptions): void {
  const updatedAge = formatDistanceToNow(new Date(task.updatedAt), { addSuffix: true });
  console.log(`${colors.cyan.bold(task.id)} ${formatStatus(task)} ${colors.gray(`updated ${updatedAge}`)}`);

  if (task.overallProgress) {
    printOverallTaskProgress(task);
    printCompactTaskSource(task, { ...options, includeTarget: false });
    const progressUpdatedAt = task.overallProgress.updatedAt || task.lastProgress?.updatedAt;
    if (progressUpdatedAt) {
      const progressAge = formatDistanceToNow(new Date(progressUpdatedAt), { addSuffix: true });
      console.log(`           ${colors.gray("Sample:")}   ${colors.gray(progressAge)}`);
    }
    return;
  }

  console.log(
    `           ${colors.gray("Progress:")} ${colors.yellow("Queued — will start when running downloads finish.")}`
  );
  printCompactTaskSource(task, options);
}

async function printDownloadWatchSummary(taskIds: string[]): Promise<void> {
  if (taskIds.length === 0) return;

  const tasks = await listDownloadTasks();
  const watchedTasks = taskIds
    .map((taskId) => tasks.find((task) => task.id === taskId))
    .filter((task): task is DownloadTaskRecord => Boolean(task));
  if (watchedTasks.length === 0) return;

  console.log(colors.blue.bold("\nDownload Watch Summary:"));
  console.log(colors.gray("──────────────────────────────────────────────────"));
  for (const line of buildDownloadWatchSummaryLines(watchedTasks)) {
    console.log(line);
  }
  printDownloadWatchResumeHint(watchedTasks);
}

function buildDownloadWatchSummaryLines(tasks: DownloadTaskRecord[]): string[] {
  const total = tasks.length;
  const completed = tasks.filter((task) => task.status === "completed").length;
  const failed = tasks.filter((task) => task.status === "failed").length;
  const running = tasks.filter((task) => task.status === "running").length;
  const queued = tasks.filter((task) => task.status === "queued").length;
  const canceled = tasks.filter((task) => task.status === "interrupted" && task.interruptedCause === "canceled").length;
  const processExited = tasks.filter(
    (task) => task.status === "interrupted" && task.interruptedCause === "process-exited"
  ).length;
  const signalInterrupted = tasks.filter(
    (task) => task.status === "interrupted" && task.interruptedCause === "signal"
  ).length;
  const unknownInterrupted = tasks.filter(
    (task) => task.status === "interrupted" && (!task.interruptedCause || task.interruptedCause === "unknown")
  ).length;

  return [
    formatWatchSummaryLine(completed, total, "completed", colors.green),
    formatWatchSummaryLine(failed, total, "failed", colors.red),
    formatWatchSummaryLine(processExited, total, "exited unexpectedly", colors.yellow),
    formatWatchSummaryLine(canceled, total, "canceled by user", colors.yellow),
    formatWatchSummaryLine(signalInterrupted, total, "interrupted by signal", colors.yellow),
    formatWatchSummaryLine(unknownInterrupted, total, "interrupted for unknown cause", colors.yellow),
    formatWatchSummaryLine(running, total, "still running", colors.cyan),
    formatWatchSummaryLine(queued, total, "queued", colors.magenta),
  ].filter((line) => line.length > 0);
}

function formatWatchSummaryLine(count: number, total: number, label: string, color: (value: string) => string): string {
  if (count === 0) return "";
  const taskLabel = count === 1 ? "task" : "tasks";
  return color(`${count}/${total} ${taskLabel} ${label}`);
}

function printDownloadWatchResumeHint(tasks: DownloadTaskRecord[]): void {
  const resumableTaskIds = tasks
    .filter((task) => task.status === "failed" || task.status === "interrupted")
    .map((task) => task.id);
  if (resumableTaskIds.length === 0) return;

  console.log();
  console.log(colors.gray("Resume unfinished tasks:"));
  console.log(colors.white(`visuales tasks resume ${resumableTaskIds.join(" ")} --detach`));
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
      task.status === "running"
        ? "Waiting for the first progress update..."
        : task.status === "queued"
          ? "Queued — will start when running downloads finish."
          : "No progress saved.";
    console.log(`           ${colors.gray("Progress:")} ${colors.yellow(waitingMessage)}`);
    if (includeDetails) {
      printDownloadTaskDetails(task, false);
    } else {
      // The compact watch view hides the full details, so a task with no progress yet (queued,
      // or just started) would be unidentifiable. Show what it will download.
      printCompactTaskSource(task, options);
    }
    return;
  }

  const progressAge = formatDistanceToNow(new Date(task.lastProgress.updatedAt), { addSuffix: true });

  printOverallTaskProgress(task);

  const activeFiles = task.status === "completed" ? [] : task.overallProgress?.activeFiles;
  if (activeFiles && activeFiles.length > 0) {
    console.log(
      `           ${colors.gray("Active:")}  ${colors.white(`${activeFiles.length} file${activeFiles.length === 1 ? "" : "s"}`)}`
    );
    for (const file of activeFiles) {
      printActiveFileProgress(file, options);
    }
  } else if (task.status !== "completed") {
    console.log(
      `           ${colors.gray("Last file:")} ${colors.white(formatDisplayFileName(task.lastProgress.fileName, options.fileNameWidth))}`
    );
    printActiveFileProgress(task.lastProgress, options);
  }

  console.log(`           ${colors.gray("Sample:")}   ${colors.gray(progressAge)}`);
  if (task.status === "interrupted" && !includeDetails) {
    printInterruptedCauseLine(task);
  }
  if (includeDetails) {
    printDownloadTaskDetails(task, false);
  }
}

function printOverallTaskProgress(task: DownloadTaskRecord): void {
  if (!task.overallProgress) return;

  const displayProgress = getDisplayOverallProgress(task.overallProgress, task.status);
  const overallPercent = clampPercentage(
    task.status === "completed" ? 100 : calculateOverallPercentage(displayProgress)
  );
  const overallBar = renderProgressBar(overallPercent);
  const overallDownloadedSize = formatSize(displayProgress.downloadedBytes);
  const overallTotalSize = displayProgress.totalBytes > 0 ? formatSize(displayProgress.totalBytes) : "unknown";

  console.log(
    `           ${colors.gray("Overall:")} ${overallBar} ${colors.bold.white(`${Math.floor(overallPercent)}%`)} ${colors.gray(
      `${overallDownloadedSize} / ${overallTotalSize}`
    )} ${colors.gray(`(${displayProgress.completedFiles}/${displayProgress.totalFiles} files)`)}`
  );
}

function printCompactTaskSource(task: DownloadTaskRecord, options: PrintDownloadTaskProgressOptions): void {
  const includeTarget = options.includeTarget ?? true;

  if (task.urls && task.urls.length > 1) {
    const first = formatDisplayFileName(task.urls[0], options.fileNameWidth);
    console.log(
      `           ${colors.gray("Source:")}   ${colors.white(`${task.urls.length} targets`)} ${colors.gray(first)}`
    );
  } else {
    console.log(
      `           ${colors.gray("Source:")}   ${colors.white(formatDisplayFileName(task.url, options.fileNameWidth))}`
    );
  }
  if (!includeTarget) return;

  console.log(
    `           ${colors.gray("Target:")}   ${colors.gray(formatDisplayFileName(task.output, options.fileNameWidth))}`
  );
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

function getDisplayOverallProgress(
  progress: NonNullable<DownloadTaskRecord["overallProgress"]>,
  status: DownloadTaskStatus
): NonNullable<DownloadTaskRecord["overallProgress"]> {
  if (status === "completed") {
    return getCompletedOverallProgress(progress);
  }

  const activeRemainingBytes = (progress.activeFiles ?? []).reduce(
    (sum, file) => sum + Math.max((file.totalSize || 0) - file.downloadedSize, 0),
    0
  );

  if (activeRemainingBytes <= 0 || progress.totalBytes <= 0) {
    return progress;
  }

  const totalBytes = Math.max(progress.totalBytes, progress.downloadedBytes + activeRemainingBytes);
  return {
    ...progress,
    downloadedBytes: Math.min(progress.downloadedBytes, totalBytes),
    totalBytes,
  };
}

function calculateOverallPercentage(progress: NonNullable<DownloadTaskRecord["overallProgress"]>): number {
  if (progress.totalBytes > 0) {
    const bytePercentage = (Math.min(progress.downloadedBytes, progress.totalBytes) / progress.totalBytes) * 100;

    if ((progress.activeFiles?.length ?? 0) > 0 || progress.completedFiles < progress.totalFiles) {
      return Math.min(bytePercentage, 99.9);
    }

    return bytePercentage;
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
  if (task.status === "interrupted") {
    printInterruptedCauseLine(task);
  }

  if (task.status === "failed" || task.status === "interrupted") {
    console.log(`           ${colors.gray("Resume:")} ${colors.white(`visuales tasks resume ${task.id}`)}`);
  }
  if (isLiveTask(task)) {
    console.log(`           ${colors.gray("Cancel:")} ${colors.white(`visuales tasks cancel ${task.id}`)}`);
  }
}

function printInterruptedCauseLine(task: DownloadTaskRecord): void {
  console.log(
    `           ${colors.gray("Interrupted:")} ${colors.yellow(formatInterruptedCause(task.interruptedCause))}`
  );
}

export async function clearAndPrintDownloadTasks(): Promise<void> {
  const clearedCount = await clearDownloadTasks();

  if (clearedCount === 0) {
    console.log(colors.yellow("No download tasks found."));
    return;
  }

  console.log(colors.green(`Cleared ${clearedCount} download task${clearedCount === 1 ? "" : "s"}.`));
}
