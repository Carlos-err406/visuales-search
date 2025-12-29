import { DownloaderHelper } from "node-downloader-helper";
import * as cheerio from "cheerio";
import path from "path";
import fs from "fs/promises";
import colors from "ansi-colors";
import pLimit from "p-limit";
import cliProgress from "cli-progress";
import { getDiscoveryCache, setDiscoveryCache } from "./cache.js";

export interface DownloadOptions {
  output: string;
  resume: boolean;
  maxRetries: number;
  timeout: number;
  concurrent: number;
  verbose?: boolean;
}

export interface DownloadProgress {
  fileName: string;
  progress: number;
  speed: string;
  totalSize: number;
  downloadedSize: number;
}

const dirListingCache = new Map<string, { files: string[]; dirs: string[] }>();

async function loadDiscoveryCache() {
  const data = await getDiscoveryCache();
  if (data) {
    const keys = Object.keys(data);
    if (keys.length > 0) {
      console.log(colors.gray(`[CACHE] Discovery: ${keys.length} entries in local database`));
    }
    for (const [key, value] of Object.entries(data)) {
      dirListingCache.set(key, value as { files: string[]; dirs: string[] });
    }
  }
}

async function saveDiscoveryCache() {
  const data = Object.fromEntries(dirListingCache.entries());
  const keys = Object.keys(data);
  if (keys.length > 0) {
    console.log(colors.gray(`[CACHE] Saving ${keys.length} discovery entries`));
  }
  await setDiscoveryCache(data);
}

const progressBars = new cliProgress.MultiBar(
  {
    hideCursor: true,
    clearOnComplete: false,
    format: "{filename}", // Default, will be overridden
    forceRedraw: true,
  },
  cliProgress.Presets.shades_grey
);

let activeDownloadCount = 0;
const processedUrls = new Set<string>();
const downloadedUrls = new Set<string>();

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || isNaN(seconds) || !isFinite(seconds)) return "--:--:--";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h, m, s].map((v) => v.toString().padStart(2, "0")).join(":");
}

