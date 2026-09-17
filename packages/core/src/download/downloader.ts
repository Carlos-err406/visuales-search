import { logger } from "../logger.js";
import EasyDl from "easydl";
import { AsyncLocalStorage } from "node:async_hooks";
import { clean as cleanDownloadParts } from "easydl/dist/utils.js";
import { execFile } from "node:child_process";
import path from "path";
import fs from "fs/promises";
import colors from "ansi-colors";
import pLimit from "p-limit";
import { DownloadOptions, DownloadProgress, type DownloadActiveFileProgress } from "./types.js";
import { formatSize } from "./utils.js";
import { parseDirectoryListing } from "../library-listing.js";
import { fileIndexGeneration, publishIndexedDirectory } from "../search-file-index.js";
import { createIgnoreMatcher } from "./ignore-rules.js";
import { reportDownloadFile, recordedFileCompletion, FILE_VERIFICATION_VERSION } from "./file-details.js";
import {
  dirListingCache,
  getCachedFileSizeInfo,
  loadDiscoveryCache,
  saveDiscoveryCache,
  updateCachedFileSize,
  type DirectoryListing,
} from "./discovery-cache.js";
import { DOWNLOAD_USER_AGENT, type ExpectedFileSize, fetchExpectedFileSize } from "./http.js";
import { getExistingFileState, getFileSize, isUnavailablePageFile } from "./file-state.js";
import { downloadWithFetch, type FetchDownloadProgress } from "./fetch-download.js";
import { clearParallelParts, parallelBytesOnDisk } from "./parallel-download.js";
import { probeRemoteCompletion, verifyDownloadedFile, type VerifyDownloadResult } from "./verify.js";
import { reconcileExistingFile } from "./reconcile.js";
import {
  progressBars,
  createDownloadBar,
  createDownloadBarPayload,
  createFileCountBar,
  logDownloadComplete,
  logDownloadSkipped,
  resetDownloadBar,
  decrementActiveDownloads,
  incrementActiveDownloads,
  updateFileCountBar,
} from "./ui.js";

const downloadSession = new AsyncLocalStorage<Set<string>>();
const SMALL_FILE_SINGLE_CONNECTION_THRESHOLD = 10 * 1024 * 1024;
const PARTS_DIRECTORY_NAME = ".visuales-parts";
const NODE_MAJOR_VERSION = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);

interface DownloadFailure {
  filePath: string;
  error: string;
}

interface DownloadPlanSummary {
  fileCount: number;
  totalBytes: number;
  hasSizeInfo: boolean;
  isEstimate: boolean;
  localFiles: Map<string, { completed: boolean; bytes: number; expectedSize: number }>;
}

export interface DownloadTarget {
  url: string;
  output: string;
  relativePath: string;
}

interface FileCountProgress {
  totalFiles: number;
  completedFiles: number;
  totalBytes: number;
  completedBytes: number;
  localFiles: DownloadPlanSummary["localFiles"];
  pendingBytes: Map<string, number>;
  activeBytes: Map<string, number>;
  activeSpeeds: Map<string, number>;
  activeFiles: Map<string, DownloadActiveFileProgress>;
  freeSlots: number[];
  nextSlot: number;
  bar: ReturnType<typeof createFileCountBar>;
  slotBars: ReturnType<typeof createDownloadBar>[];
}

function formatDownloadFailures(failures: DownloadFailure[]): string {
  const systemicError = getSystemicFailureMessage(failures);
  if (systemicError) {
    return systemicError;
  }

  const shownFailures = failures
    .slice(0, 10)
    .map((failure) => `- ${failure.filePath}: ${failure.error}`)
    .join("\n");
  const remainingCount = failures.length - 10;
  const suffix = remainingCount > 0 ? `\n...and ${remainingCount} more.` : "";

  return `${failures.length} download${failures.length === 1 ? "" : "s"} failed:\n${shownFailures}${suffix}`;
}

