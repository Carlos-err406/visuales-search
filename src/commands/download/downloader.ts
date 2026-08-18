import EasyDl from "easydl";
import { clean as cleanDownloadParts } from "easydl/dist/utils.js";
import * as cheerio from "cheerio";
import { execFile } from "node:child_process";
import path from "path";
import fs from "fs/promises";
import colors from "ansi-colors";
import pLimit from "p-limit";
import { DownloadOptions, DownloadProgress } from "./types.js";
import { createGlobMatcher, formatSize, parseSize } from "./utils.js";
import {
  DIRECTORY_LISTING_PARSER_VERSION,
  dirListingCache,
  getCachedFileSizeInfo,
  loadDiscoveryCache,
  saveDiscoveryCache,
  updateCachedFileSize,
  type DirectoryListing,
} from "./discovery-cache.js";
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

const downloadedUrls = new Set<string>();
const SMALL_FILE_SINGLE_CONNECTION_THRESHOLD = 10 * 1024 * 1024;
const PARTS_DIRECTORY_NAME = ".visuales-parts";
const DOWNLOAD_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
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
}

interface ExpectedFileSize {
  size: number;
  exact: boolean;
}

interface ExistingFileState {
  size: number;
  isUnavailablePage: boolean;
}

interface FileCountProgress {
  totalFiles: number;
  completedFiles: number;
  totalBytes: number;
  completedBytes: number;
  activeBytes: Map<string, number>;
  activeSpeeds: Map<string, number>;
  activeFiles: Map<
    string,
    {
      fileName: string;
      progress: number;
      downloadedSize: number;
      totalSize: number;
      speed: string;
    }
  >;
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

function getConnectionCount(options: DownloadOptions, expectedSize?: number): number {
  // EasyDl's multipart assembly can emit unhandled ERR_STREAM_DESTROYED on Node 26+.
  if (NODE_MAJOR_VERSION >= 26) {
    return 1;
  }

  if (expectedSize && expectedSize <= SMALL_FILE_SINGLE_CONNECTION_THRESHOLD) {
    return 1;
  }

  return Math.max(1, options.connections);
}

function isUnavailableResponse(response: Response): boolean {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

  return contentType.includes("text/html") && !response.url.toLowerCase().endsWith(".html");
}

function parseContentLength(response: Response): ExpectedFileSize {
  const contentLength = response.headers.get("content-length");
  const size = contentLength ? parseInt(contentLength, 10) : 0;
  const exact = response.ok && Number.isFinite(size) && size > 0 && !isUnavailableResponse(response);

  return {
    size: exact ? size : 0,
    exact,
  };
}

function parseContentRangeSize(response: Response): ExpectedFileSize {
  const contentRange = response.headers.get("content-range");
  const sizeText = contentRange?.match(/\/(\d+)$/)?.[1];
  const size = sizeText ? parseInt(sizeText, 10) : 0;
  const exact = response.status === 206 && Number.isFinite(size) && size > 0 && !isUnavailableResponse(response);

  return {
    size: exact ? size : 0,
    exact,
  };
}

async function fetchExpectedFileSize(url: string, options: DownloadOptions): Promise<ExpectedFileSize> {
  const timeoutMs = Number.isFinite(options.timeout) ? options.timeout * 1000 : undefined;
  const headers = {
    "User-Agent": DOWNLOAD_USER_AGENT,
  };

  try {
    const response = await fetch(url, {
      method: "HEAD",
      headers,
      signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
    });
    const size = parseContentLength(response);
    if (size.exact) return size;
  } catch {
    // Fall through to a range request; some Apache mirrors omit useful HEAD metadata.
  }

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        ...headers,
        Range: "bytes=0-0",
      },
      signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
    });
    await response.body?.cancel();

    return parseContentRangeSize(response);
  } catch {
    return { size: 0, exact: false };
  }
}

async function getFileSize(filePath: string): Promise<number | null> {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile() ? stats.size : null;
  } catch {
    return null;
  }
}

