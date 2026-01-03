import EasyDl from "easydl";
import * as cheerio from "cheerio";
import path from "path";
import fs from "fs/promises";
import colors from "ansi-colors";
import pLimit from "p-limit";
import { DownloadOptions, DownloadProgress } from "./types.js";
import { formatSize, formatDuration, parseSize } from "./utils.js";
import { dirListingCache, loadDiscoveryCache, saveDiscoveryCache, updateCachedFileSize } from "./discovery-cache.js";
import {
  progressBars,
  createDownloadBar,
  logDownloadComplete,
  decrementActiveDownloads,
  incrementActiveDownloads,
} from "./ui.js";

const processedUrls = new Set<string>();
const downloadedUrls = new Set<string>();

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
  const dl = new EasyDl(url, path.join(options.output, filename), {
    connections: 3,
    existBehavior: "ignore",
    maxRetry: 10,
    retryDelay: 5000,
    retryBackoff: 3000,
    chunkSize: (size) => Math.max(size / 5, 10 * 1024 * 1024), // Min 10MB chunks to avoid tiny-file spam
    httpOptions: {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    },
  });

  let downloadedTotal = 0;
  let bars: ReturnType<typeof createDownloadBar> | null = null;

  return new Promise((resolve, reject) => {
    let decremented = false;
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
        console.log(colors.gray(`[DEBUG] Metadata: ${filename} - Size: ${meta.size} bytes`));
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

    dl.on("end", () => {
      if (bars) {
        const sizeToLog = expectedSize || downloadedTotal;
        updateCachedFileSize(url, sizeToLog);
        logDownloadComplete(filename, sizeToLog);
        progressBars.remove(bars.header);
        progressBars.remove(bars.progress);
      }
      cleanup();
    });

    dl.on("error", (err) => {
      const errorMsg = err.message || String(err);
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
      .then((completed) => {
        if (!completed && !options.resume) {
          // If not completed and we didn't ask to resume, it might be a partial failure
          reject(new Error("Download finished but file is incomplete"));
          return;
        }
        resolve();
      })
      .catch((err: any) => {
        const isAbort = err.message === "aborted" || err.code === "ECONNRESET";
        if (options.verbose) {
          console.error(
            colors.red(`\n[DEBUG] dl.wait() ${isAbort ? "Aborted/Reset" : "Rejected"} (${filename}):`),
            err
          );
        }
        if (bars) {
          const status = isAbort ? "(Connection Reset)" : `(Error: ${err.message})`;
          bars.header.update(0, {
            filename: `${colors.bold.red(filename)} ${colors.red(status)}`,
          });
          bars.header.stop();
          bars.progress.stop();
        }
        cleanup(); // Ensure UI count is decremented even on failure
        reject(err);
      });
  });
}

export async function getDirectoryListing(
  url: string
): Promise<{ files: { url: string; size: number; exact?: boolean }[]; dirs: string[] }> {
  const cached = dirListingCache.get(url);
  if (cached && (cached.files.length > 0 || cached.dirs.length > 0)) {
    return cached;
  }

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch directory listing: ${response.statusText} (${url})`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const files: { url: string; size: number; exact?: boolean }[] = [];
  const dirs: string[] = [];
  const baseUrl = url.endsWith("/") ? url : url + "/";

  $("tr").each((_, element) => {
    const $row = $(element);
    const $link = $row.find("td a").first();
    const href = $link.attr("href");
    if (!href || href === "../" || href.startsWith("?") || href.startsWith("/") || href.includes("://")) return;

    const sizeText = $row.find("td").eq(3).text().trim();
    const fullUrl = new URL(href, baseUrl).toString();

    if (href.endsWith("/")) {
      dirs.push(fullUrl);
    } else {
      const parsedSize = parseSize(sizeText);
      files.push({
        url: fullUrl,
        size: parsedSize,
        exact: parsedSize > 0, // Only mark as exact if we got a valid size
      });
    }
  });

  const result = { files, dirs };
  if (files.length > 0 || dirs.length > 0) {
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
  initialData?: { files: { url: string; size: number; exact?: boolean }[]; dirs: string[] }
): Promise<void> {
  const { files, dirs } = initialData || (await getDirectoryListing(url));
  await fs.mkdir(options.output, { recursive: true });

  const downloadTasks = files.map((file) =>
    limit(async () => {
      try {
        await downloadFile(file.url, options, onProgress, file.size);
      } catch (err: any) {
        // Log the error but don't rethrow to keep other downloads going
        const errorMsg = err.message || String(err);
        progressBars.log(
          `${colors.bold.red("✖")} ${colors.bold.white(
            decodeURIComponent(path.basename(file.url))
          )} ${colors.red(`(Failed: ${errorMsg})`)}\n`
        );
      }
    })
  );

  const recursionTasks = dirs.map(async (dirUrl) => {
    try {
      const dirName = decodeURIComponent(path.basename(new URL(dirUrl).pathname));
      const subOptions = { ...options, output: path.join(options.output, dirName) };
      await downloadRecursive(dirUrl, subOptions, limit, onProgress);
    } catch (err: any) {
      // Sub-directory traversal failed, but we continue
    }
  });

  await Promise.all([...downloadTasks, ...recursionTasks]);
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

      await downloadRecursive(url, options, limit, onProgress, { files, dirs });
    } else {
      await downloadFile(url, options, onProgress);
    }
  } finally {
    await saveDiscoveryCache();
  }
}