function getSystemicFailureMessage(failures: DownloadFailure[]): string | null {
  if (failures.length < 2) return null;

  const failureCounts = new Map<string, number>();
  for (const failure of failures) {
    failureCounts.set(failure.error, (failureCounts.get(failure.error) ?? 0) + 1);
  }

  const [commonError, commonCount] = [...failureCounts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
  if (!commonError || commonCount < Math.max(2, Math.ceil(failures.length * 0.75))) return null;

  if (commonError.includes("getaddrinfo ENOTFOUND")) {
    return `Could not resolve visuales.uclv.cu while downloading ${failures.length} files. Check your DNS/network connection and retry when the host resolves.`;
  }

  return `${failures.length} downloads failed with the same error:\n${commonError}`;
}

function getLegacyConnectionCount(options: DownloadOptions, expectedSize?: number): number {
  if (expectedSize && expectedSize <= SMALL_FILE_SINGLE_CONNECTION_THRESHOLD) {
    return 1;
  }

  return Math.max(1, options.connections);
}

function usesNativeFetchDownloader(): boolean {
  return NODE_MAJOR_VERSION >= 20;
}

function isExistingFileComplete(existingSize: number, expectedSize: ExpectedFileSize): boolean {
  if (!expectedSize.size || !expectedSize.exact) return false;

  return existingSize === expectedSize.size;
}

function hidePartsDirectory(directory: string): void {
  if (process.platform === "darwin") {
    execFile("chflags", ["hidden", directory], () => {});
  } else if (process.platform === "win32") {
    execFile("attrib", ["+h", directory], () => {});
  }
}

async function removePartsDirectoryIfEmpty(directory: string): Promise<void> {
  try {
    const entries = await fs.readdir(directory);
    if (entries.length === 0) {
      await fs.rmdir(directory);
    }
  } catch {
    // Keep the sidecar directory when other downloads still have active or resumable parts.
  }
}

async function cleanFileDownloadParts(filePath: string): Promise<void> {
  await clearParallelParts(filePath);
  try {
    await cleanDownloadParts(filePath);
  } catch {
    // Missing parts directories are fine; there may simply be no resumable sidecars to remove.
  }
}

function logFileNotice(filename: string, message: string): void {
  progressBars.log(`${colors.gray("·")} ${colors.bold.white(filename)} ${colors.yellow(`(${message})`)}\n`);
}

/**
 * Moves a verified download out of the parts directory. The destination is removed first so the
 * rename also succeeds on Windows, where renaming onto an existing file throws.
 */
async function promoteDownloadedFile(tempPath: string, finalPath: string): Promise<void> {
  await fs.rm(finalPath, { force: true });
  await fs.rename(tempPath, finalPath);
  await cleanFileDownloadParts(tempPath);
}

function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function getUrlBasename(url: string): string {
  try {
    return path.basename(new URL(url).pathname);
  } catch {
    return path.basename(url);
  }
}

function getDecodedUrlBasename(url: string): string {
  return decodePathSegment(getUrlBasename(url));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;

  if ("code" in error && typeof error.code === "string") {
    return error.code;
  }

  if ("cause" in error) {
    return getErrorCode(error.cause);
  }

  return undefined;
}

function isTransientDownloadError(error: Error): boolean {
  const code = getErrorCode(error);
  if (
    code &&
    [
      "ECONNRESET",
      "ECONNABORTED",
      "ENETRESET",
      "EPIPE",
      "ETIMEDOUT",
      "ECONNREFUSED",
      "ENETUNREACH",
      "EHOSTUNREACH",
      "EAI_AGAIN",
      "ENOTFOUND",
      "UND_ERR_SOCKET",
      "UND_ERR_CONNECT_TIMEOUT",
      "UND_ERR_HEADERS_TIMEOUT",
      "UND_ERR_BODY_TIMEOUT",
      "ERR_DOWNLOAD_RETRYABLE",
    ].includes(code)
  ) {
    return true;
  }

  if (error.name === "TimeoutError") return true;

  return /ECONNRESET|EPIPE|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|aborted|terminated|read timed out|socket hang up|network timeout/i.test(
    error.message
  );
}

function updateOverallDownloadProgress(progress: FileCountProgress): void {
  const activeBytes = [...progress.pendingBytes.values(), ...progress.activeBytes.values()].reduce(
    (sum, bytes) => sum + bytes,
    0
  );
  const activeSpeed = [...progress.activeSpeeds.values()].reduce((sum, bytesPerSecond) => sum + bytesPerSecond, 0);
  const activeTotalBytes = [...progress.activeFiles.values()].reduce(
    (sum, file) => sum + (file.totalSize > 0 ? file.totalSize : file.downloadedSize),
    0
  );
  const totalBytes = Math.max(progress.totalBytes, progress.completedBytes + activeTotalBytes);

  updateFileCountBar(
    progress.bar,
    progress.completedFiles,
    progress.totalFiles,
    Math.min(progress.completedBytes + activeBytes, totalBytes),
    totalBytes,
    activeSpeed
  );
}

function getOverallDownloadProgress(progress: FileCountProgress): DownloadProgress["overall"] {
  const activeBytes = [...progress.pendingBytes.values(), ...progress.activeBytes.values()].reduce(
    (sum, bytes) => sum + bytes,
    0
  );
  const activeSpeed = [...progress.activeSpeeds.values()].reduce((sum, bytesPerSecond) => sum + bytesPerSecond, 0);
  const activeTotalBytes = [...progress.activeFiles.values()].reduce(
    (sum, file) => sum + (file.totalSize > 0 ? file.totalSize : file.downloadedSize),
    0
  );
  const totalBytes = Math.max(progress.totalBytes, progress.completedBytes + activeTotalBytes);

  return {
    completedFiles: progress.completedFiles,
    totalFiles: progress.totalFiles,
    downloadedBytes: Math.min(progress.completedBytes + activeBytes, totalBytes),
    totalBytes,
    speedBytes: activeSpeed,
    activeFiles: [...progress.activeFiles.values()],
  };
}

function createFileCountProgressState(summary: DownloadPlanSummary, concurrent: number): FileCountProgress {
  const completed = [...summary.localFiles.values()].filter((file) => file.completed);
  return {
    totalFiles: summary.fileCount,
    completedFiles: completed.length,
    totalBytes: summary.totalBytes,
    completedBytes: completed.reduce((sum, file) => sum + file.bytes, 0),
    localFiles: summary.localFiles,
    pendingBytes: new Map(
      [...summary.localFiles].filter(([, file]) => !file.completed).map(([url, file]) => [url, file.bytes])
    ),
    activeBytes: new Map<string, number>(),
    activeSpeeds: new Map<string, number>(),
    activeFiles: new Map(),
    freeSlots: Array.from({ length: concurrent }, (_, index) => index + 1),
    nextSlot: concurrent + 1,
    bar: createFileCountBar(summary.fileCount),
    slotBars: [] as ReturnType<typeof createDownloadBar>[],
  };
}

function acquireDownloadSlot(progress?: FileCountProgress): number {
  if (!progress) return 1;

  const reusableSlot = progress.freeSlots.shift();
  if (reusableSlot) return reusableSlot;

  const slot = progress.nextSlot;
  progress.nextSlot++;
  return slot;
}

function releaseDownloadSlot(progress: FileCountProgress | undefined, slot: number): void {
  if (!progress) return;

  if (progress.freeSlots.includes(slot)) return;
  progress.freeSlots.push(slot);
  progress.freeSlots.sort((a, b) => a - b);
}

function isLateDestroyedStreamError(error: Error): boolean {
  return /destroyed|ERR_STREAM_DESTROYED|premature close/i.test(error.message);
}

export async function downloadFile(
  url: string,
  options: DownloadOptions,
  onProgress?: (progress: DownloadProgress) => void,
  expectedSize?: number,
  slot: number = 1,
  slotBar?: ReturnType<typeof createDownloadBar>
): Promise<void> {
  const downloadedUrls = downloadSession.getStore();
  if (downloadedUrls?.has(url)) return;
  downloadedUrls?.add(url);

  const filename = getDecodedUrlBasename(url);
  const completed = options.resume ? await recordedFileCompletion(url, options.output, filename) : null;
  if (completed) {
    logDownloadSkipped(filename, "already verified locally");
    onProgress?.({
      url,
      fileName: filename,
      progress: 100,
      downloadedSize: completed.downloadedBytes,
      totalSize: completed.downloadedBytes,
      speed: "0 B/s",
      speedBytes: 0,
    });
    return;
  }
  reportDownloadFile(url, options.output, filename, {
    status: "downloading",
    verified: false,
    verificationVersion: undefined,
    localMtimeMs: undefined,
    error: undefined,
    attempts: 0,
    maxRetries: Number.isSafeInteger(options.maxRetries) && options.maxRetries >= 0 ? options.maxRetries : undefined,
  });
  let lastTotalSize = expectedSize ?? 0;
  try {
    await downloadFileContents(
      url,
      options,
      (progress) => {
        lastTotalSize = progress.totalSize;
        reportDownloadFile(url, options.output, filename, {
          downloadedBytes: progress.downloadedSize,
          totalBytes: progress.totalSize > 0 ? progress.totalSize : null,
          speedBytes: progress.speedBytes,
          progressUpdatedAt: Date.now(),
          connections: progress.connections,
        });
        onProgress?.(progress);
      },
      expectedSize,
      slot,
      slotBar
    );
    const size = await getFileSize(path.join(options.output, filename));
    const stat = await fs.stat(path.join(options.output, filename));
    reportDownloadFile(url, options.output, filename, {
      status: "completed",
      downloadedBytes: size ?? 0,
      totalBytes: size,
      estimated: false,
      localMtimeMs: stat.mtimeMs,
      verificationVersion: FILE_VERIFICATION_VERSION,
      speedBytes: 0,
      connections: undefined,
    });
    onProgress?.({
      url,
      fileName: filename,
      progress: 100,
      downloadedSize: size ?? 0,
      totalSize: size ?? 0,
      speed: "0 B/s",
      speedBytes: 0,
    });
  } catch (error) {
    const bytes = await localDownloadedBytes(url, options.output);
    reportDownloadFile(url, options.output, filename, {
      status: "failed",
      downloadedBytes: bytes,
      speedBytes: 0,
      connections: undefined,
      error: error instanceof Error ? error.message : String(error),
    });
    onProgress?.({
      checkpoint: true,
      url,
      fileName: filename,
      progress: lastTotalSize > 0 ? Math.min(100, (bytes / lastTotalSize) * 100) : 0,
      downloadedSize: bytes,
      totalSize: lastTotalSize,
      speed: "0 B/s",
      speedBytes: 0,
    });
    throw error;
  }
}

async function downloadFileContents(
  url: string,
  options: DownloadOptions,
  onProgress: (progress: DownloadProgress) => void,
  expectedSize: number | undefined,
  slot: number,
  slotBar?: ReturnType<typeof createDownloadBar>
): Promise<void> {
  await fs.mkdir(options.output, { recursive: true });

  const filename = getDecodedUrlBasename(url);
  let expectedFileSize = await fetchExpectedFileSize(url, options);
  const cachedFileSize = getCachedFileSizeInfo(url);
  if (!expectedFileSize.size && cachedFileSize.size) {
    // Cached lengths describe a previous representation, not current completion evidence.
    expectedFileSize = { size: cachedFileSize.size, exact: false };
  }
  if (!expectedFileSize.size && expectedSize) {
    expectedFileSize = { size: expectedSize, exact: false };
  }
  const connections = getLegacyConnectionCount(options, expectedFileSize.size || expectedSize);
  const startedAt = Date.now();
  const finalPath = path.join(options.output, filename);
  const partsDirectory = path.join(options.output, PARTS_DIRECTORY_NAME);
  const tempPath = path.join(partsDirectory, filename);

  await fs.mkdir(partsDirectory, { recursive: true });
  hidePartsDirectory(partsDirectory);
  if (await isUnavailablePageFile(tempPath)) {
    await fs.rm(tempPath, { force: true });
  }
  if (!options.resume) {
    await cleanFileDownloadParts(tempPath);
    await fs.rm(tempPath, { force: true });
  }

  let resumeValidator: string | undefined;
  const existingFile = await getExistingFileState(finalPath);
  if (existingFile !== null) {
    if (!existingFile.isUnavailablePage && isExistingFileComplete(existingFile.size, expectedFileSize)) {
      reportDownloadFile(url, options.output, filename, { verified: true });
      await cleanFileDownloadParts(tempPath);
      logDownloadSkipped(filename, "already exists");
      return;
    }

    const decision = await reconcileExistingFile({ url, finalPath, tempPath, existing: existingFile, options });

    if (decision.action === "skip") {
      reportDownloadFile(url, options.output, filename, { verified: true });
      await cleanFileDownloadParts(tempPath);
      if (decision.totalSize > 0) {
        updateCachedFileSize(url, decision.totalSize);
      }
      logDownloadSkipped(filename, "already exists");
      return;
    }

    if (decision.action === "resume") {
      resumeValidator = decision.validator;
      expectedFileSize = { size: decision.totalSize, exact: true };
      logFileNotice(
        filename,
        `Existing file is incomplete: ${formatSize(decision.localSize)} / ${formatSize(
          decision.totalSize
        )}; downloading the remaining ${formatSize(decision.totalSize - decision.localSize)}`
      );
    } else {
      const expectedDescription = expectedFileSize.size ? formatSize(expectedFileSize.size) : "unknown size";
      logFileNotice(
        filename,
        `${decision.reason}: ${formatSize(existingFile.size)} / ${expectedDescription}; re-downloading`
      );
    }
  } else {
    const partialSize = await getFileSize(tempPath);
    if (options.resume && partialSize !== null) {
      let complete = isExistingFileComplete(partialSize, expectedFileSize);
      if (!complete && partialSize > 0) {
        const probe = await probeRemoteCompletion(url, partialSize, options);
        if (probe.known) {
          expectedFileSize = { size: probe.totalSize, exact: true };
          resumeValidator = probe.validator;
          complete = probe.complete;
          if (partialSize > probe.totalSize) {
            await fs.rm(tempPath, { force: true });
            await cleanFileDownloadParts(tempPath);
          }
        }
      }
      if (complete) {
        await verifyDownloadedFile({ url, filePath: tempPath, options, expectedFileSize });
        await promoteDownloadedFile(tempPath, finalPath);
        reportDownloadFile(url, options.output, filename, { verified: true });
        return;
      }
    }
  }

  const ownsBar = !slotBar;
  const maxFileAttempts = Math.max(1, options.maxRetries + 1);

  for (let attempt = 1; attempt <= maxFileAttempts; attempt++) {
    reportDownloadFile(url, options.output, filename, { attempts: attempt });
    try {
      if (usesNativeFetchDownloader()) {
        let bars: ReturnType<typeof createDownloadBar> | null = slotBar ?? null;
        let countedActive = false;
        let decremented = false;
        let lastProgress: FetchDownloadProgress = {
          downloadedBytes: 0,
          speedBytes: 0,
          percentage: 0,
          totalBytes: expectedFileSize.size,
        };
        const cleanup = () => {
          if (countedActive && !decremented) {
            decrementActiveDownloads();
            decremented = true;
          }
        };
        const removeBar = () => {
          if (!bars) return;

          if (ownsBar) {
            progressBars.remove(bars.progress);
          } else {
            resetDownloadBar(bars);
          }
          bars = null;
        };
        const renderProgress = (progress: FetchDownloadProgress, status?: string) => {
          lastProgress = progress;

          if (!bars) {
            incrementActiveDownloads();
            countedActive = true;
            bars = createDownloadBar(filename, 100, progress.percentage, "Starting", slot);
          }

          const progressVal = Math.floor(progress.percentage);
          const sizeStr = `${formatSize(progress.downloadedBytes)} / ${formatSize(progress.totalBytes)}`.padEnd(
            21,
            " "
          );
          const speedStr = status ?? `${(progress.speedBytes / 1024 / 1024).toFixed(2)} MB/s`;

          bars.progress.update(progressVal, {
            ...createDownloadBarPayload(filename, slot),
            downloadedPadded: sizeStr,
            percentagePadded: progressVal.toString().padStart(3, " "),
            statusPadded: speedStr.padEnd(10, " "),
          });

          onProgress?.({
            url,
            fileName: filename,
            progress: progress.percentage,
            speed: `${(progress.speedBytes / 1024 / 1024).toFixed(2)} MB/s`,
            speedBytes: progress.speedBytes,
            connections: progress.connections,
            totalSize: progress.totalBytes,
            downloadedSize: progress.downloadedBytes,
          });
        };
        const updateStatus = (status: string) => {
          if (!bars) return;

          const progressVal = Math.floor(lastProgress.percentage);
          bars.progress.update(progressVal, {
            ...createDownloadBarPayload(filename, slot),
            downloadedPadded: `${formatSize(lastProgress.downloadedBytes)} / ${formatSize(
              lastProgress.totalBytes
            )}`.padEnd(21, " "),
            percentagePadded: progressVal.toString().padStart(3, " "),
            statusPadded: status.padEnd(10, " "),
          });
        };

        try {
          const downloaded = await downloadWithFetch({
            url,
            tempPath,
            options,
            expectedFileSize,
            validator: resumeValidator,
            onProgress: (progress) => renderProgress(progress),
          });
          const verification = await verifyDownloadedFile({
            url,
            filePath: tempPath,
            options,
            expectedFileSize,
            transferSize: downloaded.exactSize,
            onStatus: updateStatus,
            onProgress: (progress) => renderProgress(progress, "Repairing"),
            log: (message) => logFileNotice(filename, message),
          });
          if (verification.totalSize > 0) {
            expectedFileSize = { size: verification.totalSize, exact: verification.verified };
          }

          await promoteDownloadedFile(tempPath, finalPath);
          reportDownloadFile(url, options.output, filename, { verified: verification.verified });

          if (bars) {
            const sizeToLog = verification.size || expectedFileSize.size || lastProgress.downloadedBytes;
            const durationSeconds = (Date.now() - startedAt) / 1000;
            if (verification.verified) {
              updateCachedFileSize(url, sizeToLog);
            }
            logDownloadComplete(filename, sizeToLog, durationSeconds);
            removeBar();
          }

          cleanup();
          return;
        } catch (error) {
          if (bars) {
            bars.progress.update(0, {
              ...createDownloadBarPayload(filename, slot),
              statusPadded: "Failed".padEnd(11, " "),
            });
            removeBar();
          }
          cleanup();
          throw error;
        }
      }

      await new Promise<void>((resolve, reject) => {
        const dl = new EasyDl(url, tempPath, {
          connections,
          existBehavior: "ignore",
          maxRetry: options.maxRetries,
          retryDelay: 5000,
          retryBackoff: 3000,
          chunkSize: (size) => Math.min(size / 10, SMALL_FILE_SINGLE_CONNECTION_THRESHOLD),
          httpOptions: {
            headers: {
              "User-Agent": DOWNLOAD_USER_AGENT,
            },
          },
        });

        let downloadedTotal = 0;
        let bars: ReturnType<typeof createDownloadBar> | null = slotBar ?? null;
        let decremented = false;
        let countedActive = false;
        let lastDownloadError: Error | null = null;
        let settled = false;
        const cleanup = () => {
          if (countedActive && !decremented) {
            decrementActiveDownloads();
            decremented = true;
          }
        };
        const removeBar = () => {
          if (!bars) return;

          if (ownsBar) {
            progressBars.remove(bars.progress);
          } else {
            resetDownloadBar(bars);
          }
          bars = null;
        };
        const rejectDownload = (error: Error) => {
          if (bars) {
            bars.progress.update(0, {
              ...createDownloadBarPayload(filename, slot),
              statusPadded: "Failed".padEnd(11, " "),
            });
            removeBar();
          }
          cleanup();
          reject(error);
        };

        dl.on("metadata", (meta) => {
          if (meta.size) {
            expectedFileSize = { size: meta.size, exact: true };
            if (bars) {
              bars.progress.setTotal(100); // We've confirmed size, percentage is safe now
            }
          }
          if (meta.isResume || attempt > 1) {
            const status = attempt > 1 ? `(Resuming after retry ${attempt - 1}/${maxFileAttempts - 1})` : "(Resuming)";
            progressBars.log(`${colors.gray("·")} ${colors.bold.white(filename)} ${colors.yellow(status)}\n`);
          }
          if (options.verbose) {
            logger.log(
              colors.gray(`[DEBUG] Metadata: ${filename} - Size: ${meta.size} bytes, Connections: ${connections}`)
            );
          }
        });

        dl.on("retry", (retryInfo) => {
          lastDownloadError = retryInfo.error;
          if (options.verbose)
            logger.log(
              colors.yellow(`[DEBUG] Retry: ${filename} - Chunk ${retryInfo.chunkId} - ${retryInfo.error.message}`)
            );
        });

        dl.on("build", (progress) => {
          if (bars) {
            bars.progress.update(progress.percentage, {
              ...createDownloadBarPayload(filename, slot),
              percentagePadded: Math.floor(progress.percentage).toString().padStart(3, " "),
              statusPadded: "Assembling".padEnd(11, " "),
            });
          }
        });

        dl.on("error", (err) => {
          const errorMsg = err.message || String(err);
          lastDownloadError = err instanceof Error ? err : new Error(errorMsg);
          if (settled && isLateDestroyedStreamError(lastDownloadError)) {
            return;
          }

          if (options.verbose) {
            logger.error(colors.red(`\n[DEBUG] EasyDL Error (${filename}):`), err);
          }
          if (bars) {
            const isAbort = err.message === "aborted" || getErrorCode(err) === "ECONNRESET";
            const status = isAbort ? "(Connection Reset)" : `(Error: ${errorMsg})`;
            bars.progress.update(0, {
              ...createDownloadBarPayload(filename, slot),
              statusPadded: status.padEnd(11, " "),
            });
            removeBar();
          }
          cleanup();
        });

        dl.on("progress", (stats) => {
          const downloadedBytes = stats.total.bytes || 0;
          const currentSpeed = stats.total.speed || 0;
          const currentPercentage = stats.total.percentage || 0;
          downloadedTotal = downloadedBytes;

          if (!bars) {
            incrementActiveDownloads();
            countedActive = true;
            bars = createDownloadBar(filename, 100, currentPercentage, "Starting", slot);
          }

          if (bars) {
            const progressVal = Math.floor(currentPercentage);
            const paddedPercentage = progressVal.toString().padStart(3, " ");
            const totalEstimate =
              expectedFileSize.size || (currentPercentage > 0 ? downloadedBytes / (currentPercentage / 100) : 0);
            const sizeStr = `${formatSize(downloadedBytes)} / ${formatSize(totalEstimate)}`.padEnd(21, " ");
            const speedStr = `${(currentSpeed / 1024 / 1024).toFixed(2)} MB/s`.padEnd(10, " ");

            bars.progress.update(progressVal, {
              ...createDownloadBarPayload(filename, slot),
              downloadedPadded: sizeStr,
              percentagePadded: paddedPercentage,
              statusPadded: speedStr,
            });
          }

          if (onProgress) {
            onProgress({
              url,
              fileName: filename,
              progress: currentPercentage,
              speed: `${(currentSpeed / 1024 / 1024).toFixed(2)} MB/s`,
              speedBytes: currentSpeed,
              totalSize: expectedFileSize.size || 0,
              downloadedSize: downloadedBytes,
            });
          }
        });

        dl.wait()
          .then(async (completed) => {
            settled = true;
            if (!completed) {
              rejectDownload(lastDownloadError ?? new Error("Download finished but file is incomplete"));
              return;
            }

            let verification: VerifyDownloadResult;
            try {
              verification = await verifyDownloadedFile({
                url,
                filePath: tempPath,
                options,
                expectedFileSize,
                onProgress: (progress) =>
                  onProgress?.({
                    url,
                    fileName: filename,
                    progress: progress.percentage,
                    speed: `${(progress.speedBytes / 1024 / 1024).toFixed(2)} MB/s`,
                    speedBytes: progress.speedBytes,
                    totalSize: progress.totalBytes,
                    downloadedSize: progress.downloadedBytes,
                  }),
                log: (message) => logFileNotice(filename, message),
              });
            } catch (error) {
              rejectDownload(error instanceof Error ? error : new Error(String(error)));
              return;
            }
            if (verification.totalSize > 0) {
              expectedFileSize = { size: verification.totalSize, exact: verification.verified };
            }

            await promoteDownloadedFile(tempPath, finalPath);
            reportDownloadFile(url, options.output, filename, { verified: verification.verified });

            if (bars) {
              const sizeToLog = verification.size || expectedFileSize.size || downloadedTotal;
              const durationSeconds = (Date.now() - startedAt) / 1000;
              if (verification.verified) {
                updateCachedFileSize(url, sizeToLog);
              }
              logDownloadComplete(filename, sizeToLog, durationSeconds);
              removeBar();
            }

            cleanup();
            resolve();
          })
          .catch((err: unknown) => {
            const error = err instanceof Error ? err : new Error(String(err));
            const failure =
              lastDownloadError && isTransientDownloadError(lastDownloadError) ? lastDownloadError : error;
            settled = true;
            lastDownloadError = failure;
            const errorCode = getErrorCode(failure);
            const isAbort = failure.message === "aborted" || errorCode === "ECONNRESET";
            if (options.verbose) {
              logger.error(
                colors.red(`\n[DEBUG] dl.wait() ${isAbort ? "Aborted/Reset" : "Rejected"} (${filename}):`),
                failure
              );
            }
            if (bars) {
              const status = isAbort ? "(Connection Reset)" : `(Error: ${failure.message})`;
              bars.progress.update(0, {
                ...createDownloadBarPayload(filename, slot),
                statusPadded: status.padEnd(11, " "),
              });
              removeBar();
            }
            cleanup(); // Ensure UI count is decremented even on failure
            reject(failure);
          });
      });

      return;
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (attempt >= maxFileAttempts || !isTransientDownloadError(error)) {
        throw error;
      }

      const retryDelay = 5000 + 3000 * (attempt - 1);
      reportDownloadFile(url, options.output, filename, { speedBytes: 0, connections: undefined });
      progressBars.log(
        `${colors.gray("·")} ${colors.bold.white(filename)} ${colors.yellow(
          `(Retrying after ${error.message}; attempt ${attempt + 1}/${maxFileAttempts})`
        )}\n`
      );
      await delay(retryDelay);
    }
  }
}

export async function getDirectoryListing(
  url: string,
  options: {
    refresh?: boolean;
    allowEmptyCache?: boolean;
    fetcher?: (url: string) => Promise<Response>;
  } = {}
): Promise<DirectoryListing> {
  const cached = dirListingCache.get(url);
  if (!options.refresh && cached && (options.allowEmptyCache || cached.files.length > 0 || cached.dirs.length > 0)) {
    return cached;
  }

  const fetchedAt = Date.now();
  const generation = await fileIndexGeneration().catch(() => undefined);

  const response = await (options.fetcher
    ? options.fetcher(url)
    : fetch(url, {
        headers: {
          "User-Agent": DOWNLOAD_USER_AGENT,
        },
      }));
  if (!response.ok) {
    throw new Error(`Failed to fetch directory listing: ${response.statusText} (${url})`);
  }

  const html = await response.text();
  const baseUrl = url.endsWith("/") ? url : url + "/";
  const result = { ...parseDirectoryListing(html, baseUrl, options.allowEmptyCache), fetchedAt };

  if (options.allowEmptyCache || result.files.length > 0 || result.dirs.length > 0) {
    dirListingCache.set(url, result);
    await saveDiscoveryCache();
    // Indexing is auxiliary: its storage failure must not fail a download.
    await publishIndexedDirectory(url, result, fetchedAt, generation).catch(() => {});
  }
  return result;
}

async function localDownloadedBytes(url: string, output: string): Promise<number> {
  const filename = getDecodedUrlBasename(url);
  const final = await getExistingFileState(path.join(output, filename));
  const temp = path.join(output, PARTS_DIRECTORY_NAME, filename);
  const partial = await getExistingFileState(temp);
  return Math.max(
    final && !final.isUnavailablePage ? final.size : 0,
    partial && !partial.isUnavailablePage ? partial.size : 0,
    await parallelBytesOnDisk(temp, url)
  );
}

async function localFileProgress(url: string, options: DownloadOptions, size: number, exact: boolean) {
  const filename = getDecodedUrlBasename(url);
  const completed = options.resume ? await recordedFileCompletion(url, options.output, filename) : null;
  if (completed) return { completed: true, bytes: completed.downloadedBytes, expectedSize: completed.downloadedBytes };
  let bytes = 0;
  if (options.resume) {
    bytes = await localDownloadedBytes(url, options.output);
    if (exact && size > 0 && bytes > size) bytes = 0;
  }
  reportDownloadFile(url, options.output, filename, {
    status: "waiting",
    downloadedBytes: bytes,
    totalBytes: size > 0 ? size : null,
    estimated: !exact,
    speedBytes: 0,
    connections: undefined,
  });
  return { completed: false, bytes, expectedSize: Math.max(size, bytes) };
}

function publishInitialProgress(progress: FileCountProgress, onProgress?: (progress: DownloadProgress) => void) {
  updateOverallDownloadProgress(progress);
  onProgress?.({
    checkpoint: true,
    fileName: "Preparing download",
    progress: 0,
    downloadedSize: 0,
    totalSize: 0,
    speed: "0 B/s",
    speedBytes: 0,
    overall: getOverallDownloadProgress(progress),
  });
}

async function summarizeDirectoryDownload(
  url: string,
  options: DownloadOptions,
  initialData?: DirectoryListing,
  relativePath: string = ""
): Promise<DownloadPlanSummary> {
  const { files, dirs } = initialData || (await getDirectoryListing(url));
  const isExcluded = createIgnoreMatcher(options.exclude);
  const summary: DownloadPlanSummary = {
    fileCount: 0,
    totalBytes: 0,
    hasSizeInfo: false,
    isEstimate: false,
    localFiles: new Map(),
  };

  for (const file of files) {
    const filename = getDecodedUrlBasename(file.url);
    const relativeFilePath = path.posix.join(relativePath, filename);
    if (isExcluded(relativeFilePath)) continue;

    const local = await localFileProgress(file.url, options, file.size, file.exact === true);
    summary.localFiles.set(file.url, local);

    summary.fileCount++;
    if (local.expectedSize > 0) {
      summary.hasSizeInfo = true;
      summary.totalBytes += local.expectedSize;
      if (!local.completed && !file.exact) summary.isEstimate = true;
    }
  }

  const subSummaries = await Promise.all(
    dirs
      .filter((dirUrl) => !isExcluded(path.posix.join(relativePath, getDecodedUrlBasename(dirUrl)) + "/"))
      .map(async (dirUrl) => {
        const dirName = getDecodedUrlBasename(dirUrl);
        return summarizeDirectoryDownload(
          dirUrl,
          { ...options, output: path.join(options.output, dirName) },
          undefined,
          path.posix.join(relativePath, dirName)
        );
      })
  );

  for (const subSummary of subSummaries) {
    summary.fileCount += subSummary.fileCount;
    summary.totalBytes += subSummary.totalBytes;
    summary.hasSizeInfo ||= subSummary.hasSizeInfo;
    summary.isEstimate ||= subSummary.isEstimate;
    for (const [url, local] of subSummary.localFiles) summary.localFiles.set(url, local);
  }

  return summary;
}

function addSummary(target: DownloadPlanSummary, source: DownloadPlanSummary): void {
  target.fileCount += source.fileCount;
  target.totalBytes += source.totalBytes;
  target.hasSizeInfo ||= source.hasSizeInfo;
  target.isEstimate ||= source.isEstimate;
  for (const [url, local] of source.localFiles) target.localFiles.set(url, local);
}

async function summarizeFileDownload(url: string, options: DownloadOptions): Promise<DownloadPlanSummary> {
  const completed = options.resume
    ? await recordedFileCompletion(url, options.output, getDecodedUrlBasename(url))
    : null;
  const expectedFileSize = completed
    ? { size: completed.downloadedBytes, exact: true }
    : await fetchExpectedFileSize(url, options);
  const cachedFileSize = getCachedFileSizeInfo(url);
  const size = expectedFileSize.size || cachedFileSize.size;
  const exact = expectedFileSize.size ? expectedFileSize.exact : cachedFileSize.exact;
  const local = await localFileProgress(url, options, size, exact);

  return {
    fileCount: 1,
    totalBytes: local.expectedSize,
    hasSizeInfo: size > 0,
    isEstimate: size > 0 && !exact,
    localFiles: new Map([[url, local]]),
  };
}

async function downloadFileWithOverallProgress(
  fileUrl: string,
  options: DownloadOptions,
  filePath: string,
  fileCountProgress: FileCountProgress | undefined,
  onProgress?: (progress: DownloadProgress) => void,
  expectedSize?: number
): Promise<DownloadFailure | null> {
  const local = fileCountProgress?.localFiles.get(fileUrl);
  if (local?.completed && fileCountProgress) {
    if (await recordedFileCompletion(fileUrl, options.output, getDecodedUrlBasename(fileUrl))) return null;
    // A local file may have changed between planning and taking its worker slot.
    fileCountProgress.completedFiles--;
    fileCountProgress.completedBytes -= local.bytes;
  }
  const plannedSize = local?.expectedSize ?? expectedSize ?? 0;
  let lastDownloadedBytes = 0;
  const slot = acquireDownloadSlot(fileCountProgress);

  try {
    await downloadFile(
      fileUrl,
      options,
      (progress) => {
        lastDownloadedBytes = progress.downloadedSize;
        if (fileCountProgress) {
          fileCountProgress.pendingBytes.delete(fileUrl);
          fileCountProgress.activeBytes.set(fileUrl, progress.downloadedSize);
          fileCountProgress.activeSpeeds.set(fileUrl, progress.speedBytes ?? 0);
          fileCountProgress.activeFiles.set(fileUrl, {
            url: fileUrl,
            fileName: progress.fileName,
            progress: progress.progress,
            downloadedSize: progress.downloadedSize,
            totalSize: progress.totalSize,
            speed: progress.speed,
          });
          updateOverallDownloadProgress(fileCountProgress);
        }
        onProgress?.({
          ...progress,
          url: fileUrl,
          overall: fileCountProgress ? getOverallDownloadProgress(fileCountProgress) : undefined,
        });
      },
      expectedSize,
      slot,
      fileCountProgress?.slotBars[slot - 1]
    );

    if (fileCountProgress) {
      fileCountProgress.activeBytes.delete(fileUrl);
      fileCountProgress.activeSpeeds.delete(fileUrl);
      fileCountProgress.activeFiles.delete(fileUrl);
      fileCountProgress.completedFiles++;
      // Completion includes skipped existing files and any tail repaired by verification.
      fileCountProgress.completedBytes += lastDownloadedBytes;
      fileCountProgress.totalBytes += lastDownloadedBytes - plannedSize;
      updateOverallDownloadProgress(fileCountProgress);
      onProgress?.({
        url: fileUrl,
        fileName: getDecodedUrlBasename(fileUrl),
        progress: 100,
        downloadedSize: lastDownloadedBytes,
        totalSize: lastDownloadedBytes,
        speed: "0 B/s",
        speedBytes: 0,
        overall: getOverallDownloadProgress(fileCountProgress),
      });
    }

    return null;
  } catch (err: unknown) {
    const bytes = await localDownloadedBytes(fileUrl, options.output);
    if (fileCountProgress) fileCountProgress.pendingBytes.set(fileUrl, bytes);
    fileCountProgress?.activeBytes.delete(fileUrl);
    fileCountProgress?.activeSpeeds.delete(fileUrl);
    fileCountProgress?.activeFiles.delete(fileUrl);
    if (fileCountProgress) {
      updateOverallDownloadProgress(fileCountProgress);
      onProgress?.({
        checkpoint: true,
        url: fileUrl,
        fileName: getDecodedUrlBasename(fileUrl),
        progress: plannedSize > 0 ? Math.min(100, (bytes / plannedSize) * 100) : 0,
        downloadedSize: bytes,
        totalSize: plannedSize,
        speed: "0 B/s",
        speedBytes: 0,
        overall: getOverallDownloadProgress(fileCountProgress),
      });
    }

    const errorMsg = err instanceof Error ? err.message : String(err);
    progressBars.log(
      `${colors.bold.red("✖")} ${colors.bold.white(
        getDecodedUrlBasename(fileUrl)
      )} ${colors.red(`(Failed: ${errorMsg})`)}\n`
    );

    return {
      filePath,
      error: errorMsg,
    };
  } finally {
    releaseDownloadSlot(fileCountProgress, slot);
  }
}

export async function downloadRecursive(
  url: string,
  options: DownloadOptions,
  limit: ReturnType<typeof pLimit>,
  onProgress?: (progress: DownloadProgress) => void,
  initialData?: { files: { url: string; size: number; exact?: boolean }[]; dirs: string[] },
  relativePath: string = "",
  fileCountProgress?: FileCountProgress,
  ignorePath: string = ""
): Promise<DownloadFailure[]> {
  const { files, dirs } = initialData || (await getDirectoryListing(url));
  await fs.mkdir(options.output, { recursive: true });
  const isExcluded = createIgnoreMatcher(options.exclude);
  const failures: DownloadFailure[] = [];
  const includedFiles = files.filter((file) => {
    const filename = getDecodedUrlBasename(file.url);
    const relativeFilePath = path.posix.join(relativePath, filename);
    const excluded = isExcluded(path.posix.join(ignorePath, filename));

    if (excluded) {
      logDownloadSkipped(relativeFilePath, "excluded");
    }

    return !excluded;
  });

  const downloadTasks = includedFiles.map((file) =>
    limit(async () => {
      const filePath = path.posix.join(relativePath, getDecodedUrlBasename(file.url));
      const failure = await downloadFileWithOverallProgress(
        file.url,
        options,
        filePath,
        fileCountProgress,
        onProgress,
        file.size
      );
      if (failure) failures.push(failure);
    })
  );

  const recursionTasks = dirs
    .filter((dirUrl) => !isExcluded(path.posix.join(ignorePath, getDecodedUrlBasename(dirUrl)) + "/"))
    .map(async (dirUrl) => {
      try {
        const dirName = getDecodedUrlBasename(dirUrl);
        const subOptions = { ...options, output: path.join(options.output, dirName) };
        return await downloadRecursive(
          dirUrl,
          subOptions,
          limit,
          onProgress,
          undefined,
          path.posix.join(relativePath, dirName),
          fileCountProgress,
          path.posix.join(ignorePath, dirName)
        );
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        failures.push({
          filePath: path.posix.join(relativePath, getDecodedUrlBasename(dirUrl)),
          error: errorMsg,
        });

        return [];
      }
    });

  await Promise.all(downloadTasks);
  await removePartsDirectoryIfEmpty(path.join(options.output, PARTS_DIRECTORY_NAME));
  const subFailures = await Promise.all(recursionTasks);
  await removePartsDirectoryIfEmpty(path.join(options.output, PARTS_DIRECTORY_NAME));

  return failures.concat(subFailures.flat());
}

export async function downloadUrls(
  targets: DownloadTarget[],
  options: DownloadOptions,
  onProgress?: (progress: DownloadProgress) => void
): Promise<void> {
  return downloadSession.run(new Set(), () => downloadMany(targets, options, onProgress));
}

async function downloadMany(
  targets: DownloadTarget[],
  options: DownloadOptions,
  onProgress?: (progress: DownloadProgress) => void
): Promise<void> {
  await loadDiscoveryCache();
  const limit = pLimit(options.concurrent);
  const summary: DownloadPlanSummary = {
    fileCount: 0,
    totalBytes: 0,
    hasSizeInfo: false,
    isEstimate: false,
    localFiles: new Map(),
  };
  const directoryTargets: {
    target: DownloadTarget;
    listing: DirectoryListing;
    summary: DownloadPlanSummary;
  }[] = [];
  const fileTargets: {
    target: DownloadTarget;
    summary: DownloadPlanSummary;
  }[] = [];
  const discoveryFailures: DownloadFailure[] = [];

  try {
    for (const target of targets) {
      if (target.url.endsWith("/")) {
        try {
          const listing = await getDirectoryListing(target.url);
          if (listing.files.length === 0 && listing.dirs.length === 0) {
            discoveryFailures.push({
              filePath: target.relativePath || getDecodedUrlBasename(target.url),
              error: "No files or subdirectories found at this URL.",
            });
            continue;
          }

          const targetSummary = await summarizeDirectoryDownload(
            target.url,
            { ...options, output: target.output },
            listing,
            target.relativePath
          );
          addSummary(summary, targetSummary);
          directoryTargets.push({ target, listing, summary: targetSummary });
        } catch (err: unknown) {
          discoveryFailures.push({
            filePath: target.relativePath || getDecodedUrlBasename(target.url),
            error: err instanceof Error ? err.message : String(err),
          });
        }
      } else {
        const targetSummary = await summarizeFileDownload(target.url, { ...options, output: target.output });
        addSummary(summary, targetSummary);
        fileTargets.push({ target, summary: targetSummary });
      }
    }

    if (summary.fileCount === 0 && directoryTargets.length === 0 && fileTargets.length === 0) {
      throw new Error(formatDownloadFailures(discoveryFailures));
    }

    const sizeSummary = summary.hasSizeInfo
      ? colors.gray(` [${summary.isEstimate ? "~" : ""}${formatSize(summary.totalBytes)}]`)
      : "";
    const directoryCount = directoryTargets.length;
    logger.log(
      `${colors.cyan("●")} ${colors.bold.white("DISCOVERY  ")} ${summary.fileCount} files, ${directoryCount} top-level directories${sizeSummary}`
    );

    const fileCountProgress =
      summary.fileCount > 0 ? createFileCountProgressState(summary, options.concurrent) : undefined;
    if (!fileCountProgress) {
      const directoryFailures = await Promise.all(
        directoryTargets.map(({ target, listing }) =>
          downloadRecursive(
            target.url,
            { ...options, output: target.output },
            limit,
            onProgress,
            listing,
            target.relativePath
          )
        )
      );
      const failures = discoveryFailures.concat(directoryFailures.flat());
      if (failures.length > 0) {
        throw new Error(formatDownloadFailures(failures));
      }
      return;
    }

    publishInitialProgress(fileCountProgress, onProgress);
    progressBars.log(`${colors.bold.white("Slots")}\n`);
    fileCountProgress.slotBars = Array.from({ length: options.concurrent }, (_, index) =>
      createDownloadBar("", 100, 0, "", index + 1)
    );

    const fileTasks = fileTargets.map(({ target, summary: targetSummary }) =>
      limit(async () => {
        const filePath = path.posix.join(target.relativePath, getDecodedUrlBasename(target.url));
        return await downloadFileWithOverallProgress(
          target.url,
          { ...options, output: target.output },
          filePath,
          fileCountProgress,
          onProgress,
          targetSummary.totalBytes
        );
      })
    );

    const directoryTasks = directoryTargets.map(({ target, listing }) =>
      downloadRecursive(
        target.url,
        { ...options, output: target.output },
        limit,
        onProgress,
        listing,
        target.relativePath,
        fileCountProgress
      )
    );

    const fileFailures = await Promise.all(fileTasks);
    const directoryFailures = await Promise.all(directoryTasks);
    updateFileCountBar(
      fileCountProgress.bar,
      fileCountProgress.completedFiles,
      fileCountProgress.totalFiles,
      fileCountProgress.completedBytes,
      fileCountProgress.totalBytes,
      0
    );

    const failures = discoveryFailures.concat(
      fileFailures.filter((failure): failure is DownloadFailure => Boolean(failure))
    );
    failures.push(...directoryFailures.flat());

    if (failures.length > 0) {
      throw new Error(formatDownloadFailures(failures));
    }
  } finally {
    await saveDiscoveryCache();
  }
}

export async function stopProgress(): Promise<void> {
  progressBars.stop();
}

export async function downloadUrl(
  url: string,
  options: DownloadOptions,
  onProgress?: (progress: DownloadProgress) => void
): Promise<void> {
  return downloadSession.run(new Set(), () => downloadSingle(url, options, onProgress));
}

async function downloadSingle(
  url: string,
  options: DownloadOptions,
  onProgress?: (progress: DownloadProgress) => void
): Promise<void> {
  await loadDiscoveryCache();
  const limit = pLimit(options.concurrent);

  try {
    if (url.endsWith("/")) {
      const { files, dirs } = await getDirectoryListing(url);
      if (files.length === 0 && dirs.length === 0) {
        throw new Error("No files or subdirectories found at this URL.");
      }

      const summary = await summarizeDirectoryDownload(url, options, { files, dirs });
      const sizeSummary = summary.hasSizeInfo
        ? colors.gray(` [${summary.isEstimate ? "~" : ""}${formatSize(summary.totalBytes)}]`)
        : "";
      logger.log(
        `${colors.cyan("●")} ${colors.bold.white("DISCOVERY  ")} ${summary.fileCount} files, ${dirs.length} subdirectories${sizeSummary}`
      );

      const fileCountProgress =
        summary.fileCount > 0 ? createFileCountProgressState(summary, options.concurrent) : undefined;
      if (fileCountProgress) {
        publishInitialProgress(fileCountProgress, onProgress);
        progressBars.log(`${colors.bold.white("Slots")}\n`);
        fileCountProgress.slotBars = Array.from({ length: options.concurrent }, (_, index) =>
          createDownloadBar("", 100, 0, "", index + 1)
        );
      }

      const failures = await downloadRecursive(url, options, limit, onProgress, { files, dirs }, "", fileCountProgress);
      if (fileCountProgress) {
        updateFileCountBar(
          fileCountProgress.bar,
          fileCountProgress.completedFiles,
          fileCountProgress.totalFiles,
          fileCountProgress.completedBytes,
          fileCountProgress.totalBytes,
          0
        );
      }

      if (failures.length > 0) {
        throw new Error(formatDownloadFailures(failures));
      }
    } else {
      await downloadFile(url, options, onProgress);
      await removePartsDirectoryIfEmpty(path.join(options.output, PARTS_DIRECTORY_NAME));
    }
  } finally {
    await saveDiscoveryCache();
  }
}