export async function downloadFile(
  url: string,
  options: DownloadOptions,
  onProgress?: (progress: DownloadProgress) => void
): Promise<void> {
  if (downloadedUrls.has(url)) return;
  downloadedUrls.add(url);

  // Ensure destination folder exists
  await fs.mkdir(options.output, { recursive: true });

  const filename = path.basename(url);
  const dl = new DownloaderHelper(url, options.output, {
    retry: { maxRetries: options.maxRetries, delay: 3000 },
    resumeOnIncomplete: options.resume,
    resumeIfFileExists: options.resume,
    timeout: options.timeout === Infinity ? undefined : options.timeout,
    override: {
      skip: options.resume,
      skipSmaller: options.resume,
    },
    forceResume: false,
  });

  let bars: { header: cliProgress.SingleBar; progress: cliProgress.SingleBar } | null = null;

  const createBar = (total: number, current: number, status: string = "Starting") => {
    if (!bars) {
      activeDownloadCount++;

      // Row 1: Name (Status)
      const header = progressBars.create(
        1,
        0,
        { filename: `${colors.cyan("●")} ${colors.bold.white(filename)} ${colors.gray(status)}` },
        { format: "{filename}" }
      );
      // Row 2: Bar % | Downloaded/Total | Speed | ETA
      const progress = progressBars.create(
        total,
        current,
        {
          speed: "---".padEnd(10, " "),
          downloadedPadded: `${formatSize(current)} / ${formatSize(total)}`.padEnd(25, " "),
          percentagePadded: current.toString().padStart(3, " "),
          etaPadded: "ETA: --:--:--".padEnd(14, " "),
        },
        {
          format: `  ${colors.green("{bar}")} ${colors.bold.white("{percentagePadded}%")}  ${colors.gray("•")}  ${colors.gray("{downloadedPadded}")}  ${colors.gray("•")}  ${colors.yellow("{speed}")}  ${colors.gray("•")}  ${colors.cyan("{etaPadded}")}`,
          barCompleteChar: "━",
          barIncompleteChar: "─",
          barsize: 25,
        }
      );
      bars = { header, progress };
    }
  };

  if (options.verbose) {
    console.log(colors.gray(`\n[DEBUG] Downloading ${url} to ${options.output}`));
  }

  return new Promise((resolve, reject) => {
    dl.on("start", () => {
      // Don't create bar here yet, wait for progress or resume to avoid showing bars for skipped files
      if (options.verbose) console.log(colors.gray(`[DEBUG] Started: ${filename}`));
    });

    dl.on("resume", (isResume) => {
      if (isResume) {
        createBar(100, 0, "Resuming");
        if (bars) {
          bars.header.update(0, {
            filename: `${colors.cyan("●")} ${colors.bold.white(filename)} ${colors.dim("(Resuming)")}`,
          });
        }
      }
    });

    dl.on("retry", (attempt, _opts, err) => {
      if (options.verbose)
        console.log(colors.yellow(`[DEBUG] Retry ${attempt}: ${filename} - ${err?.message || "Unknown error"}`));
    });

    dl.on("end", () => {
      if (bars) {
        const total = bars.progress.getTotal();
        const sizeStr = formatSize(total);
        progressBars.log(
          `${colors.gray("·")} ${colors.bold.white(filename)} ${colors.gray(`(${sizeStr})`)} ${colors.green("(Done)")}\n`
        );

        progressBars.remove(bars.header);
        progressBars.remove(bars.progress);
        activeDownloadCount--;
      }
      resolve();
    });

    dl.on("skip", async (_stats) => {
      try {
        const fullPath = path.join(options.output, filename);
        const stats = await fs.stat(fullPath);
        const sizeStr = formatSize(stats.size);
        progressBars.log(
          `${colors.gray("·")} ${colors.dim(filename)} ${colors.gray(`(${sizeStr})`)} ${colors.dim("(Already exists)")}\n`
        );
      } catch {
        progressBars.log(`${colors.gray("·")} ${colors.dim(filename)} ${colors.dim("(Already exists)")}\n`);
      }
      resolve();
    });

    dl.on("error", (err) => {
      if (bars) {
        bars.header.update(0, { filename: `${colors.bold.red(filename)} ${colors.red(`(Error: ${err.message})`)}` });
        bars.header.stop();
        bars.progress.stop();
      }
      reject(err);
    });

    dl.on("progress", (stats) => {
      // Create bar on first progress if it hasn't been created by resume
      createBar(stats.total, stats.downloaded, "Downloading");

      if (bars) {
        bars.progress.setTotal(stats.total);
        const progressVal = Math.floor(stats.progress);
        const paddedPercentage = progressVal.toString().padStart(3, " ");
        const sizeStr = `${formatSize(stats.downloaded)} / ${formatSize(stats.total)}`.padEnd(25, " ");

        const remainingBytes = stats.total - stats.downloaded;
        const etaSeconds = stats.speed > 0 ? remainingBytes / stats.speed : null;
        const etaStr = `ETA: ${formatDuration(etaSeconds)}`.padEnd(14, " ");
        const speedStr = `${(stats.speed / 1024 / 1024).toFixed(2)} MB/s`.padEnd(10, " ");

        bars.progress.update(stats.downloaded, {
          speed: speedStr,
          downloadedPadded: sizeStr,
          percentagePadded: paddedPercentage,
          etaPadded: etaStr,
        });
      }
      if (onProgress) {
        onProgress({
          fileName: filename,
          progress: stats.progress,
          speed: `${(stats.speed / 1024 / 1024).toFixed(2)} MB/s`,
          totalSize: stats.total,
          downloadedSize: stats.downloaded,
        });
      }
    });

    dl.start().catch((err) => {
      if (bars) {
        bars.header.stop();
        bars.progress.stop();
      }
      reject(err);
    });
  });
}

