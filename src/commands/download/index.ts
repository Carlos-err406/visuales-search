import { Command } from "commander";
import colors from "ansi-colors";
import { downloadUrl, stopProgress } from "./downloader.js";
import { DownloadOptions } from "./types.js";
import { CONFIG } from "../../lib/types.js";
import { ensureDownloadCacheDirectory, resolveSearchAlias } from "../../lib/cache.js";
import path from "path";
import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import {
  cancelDownloadTask,
  clearAndPrintDownloadTasks,
  completeDownloadTask,
  failDownloadTask,
  findDownloadTask,
  createDownloadTaskId,
  getDownloadTaskLogPath,
  interruptDownloadTask,
  printDownloadTasks,
  startDownloadTask,
  startDownloadTaskWithPid,
  updateDownloadTaskProgress,
} from "./tasks.js";

// Helper functions for Download
export function printDownloadUsage(): void {
  console.log(colors.yellow("Usage: visuales download <url> [--output <path>] [options]"));
  console.log(colors.gray("Examples:"));
  console.log(
    colors.gray(
      '  visuales download "https://visuales.uclv.cu/Series/Ingles/Killing%20Eve/libros/1.pdf" --output ./downloads'
    )
  );
  console.log(
    colors.gray(
      '  visuales download "https://visuales.uclv.cu/Series/Ingles/Killing%20Eve/libros/" --output ./killing-eve-books --concurrent 5 --connections 3'
    )
  );
  console.log(colors.gray('  visuales download "https://visuales.uclv.cu/Series/Ingles/Killing%20Eve/libros/"'));
}

export function printDownloading(url: string, outputPath: string, cacheDir: string): void {
  const line = colors.gray("─".repeat(50));
  console.log(line);
  console.log(`${colors.cyan("●")} ${colors.bold.white("VISUALES DOWNLOADER")}`);
  console.log(line);
  console.log(`${colors.gray("Source:")}  ${colors.white(url)}`);
  console.log(`${colors.gray("Target:")}  ${colors.white(path.resolve(outputPath))}`);
  console.log(`${colors.gray("Cache:")}   ${colors.white(path.resolve(cacheDir))}`);
  console.log(line);
  console.log();
}

export function printError(error: unknown): void {
  console.error(colors.bold.red("\n[ERROR]"));
  console.error(colors.red(formatErrorMessage(error)));
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof AggregateError) {
    const errors = error.errors
      .map((nestedError) => formatErrorMessage(nestedError))
      .filter(Boolean)
      .join("\n");

    return [error.message, errors].filter(Boolean).join("\n") || "Multiple errors occurred";
  }

  if (error instanceof Error) {
    const code = "code" in error && typeof error.code === "string" ? `${error.code}: ` : "";

    return `${code}${error.message || error.name}`;
  }

  return String(error);
}

export async function downloadCommand(
  url: string,
  options: {
    output?: string;
    resume?: boolean | string;
    maxRetries?: number | string;
    timeout?: number | string;
    concurrent?: number | string;
    connections?: number | string;
    compact?: boolean;
    detach?: boolean;
    exclude?: string[];
    ignore?: string[];
    verbose?: boolean;
  }
): Promise<void> {
  if (!url) {
    console.log(colors.yellow("Please provide a URL to download"));
    printDownloadUsage();
    return;
  }

  const resolvedUrl = await resolveSearchAlias(url);
  if (resolvedUrl !== url) {
    console.log(colors.gray(`Resolved ${url} to ${resolvedUrl}`));
  }

  const downloadOptions: DownloadOptions = {
    output: options.output ?? getDefaultOutputPath(resolvedUrl),
    resume: parseBooleanOption(options.resume, true),
    maxRetries: parseNumberOption(options.maxRetries, 3),
    timeout: parseNumberOption(options.timeout, Infinity),
    concurrent: parseNumberOption(options.concurrent, 5),
    connections: parseNumberOption(options.connections, 3),
    compact: options.compact ?? false,
    exclude: [...(options.exclude ?? []), ...(options.ignore ?? [])],
    verbose: options.verbose,
  };

  if (options.detach) {
    await startDetachedDownload(resolvedUrl, downloadOptions);
    return;
  }

  printDownloading(resolvedUrl, downloadOptions.output, CONFIG.CACHE_DIR);
  const task = await startDownloadTask(resolvedUrl, downloadOptions);
  const removeInterruptHandler = registerInterruptHandler(task.id);

  try {
    await downloadUrl(resolvedUrl, downloadOptions, (progress) => {
      void updateDownloadTaskProgress(task.id, progress);
    });
    await stopProgress();
    await completeDownloadTask(task.id);
    console.log(colors.bold.green("\n[SUCCESS] All downloads finished successfully!"));
    console.log(colors.gray(`Task ${task.id} completed.`));
  } catch (error) {
    await stopProgress();
    await failDownloadTask(task.id, error);
    printError(error);
    process.exit(1);
  } finally {
    removeInterruptHandler();
  }
}

async function startDetachedDownload(url: string, options: DownloadOptions): Promise<void> {
  const id = createDownloadTaskId(url, options.output);
  const logFile = getDownloadTaskLogPath(id);
  await ensureDownloadCacheDirectory();
  const out = openSync(logFile, "a");
  const childArgs = [process.argv[1], ...buildGlobalArgs(options), "download", url, ...buildDownloadArgs(options)];
  const child = spawn(process.execPath, childArgs, {
    detached: true,
    stdio: ["ignore", out, out],
    env: process.env,
    cwd: process.cwd(),
  });
  closeSync(out);

  child.unref();

  if (!child.pid) {
    throw new Error("Could not start detached download process.");
  }

  await startDownloadTaskWithPid(url, options, child.pid, logFile);

  console.log(colors.green(`Detached download started as task ${id}.`));
  console.log(colors.gray(`PID: ${child.pid}`));
  console.log(colors.gray(`Progress: visuales tasks`));
  console.log(colors.gray(`Cancel:   visuales tasks cancel ${id}`));
  console.log(colors.gray(`Log:      ${logFile}`));
}