async function getExistingFileState(filePath: string): Promise<ExistingFileState | null> {
  const size = await getFileSize(filePath);
  if (size === null) return null;

  return {
    size,
    isUnavailablePage: await isUnavailablePageFile(filePath),
  };
}

function isExistingFileComplete(existingSize: number, expectedSize: ExpectedFileSize): boolean {
  if (!expectedSize.size || !expectedSize.exact) return false;

  return existingSize === expectedSize.size;
}

function isDownloadedFileComplete(actualSize: number, expectedSize: ExpectedFileSize): boolean {
  return !expectedSize.exact || actualSize === expectedSize.size;
}

async function isUnavailablePageFile(filePath: string): Promise<boolean> {
  try {
    const file = await fs.open(filePath, "r");
    try {
      const buffer = Buffer.alloc(512);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      const sample = buffer.subarray(0, bytesRead).toString("utf8").toLowerCase();

      return (
        sample.includes("<html") &&
        (sample.includes("no est&aacute; disponible") ||
          sample.includes("no está disponible") ||
          sample.includes("upps") ||
          sample.includes("ayuda.uclv.edu.cu"))
      );
    } finally {
      await file.close();
    }
  } catch {
    return false;
  }
}

function getListingSizeExactness(sizeText: string): boolean {
  return /^\d+\s*B?$/i.test(sizeText.trim());
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
  try {
    await cleanDownloadParts(filePath);
  } catch {
    // Missing parts directories are fine; there may simply be no resumable sidecars to remove.
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function isTransientDownloadError(error: Error): boolean {
  const code = getErrorCode(error);
  if (code && ["ECONNRESET", "ECONNABORTED", "ENETRESET", "EPIPE", "ETIMEDOUT", "EAI_AGAIN"].includes(code)) {
    return true;
  }

  return /ECONNRESET|EPIPE|ETIMEDOUT|EAI_AGAIN|read timed out|socket hang up|network timeout/i.test(error.message);
}

function updateOverallDownloadProgress(progress: FileCountProgress): void {
  const activeBytes = [...progress.activeBytes.values()].reduce((sum, bytes) => sum + bytes, 0);
  const activeSpeed = [...progress.activeSpeeds.values()].reduce((sum, bytesPerSecond) => sum + bytesPerSecond, 0);
  updateFileCountBar(
    progress.bar,
    progress.completedFiles,
    progress.totalFiles,
    progress.completedBytes + activeBytes,
    progress.totalBytes,
    activeSpeed
  );
}

function getOverallDownloadProgress(progress: FileCountProgress): DownloadProgress["overall"] {
  const activeBytes = [...progress.activeBytes.values()].reduce((sum, bytes) => sum + bytes, 0);
  const activeSpeed = [...progress.activeSpeeds.values()].reduce((sum, bytesPerSecond) => sum + bytesPerSecond, 0);

  return {
    completedFiles: progress.completedFiles,
    totalFiles: progress.totalFiles,
    downloadedBytes: Math.min(progress.completedBytes + activeBytes, progress.totalBytes),
    totalBytes: progress.totalBytes,
    speedBytes: activeSpeed,
    activeFiles: [...progress.activeFiles.values()],
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
  if (downloadedUrls.has(url)) return;
  downloadedUrls.add(url);

  await fs.mkdir(options.output, { recursive: true });

  const encodedFilename = path.basename(url);
  const filename = decodeURIComponent(encodedFilename);
  let expectedFileSize = await fetchExpectedFileSize(url, options);
  const cachedFileSize = getCachedFileSizeInfo(url);
  if (!expectedFileSize.size && cachedFileSize.size) {
    expectedFileSize = cachedFileSize;
  }
  if (!expectedFileSize.size && expectedSize) {
    expectedFileSize = { size: expectedSize, exact: false };
  }
  const connections = getConnectionCount(options, expectedFileSize.size || expectedSize);
  const startedAt = Date.now();
  const finalPath = path.join(options.output, filename);
  const partsDirectory = path.join(options.output, PARTS_DIRECTORY_NAME);
  const tempPath = path.join(partsDirectory, filename);
  let shouldReplaceExistingFile = false;

  const existingFile = await getExistingFileState(finalPath);
  if (existingFile !== null) {
    if (!existingFile.isUnavailablePage && isExistingFileComplete(existingFile.size, expectedFileSize)) {
      await cleanFileDownloadParts(tempPath);
      logDownloadSkipped(filename, "already exists");
      return;
    }

    const expectedDescription = expectedFileSize.size ? formatSize(expectedFileSize.size) : "unknown size";
    progressBars.log(
      `${colors.gray("·")} ${colors.bold.white(filename)} ${colors.yellow(
        `(${
          existingFile.isUnavailablePage
            ? "Existing file is an unavailable-page response"
            : "Existing file is incomplete or unverified"
        }: ${formatSize(existingFile.size)} / ${expectedDescription}; re-downloading)`
      )}\n`
    );
    if (existingFile.isUnavailablePage) {
      await fs.rm(finalPath, { force: true });
    } else {
      shouldReplaceExistingFile = true;
    }
  }

  await fs.mkdir(partsDirectory, { recursive: true });
  hidePartsDirectory(partsDirectory);
  if (await isUnavailablePageFile(tempPath)) {
    await fs.rm(tempPath, { force: true });
  }
  if (!options.resume) {
    await cleanFileDownloadParts(tempPath);
    await fs.rm(tempPath, { force: true });
  }

  const ownsBar = !slotBar;
  const maxFileAttempts = options.resume ? Math.max(1, options.maxRetries + 1) : 1;

  for (let attempt = 1; attempt <= maxFileAttempts; attempt++) {
    try {
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
            console.log(
              colors.gray(`[DEBUG] Metadata: ${filename} - Size: ${meta.size} bytes, Connections: ${connections}`)
            );
          }
        });

        dl.on("retry", (retryInfo) => {
          lastDownloadError = retryInfo.error;
          if (options.verbose)
            console.log(
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
            console.error(colors.red(`\n[DEBUG] EasyDL Error (${filename}):`), err);
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

            const completedSize = await getFileSize(tempPath);
            if (completedSize === null || !isDownloadedFileComplete(completedSize, expectedFileSize)) {
              if (completedSize !== null) {
                await fs.rm(tempPath, { force: true });
              }
              rejectDownload(
                new Error(
                  expectedFileSize.exact
                    ? `Download finished but file size is ${formatSize(completedSize ?? 0)}; expected ${formatSize(
                        expectedFileSize.size
                      )}`
                    : "Download finished but file is missing"
                )
              );
              return;
            }

            if (await isUnavailablePageFile(tempPath)) {
              await fs.rm(tempPath, { force: true });
              rejectDownload(new Error("Download returned the visuales unavailable-page response; retry later"));
              return;
            }

            if (shouldReplaceExistingFile) {
              await fs.rm(finalPath, { force: true });
            }
            await fs.rename(tempPath, finalPath);
            await cleanFileDownloadParts(tempPath);

            if (bars) {
              const sizeToLog = expectedFileSize.size || completedSize || downloadedTotal;
              const durationSeconds = (Date.now() - startedAt) / 1000;
              if (expectedFileSize.exact) {
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
              console.error(
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
      progressBars.log(
        `${colors.gray("·")} ${colors.bold.white(filename)} ${colors.yellow(
          `(Retrying after ${error.message}; attempt ${attempt + 1}/${maxFileAttempts})`
        )}\n`
      );
      await delay(retryDelay);
    }
  }
}

function isRelativeListingHref(href: string): boolean {
  return href !== "../" && !href.startsWith("?") && !href.startsWith("/") && !href.includes("://");
}

function getPreformattedListingSize(text: string | undefined): string {
  const fields = text?.trim().split(/\s+/) ?? [];

  return fields.at(-1) ?? "";
}

function addDirectoryListingEntry(
  href: string | undefined,
  sizeText: string,
  baseUrl: string,
  listing: DirectoryListing,
  seenUrls: Set<string>
): void {
  if (!href || !isRelativeListingHref(href)) return;

  const fullUrl = new URL(href, baseUrl).toString();
  if (seenUrls.has(fullUrl)) return;
  seenUrls.add(fullUrl);

  if (href.endsWith("/")) {
    listing.dirs.push(fullUrl);
    return;
  }

  const parsedSize = parseSize(sizeText);
  listing.files.push({
    url: fullUrl,
    size: parsedSize,
    exact: parsedSize > 0 && getListingSizeExactness(sizeText),
  });
}

export async function getDirectoryListing(url: string): Promise<DirectoryListing> {
  const cached = dirListingCache.get(url);
  if (cached && (cached.files.length > 0 || cached.dirs.length > 0)) {
    return cached;
  }

  const response = await fetch(url, {
    headers: {
      "User-Agent": DOWNLOAD_USER_AGENT,
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch directory listing: ${response.statusText} (${url})`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const result: DirectoryListing = { files: [], dirs: [], parserVersion: DIRECTORY_LISTING_PARSER_VERSION };
  const baseUrl = url.endsWith("/") ? url : url + "/";
  const seenUrls = new Set<string>();

  $("tr").each((_, element) => {
    const $row = $(element);
    const $link = $row.find("td a").first();
    const sizeText = $row.find("td").eq(3).text().trim();

    addDirectoryListingEntry($link.attr("href"), sizeText, baseUrl, result, seenUrls);
  });

  $("pre a").each((_, element) => {
    const href = $(element).attr("href");
    const nextSibling = element.nextSibling;
    const nextText = nextSibling?.type === "text" ? nextSibling.data : undefined;
    const sizeText = getPreformattedListingSize(nextText);

    addDirectoryListingEntry(href, sizeText, baseUrl, result, seenUrls);
  });

  if (result.files.length > 0 || result.dirs.length > 0) {
    dirListingCache.set(url, result);
    await saveDiscoveryCache();
  }
  return result;
}

async function summarizeDirectoryDownload(
  url: string,
  options: DownloadOptions,
  initialData?: DirectoryListing,
  relativePath: string = ""
): Promise<DownloadPlanSummary> {
  const { files, dirs } = initialData || (await getDirectoryListing(url));
  const isExcluded = createGlobMatcher(options.exclude);
  const summary: DownloadPlanSummary = {
    fileCount: 0,
    totalBytes: 0,
    hasSizeInfo: false,
    isEstimate: false,
  };

  for (const file of files) {
    const filename = decodeURIComponent(path.basename(file.url));
    const relativeFilePath = path.posix.join(relativePath, filename);
    if (isExcluded(filename) || isExcluded(relativeFilePath)) continue;

    summary.fileCount++;
    if (file.size > 0) {
      summary.hasSizeInfo = true;
      summary.totalBytes += file.size;
      if (!file.exact) summary.isEstimate = true;
    }
  }

  const subSummaries = await Promise.all(
    dirs.map(async (dirUrl) => {
      const dirName = decodeURIComponent(path.basename(new URL(dirUrl).pathname));
      return summarizeDirectoryDownload(dirUrl, options, undefined, path.posix.join(relativePath, dirName));
    })
  );

  for (const subSummary of subSummaries) {
    summary.fileCount += subSummary.fileCount;
    summary.totalBytes += subSummary.totalBytes;
    summary.hasSizeInfo ||= subSummary.hasSizeInfo;
    summary.isEstimate ||= subSummary.isEstimate;
  }

  return summary;
}

export async function downloadRecursive(
  url: string,
  options: DownloadOptions,
  limit: ReturnType<typeof pLimit>,
  onProgress?: (progress: DownloadProgress) => void,
  initialData?: { files: { url: string; size: number; exact?: boolean }[]; dirs: string[] },
  relativePath: string = "",
  fileCountProgress?: FileCountProgress
): Promise<DownloadFailure[]> {
  const { files, dirs } = initialData || (await getDirectoryListing(url));
  await fs.mkdir(options.output, { recursive: true });
  const isExcluded = createGlobMatcher(options.exclude);
  const failures: DownloadFailure[] = [];
  const includedFiles = files.filter((file) => {
    const filename = decodeURIComponent(path.basename(file.url));
    const relativeFilePath = path.posix.join(relativePath, filename);
    const excluded = isExcluded(filename) || isExcluded(relativeFilePath);

    if (excluded) {
      logDownloadSkipped(relativeFilePath, "excluded");
    }

    return !excluded;
  });

  const downloadTasks = includedFiles.map((file) =>
    limit(async () => {
      let lastDownloadedBytes = 0;
      const slot = acquireDownloadSlot(fileCountProgress);
      try {
        await downloadFile(
          file.url,
          options,
          (progress) => {
            lastDownloadedBytes = progress.downloadedSize;
            if (fileCountProgress) {
              const expectedBytes = file.size || progress.totalSize || progress.downloadedSize;
              fileCountProgress.activeBytes.set(file.url, Math.min(progress.downloadedSize, expectedBytes));
              fileCountProgress.activeSpeeds.set(file.url, progress.speedBytes ?? 0);
              fileCountProgress.activeFiles.set(file.url, {
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
              overall: fileCountProgress ? getOverallDownloadProgress(fileCountProgress) : undefined,
            });
          },
          file.size,
          slot,
          fileCountProgress?.slotBars[slot - 1]
        );
        if (fileCountProgress) {
          fileCountProgress.activeBytes.delete(file.url);
          fileCountProgress.activeSpeeds.delete(file.url);
          fileCountProgress.activeFiles.delete(file.url);
          fileCountProgress.completedFiles++;
          fileCountProgress.completedBytes += file.size || lastDownloadedBytes;
          updateOverallDownloadProgress(fileCountProgress);
        }
      } catch (err: unknown) {
        fileCountProgress?.activeBytes.delete(file.url);
        fileCountProgress?.activeSpeeds.delete(file.url);
        fileCountProgress?.activeFiles.delete(file.url);
        if (fileCountProgress) {
          updateOverallDownloadProgress(fileCountProgress);
        }
        // Log the error but don't rethrow to keep other downloads going
        const errorMsg = err instanceof Error ? err.message : String(err);
        progressBars.log(
          `${colors.bold.red("✖")} ${colors.bold.white(
            decodeURIComponent(path.basename(file.url))
          )} ${colors.red(`(Failed: ${errorMsg})`)}\n`
        );
        failures.push({
          filePath: path.posix.join(relativePath, decodeURIComponent(path.basename(file.url))),
          error: errorMsg,
        });
      } finally {
        releaseDownloadSlot(fileCountProgress, slot);
      }
    })
  );

  const recursionTasks = dirs.map(async (dirUrl) => {
    try {
      const dirName = decodeURIComponent(path.basename(new URL(dirUrl).pathname));
      const subOptions = { ...options, output: path.join(options.output, dirName) };
      return await downloadRecursive(
        dirUrl,
        subOptions,
        limit,
        onProgress,
        undefined,
        path.posix.join(relativePath, dirName),
        fileCountProgress
      );
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      failures.push({
        filePath: path.posix.join(relativePath, decodeURIComponent(path.basename(new URL(dirUrl).pathname))),
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

export async function stopProgress(): Promise<void> {
  progressBars.stop();
}

export async function downloadUrl(
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
      console.log(
        `${colors.cyan("●")} ${colors.bold.white("DISCOVERY  ")} ${summary.fileCount} files, ${dirs.length} subdirectories${sizeSummary}`
      );

      const fileCountProgress =
        summary.fileCount > 0
          ? {
              totalFiles: summary.fileCount,
              completedFiles: 0,
              totalBytes: summary.totalBytes,
              completedBytes: 0,
              activeBytes: new Map<string, number>(),
              activeSpeeds: new Map<string, number>(),
              activeFiles: new Map(),
              freeSlots: Array.from({ length: options.concurrent }, (_, index) => index + 1),
              nextSlot: options.concurrent + 1,
              bar: createFileCountBar(summary.fileCount),
              slotBars: [] as ReturnType<typeof createDownloadBar>[],
            }
          : undefined;
      if (fileCountProgress) {
        updateOverallDownloadProgress(fileCountProgress);
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