export async function getDirectoryListing(url: string): Promise<{ files: string[]; dirs: string[] }> {
  const cached = dirListingCache.get(url);
  if (cached && (cached.files.length > 0 || cached.dirs.length > 0)) {
    console.log(colors.gray(`[CACHE] HIT:  ${url}`));
    return cached;
  }

  console.log(colors.gray(`[CACHE] MISS: ${url}`));

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch directory listing: ${response.statusText} (${response.status})`);
  }

  // Detect redirects to error pages
  if (response.redirected && (response.url.includes("oops") || response.url.includes("not-available"))) {
    throw new Error(`URL is restricted or unavailable (Redirected to: ${response.url})`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  // Basic validation: Check if it's actually a directory listing
  const title = $("title").text();
  if (title.includes("Service Unavailable") || title.includes("503") || title.includes("Blocked")) {
    throw new Error(`Server returned error page: ${title}`);
  }

  const files: string[] = [];
  const dirs: string[] = [];

  const baseUrl = url.endsWith("/") ? url : url + "/";

  $("a").each((_, element) => {
    const href = $(element).attr("href");
    if (!href || href.startsWith("?") || href.startsWith("/") || href.includes("://")) return;

    // Ignore parent directory link
    if (href === "../") return;

    const fullUrl = new URL(href, baseUrl).toString();
    if (href.endsWith("/")) {
      dirs.push(fullUrl);
    } else {
      files.push(fullUrl);
    }
  });

  if (files.length === 0 && dirs.length === 0) {
    // If we have text but no links, it might be an error page without a clear title
    const bodyText = $("body").text().trim();
    if (bodyText.length < 500 && (bodyText.includes("Service Unavailable") || bodyText.includes("Access Denied"))) {
      throw new Error(`Possibly blocked or service unavailable: ${bodyText.substring(0, 100)}...`);
    }
  }

  // Deduplicate and filter out common Apache navigation/sorting links
  const result = {
    files: [...new Set(files)].filter((f) => !f.includes("?C=")),
    dirs: [...new Set(dirs)].filter((d) => {
      if (d.includes("?C=")) return false;
      const pathname = new URL(d).pathname;
      const normalizedPath = pathname.endsWith("/") ? pathname : pathname + "/";
      const parentNormalPath = new URL(url).pathname.endsWith("/")
        ? new URL(url).pathname
        : new URL(url).pathname + "/";

      // Skip current directory (.) and parent directory (..)
      if (normalizedPath === parentNormalPath) return false;
      if (normalizedPath === path.posix.dirname(parentNormalPath.replace(/\/$/, "")) + "/") return false;

      return true;
    }),
  };
  // Only cache if we found something, to avoid poisoning the cache with empty results from blocked connections
  if (files.length > 0 || dirs.length > 0) {
    dirListingCache.set(url, result);
    // Persist immediately so we don't lose discovery if the download is long or interrupted
    await saveDiscoveryCache();
  }
  return result;
}

export async function downloadRecursive(
  url: string,
  options: DownloadOptions,
  limit: ReturnType<typeof pLimit>,
  onProgress?: (progress: DownloadProgress) => void,
  initialData?: { files: string[]; dirs: string[] }
): Promise<void> {
  const { files, dirs } = initialData || (await getDirectoryListing(url));

  // Create output directory if it doesn't exist
  await fs.mkdir(options.output, { recursive: true });

  // Queue downloads
  const downloadTasks = files.map((fileUrl) => limit(() => downloadFile(fileUrl, options, onProgress)));

  // Queue recursion
  const recursionTasks = dirs.map((dirUrl) => {
    const dirName = path.basename(new URL(dirUrl).pathname);
    const subOptions = {
      ...options,
      output: path.join(options.output, dirName),
    };
    return downloadRecursive(dirUrl, subOptions, limit, onProgress);
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
        throw new Error("No files or subdirectories found at this URL. The content might be restricted or private.");
      } else {
        console.log(
          `${colors.cyan("●")} ${colors.bold.white("DISCOVERY")}  ` +
            `${files.length} files, ${dirs.length} subdirectories`
        );
      }
      await downloadRecursive(url, options, limit, onProgress, { files, dirs });
    } else {
      await limit(() => downloadFile(url, options, onProgress));
    }
  } finally {
    await saveDiscoveryCache();
  }
}