function buildGlobalArgs(options: DownloadOptions): string[] {
  return options.verbose ? ["--verbose"] : [];
}

function buildDownloadArgs(options: DownloadOptions): string[] {
  const args = [
    "--output",
    options.output,
    "--resume",
    String(options.resume),
    "--max-retries",
    String(options.maxRetries),
    "--timeout",
    Number.isFinite(options.timeout) ? String(options.timeout) : "Infinity",
    "--concurrent",
    String(options.concurrent),
    "--connections",
    String(options.connections),
  ];

  if (options.compact) args.push("--compact");
  for (const pattern of options.exclude) {
    args.push("--exclude", pattern);
  }

  return args;
}

function getDefaultOutputPath(url: string): string {
  const parsedUrl = new URL(url);
  const pathname = parsedUrl.pathname;

  if (!pathname.endsWith("/")) {
    return process.cwd();
  }

  const trimmedPathname = pathname.replace(/\/+$/, "");
  const targetName = decodePathSegment(path.basename(trimmedPathname));

  return targetName ? path.join(process.cwd(), targetName) : process.cwd();
}

function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function parseBooleanOption(value: boolean | string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  if (typeof value === "boolean") return value;
  return !["false", "0", "no", "off"].includes(value.toLowerCase());
}

function parseNumberOption(value: number | string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  if (typeof value === "number") return value;
  if (value === "Infinity") return Infinity;

  const parsed = parseInt(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function registerInterruptHandler(taskId: string): () => void {
  const handler = () => {
    void (async () => {
      await stopProgress();
      await interruptDownloadTask(taskId);
      console.log(colors.yellow(`\nDownload interrupted. Resume with: visuales tasks resume ${taskId}`));
      process.exit(130);
    })();
  };

  process.once("SIGINT", handler);
  process.once("SIGTERM", handler);

  return () => {
    process.removeListener("SIGINT", handler);
    process.removeListener("SIGTERM", handler);
  };
}

export async function resumeCommand(
  idOrUrl: string,
  options: {
    detach?: boolean;
    verbose?: boolean;
  }
): Promise<void> {
  const task = await findDownloadTask(idOrUrl);
  if (!task) {
    console.error(colors.red(`No download task found for '${idOrUrl}'.`));
    console.log(colors.gray("Run `visuales tasks` to see resumable downloads."));
    process.exit(1);
  }

  if (task.status === "completed") {
    console.log(colors.yellow(`Task ${task.id} is already completed.`));
    return;
  }

  await downloadCommand(task.url, {
    ...task.options,
    resume: true,
    detach: options.detach,
    verbose: options.verbose ?? task.options.verbose,
  });
}

async function tasksCommand(options: { all?: boolean; clear?: boolean }): Promise<void> {
  if (options.clear) {
    await clearAndPrintDownloadTasks();
    return;
  }

  await printDownloadTasks({ all: options.all });
}

export async function cancelCommand(idOrUrl: string): Promise<void> {
  const task = await cancelDownloadTask(idOrUrl);
  if (!task) {
    console.error(colors.red(`No download task found for '${idOrUrl}'.`));
    console.log(colors.gray("Run `visuales tasks` to see running downloads."));
    process.exit(1);
  }

  console.log(colors.yellow(`Canceled task ${task.id}.`));
  console.log(colors.gray(`Resume with: visuales tasks resume ${task.id}`));
}

export function setupDownloadCommand(program: Command): void {
  const download = program
    .command("download")
    .description("Download files or directories from visuales.uclv.cu")
    .argument("<url>", "URL to download (file or directory)")
    .option("-o, --output <path>", "Output directory")
    .option("-r, --resume <boolean>", "Resume interrupted downloads", true)
    .option("--max-retries <number>", "Maximum retry attempts", "3")
    .option("--timeout <number>", "Request timeout in seconds (Infinity for no timeout)", "Infinity")
    .option("-c, --concurrent <number>", "Maximum concurrent downloads", "5")
    .option("--connections <number>", "Parallel connections per file", "3")
    .option("--compact", "Hide individual thread details (default: false)")
    .option("-d, --detach", "Run the download in the background")
    .option("--exclude <patterns...>", 'Exclude files by glob, e.g. --exclude "*.{jpg,nfo}"')
    .option("--ignore <patterns...>", "Alias for --exclude")
    .action((url, options, cmd) => {
      // In subcommands, options is from command, but we need program for global options
      const globalOpts = cmd.parent.opts();
      return downloadCommand(url, { ...options, verbose: globalOpts.verbose });
    });

  download
    .command("tasks", { hidden: true })
    .description("Alias for visuales tasks")
    .option("-a, --all", "Show completed and failed task history")
    .option("--clear", "Clear saved download task history")
    .action(tasksCommand);

  download
    .command("resume", { hidden: true })
    .description("Alias for visuales tasks resume")
    .argument("<task>", "Task id or URL")
    .option("-d, --detach", "Run the resumed download in the background")
    .action((idOrUrl, options, cmd) => {
      const globalOpts = cmd.parent.parent.opts();
      return resumeCommand(idOrUrl, { detach: options.detach, verbose: globalOpts.verbose });
    });

  download
    .command("cancel", { hidden: true })
    .description("Alias for visuales tasks cancel")
    .argument("<task>", "Task id or URL")
    .action(cancelCommand);
}
