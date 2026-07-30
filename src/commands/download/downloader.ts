import EasyDl from "easydl";
import * as cheerio from "cheerio";
import { execFile } from "node:child_process";
import path from "path";
import fs from "fs/promises";
import colors from "ansi-colors";
import pLimit from "p-limit";
import { DownloadOptions, DownloadProgress } from "./types.js";
import { createGlobMatcher, formatSize, formatDuration, parseSize } from "./utils.js";
import {
  DIRECTORY_LISTING_PARSER_VERSION,
  dirListingCache,
  getCachedFileSize,
  loadDiscoveryCache,
  saveDiscoveryCache,
  updateCachedFileSize,
  type DirectoryListing,
} from "./discovery-cache.js";
import {
  progressBars,
  createDownloadBar,
  logDownloadComplete,
  logDownloadSkipped,
  decrementActiveDownloads,
  incrementActiveDownloads,
} from "./ui.js";

const downloadedUrls = new Set<string>();
const SMALL_FILE_SINGLE_CONNECTION_THRESHOLD = 10 * 1024 * 1024;
const PARTS_DIRECTORY_NAME = ".visuales-parts";
const DOWNLOAD_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

interface DownloadFailure {
  filePath: string;
  error: string;
}

function formatDownloadFailures(failures: DownloadFailure[]): string {
  const shownFailures = failures
    .slice(0, 10)
    .map((failure) => `- ${failure.filePath}: ${failure.error}`)
    .join("\n");
  const remainingCount = failures.length - 10;
  const suffix = remainingCount > 0 ? `\n...and ${remainingCount} more.` : "";

  return `${failures.length} download${failures.length === 1 ? "" : "s"} failed:\n${shownFailures}${suffix}`;
}

function getConnectionCount(options: DownloadOptions, expectedSize?: number): number {
  if (expectedSize && expectedSize <= SMALL_FILE_SINGLE_CONNECTION_THRESHOLD) {
    return 1;
  }

  return Math.max(1, options.connections);
}

async function fetchExpectedFileSize(url: string, options: DownloadOptions): Promise<number> {
  try {
    const timeoutMs = Number.isFinite(options.timeout) ? options.timeout * 1000 : undefined;
    const response = await fetch(url, {
      method: "HEAD",
      headers: {
        "User-Agent": DOWNLOAD_USER_AGENT,
      },
      signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
    });
    const contentLength = response.headers.get("content-length");
    const size = contentLength ? parseInt(contentLength, 10) : 0;

    return response.ok && Number.isFinite(size) ? size : 0;
  } catch {
    return 0;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
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
    await fs.rmdir(directory);
  } catch {
    // Keep the sidecar directory when other downloads still have active or resumable parts.
  }
}

export async function downloadFile(
  url: string,
  options: DownloadOptions,
  onProgress?: (progress: DownloadProgress) => void,
  expectedSize?: number
): Promise<void> {
  if (downloadedUrls.has(url)) return;
  downloadedUrls.add(url);

  await fs.mkdir(options.output, { recursive: true });

  const encodedFilename = path.basename(url);
  const filename = decodeURIComponent(encodedFilename);
  expectedSize ||= getCachedFileSize(url);
  expectedSize ||= await fetchExpectedFileSize(url, options);
  const connections = getConnectionCount(options, expectedSize);
  const startedAt = Date.now();
  const finalPath = path.join(options.output, filename);
  const partsDirectory = path.join(options.output, PARTS_DIRECTORY_NAME);
  const tempPath = path.join(partsDirectory, filename);

  if (await fileExists(finalPath)) {
    logDownloadSkipped(filename, "already exists");
    return;
  }

  await fs.mkdir(partsDirectory, { recursive: true });
  hidePartsDirectory(partsDirectory);

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
  let bars: ReturnType<typeof createDownloadBar> | null = null;

  return new Promise((resolve, reject) => {
    let decremented = false;
    let lastDownloadError: Error | null = null;
    const cleanup = () => {
      if (bars && !decremented) {
        decrementActiveDownloads();
        decremented = true;
      }
    };

    dl.on("metadata", (meta) => {
      if (meta.size) {
        expectedSize = meta.size;
        updateCachedFileSize(url, meta.size);
        if (bars) {
          bars.progress.setTotal(100); // We've confirmed size, percentage is safe now
        }
      }
      if (options.verbose) {
        console.log(
          colors.gray(`[DEBUG] Metadata: ${filename} - Size: ${meta.size} bytes, Connections: ${connections}`)
        );
      }
    });

    dl.on("retry", (retryInfo) => {
      if (options.verbose)
        console.log(
          colors.yellow(`[DEBUG] Retry: ${filename} - Chunk ${retryInfo.chunkId} - ${retryInfo.error.message}`)
        );
    });

    dl.on("build", (progress) => {
      if (bars) {
        bars.header.update(0, {
          filename: `${colors.cyan("●")} ${colors.bold.white(filename)} ${colors.yellow("(Assembling)")}`,
        });
        bars.progress.update(progress.percentage);
      }
    });

    dl.on("error", (err) => {
      const errorMsg = err.message || String(err);
      lastDownloadError = err instanceof Error ? err : new Error(errorMsg);
      if (options.verbose) {
        console.error(colors.red(`\n[DEBUG] EasyDL Error (${filename}):`), err);
      }
      if (bars) {
        const isAbort = err.message === "aborted" || ("code" in err && err.code === "ECONNRESET");
        const status = isAbort ? "(Connection Reset)" : `(Error: ${errorMsg})`;
        bars.header.update(0, {
          filename: `${colors.bold.red(filename)} ${colors.red(status)}`,
        });
        bars.header.stop();
        bars.progress.stop();
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
        bars = createDownloadBar(filename, 100, currentPercentage, "Downloading");
      }
      updateCachedFileSize(url, downloadedBytes);

      if (bars) {
        const progressVal = Math.floor(currentPercentage);
        const paddedPercentage = progressVal.toString().padStart(3, " ");
        const totalEstimate = expectedSize || (currentPercentage > 0 ? downloadedBytes / (currentPercentage / 100) : 0);
        const sizeStr = `${formatSize(downloadedBytes)} / ${formatSize(totalEstimate)}`.padEnd(25, " ");
        const speedStr = `${(currentSpeed / 1024 / 1024).toFixed(2)} MB/s`.padEnd(10, " ");
        const remainingBytes = totalEstimate - downloadedBytes;
        const etaSeconds = currentSpeed > 0 && remainingBytes > 0 ? remainingBytes / currentSpeed : null;
        const etaStr = `ETA: ${formatDuration(etaSeconds)}`.padEnd(14, " ");

        bars.progress.update(progressVal, {
          speed: speedStr,
          downloadedPadded: sizeStr,
          percentagePadded: paddedPercentage,
          etaPadded: etaStr,
        });
      }

      if (onProgress) {
        onProgress({
          fileName: filename,
          progress: currentPercentage,
          speed: `${(currentSpeed / 1024 / 1024).toFixed(2)} MB/s`,
          totalSize: expectedSize || 0,
          downloadedSize: downloadedBytes,
        });
      }
    });

    dl.wait()
      .then(async (completed) => {
        if (!completed) {
          cleanup();
          reject(lastDownloadError ?? new Error("Download finished but file is incomplete"));
          return;
        }

        if (completed) {
          await fs.rename(tempPath, finalPath);
          await removePartsDirectoryIfEmpty(partsDirectory);

          if (bars) {
            const sizeToLog = expectedSize || downloadedTotal;
            const durationSeconds = (Date.now() - startedAt) / 1000;
            updateCachedFileSize(url, sizeToLog);
            logDownloadComplete(filename, sizeToLog, durationSeconds);
            progressBars.remove(bars.header);
            progressBars.remove(bars.progress);
          }
        }

        cleanup();
        resolve();
      })
      .catch((err: unknown) => {
        const error = err instanceof Error ? err : new Error(String(err));
        lastDownloadError = error;
        const errorCode = typeof err === "object" && err !== null && "code" in err ? err.code : undefined;
        const isAbort = error.message === "aborted" || errorCode === "ECONNRESET";
        if (options.verbose) {
          console.error(
            colors.red(`\n[DEBUG] dl.wait() ${isAbort ? "Aborted/Reset" : "Rejected"} (${filename}):`),
            err
          );
        }
        if (bars) {
          const status = isAbort ? "(Connection Reset)" : `(Error: ${error.message})`;
          bars.header.update(0, {
            filename: `${colors.bold.red(filename)} ${colors.red(status)}`,
          });
          bars.header.stop();
          bars.progress.stop();
        }
        cleanup(); // Ensure UI count is decremented even on failure
        reject(error);
      });
  });
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
    exact: parsedSize > 0,
  });
}

export async function getDirectoryListing(url: string): Promise<DirectoryListing> {
  const cached = dirListingCache.get(url);
  if (
    cached?.parserVersion === DIRECTORY_LISTING_PARSER_VERSION &&
    (cached.files.length > 0 || cached.dirs.length > 0)
  ) {
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

export async function downloadRecursive(
  url: string,
  options: DownloadOptions,
  limit: ReturnType<typeof pLimit>,
  onProgress?: (progress: DownloadProgress) => void,
  initialData?: { files: { url: string; size: number; exact?: boolean }[]; dirs: string[] },
  relativePath: string = ""
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
      try {
        await downloadFile(file.url, options, onProgress, file.size);
      } catch (err: unknown) {
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
        path.posix.join(relativePath, dirName)
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
  const subFailures = await Promise.all(recursionTasks);

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

      let totalBytes = 0;
      let hasSizeInfo = false;
      let isEstimate = false;
      for (const f of files) {
        if (f.size > 0) {
          hasSizeInfo = true;
          totalBytes += f.size;
          if (!f.exact) isEstimate = true;
        }
      }

      const sizeSummary = hasSizeInfo ? colors.gray(` [${isEstimate ? "~" : ""}${formatSize(totalBytes)}]`) : "";
      console.log(
        `${colors.cyan("●")} ${colors.bold.white("DISCOVERY  ")} ${files.length} files, ${dirs.length} subdirectories${sizeSummary}`
      );

      const failures = await downloadRecursive(url, options, limit, onProgress, { files, dirs });

      if (failures.length > 0) {
        throw new Error(formatDownloadFailures(failures));
      }
    } else {
      await downloadFile(url, options, onProgress);
    }
  } finally {
    await saveDiscoveryCache();
  }
}
