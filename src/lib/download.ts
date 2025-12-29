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
    for (const [key, value] of Object.entries(data)) {
      dirListingCache.set(key, value as { files: string[]; dirs: string[] });
    }
  }
}

async function saveDiscoveryCache() {
  const data = Object.fromEntries(dirListingCache.entries());
  await setDiscoveryCache(data);
}

const progressBars = new cliProgress.MultiBar(
  {
    format: `${colors.cyan("{bar}")} {percentage}% | {filename} | {speed}`,
    barCompleteChar: "\u2588",
    barIncompleteChar: "\u2591",
    hideCursor: true,
    clearOnComplete: false,
  },
  cliProgress.Presets.shades_grey
);

export async function downloadFile(
  url: string,
  options: DownloadOptions,
  onProgress?: (progress: DownloadProgress) => void
): Promise<void> {
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

  let bar: ReturnType<typeof progressBars.create> | null = null;

  const createBar = (total: number, current: number, status: string = "Starting...") => {
    if (!bar) {
      bar = progressBars.create(total, current, {
        filename,
        speed: status,
      });
    }
  };

  if (options.verbose) {
    console.log(colors.gray(`\n[DEBUG] Downloading ${url} to ${options.output}`));
  }

  return new Promise((resolve, reject) => {
    dl.on("start", () => {
      createBar(100, 0);
      if (options.verbose) console.log(colors.gray(`[DEBUG] Started: ${filename}`));
    });

    dl.on("resume", (isResume) => {
      if (isResume) {
        if (options.verbose) console.log(colors.blue(`[DEBUG] Resuming: ${filename}`));
        createBar(100, 0, "Resuming...");
        if (bar) bar.update(0, { speed: "Resuming..." });
      }
    });

    dl.on("retry", (attempt, opts, err) => {
      if (options.verbose)
        console.log(colors.yellow(`[DEBUG] Retry ${attempt}: ${filename} - ${err?.message || "Unknown error"}`));
    });

    dl.on("end", () => {
      if (bar) {
        bar.update(100, { speed: "Done" });
        bar.stop();
      }
      if (options.verbose) console.log(colors.green(`[DEBUG] Finished: ${filename}`));
      resolve();
    });

    dl.on("skip", (_stats) => {
      if (options.verbose) console.log(colors.cyan(`[DEBUG] Skipped: ${filename} (Already exists)`));
      createBar(100, 100, "Already exists");
      if (bar) bar.update(100, { speed: "Already exists" });
      if (bar) bar.stop();
      resolve();
    });

    dl.on("error", (err) => {
      if (options.verbose) console.log(colors.red(`[DEBUG] Error: ${filename} - ${err.message}`));
      if (bar) bar.stop();
      reject(err);
    });

    dl.on("progress", (stats) => {
      if (bar) {
        bar.update(stats.progress, {
          speed: `${(stats.speed / 1024 / 1024).toFixed(2)} MB/s`,
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
      if (bar) bar.stop();
      reject(err);
    });
  });
}

export async function getDirectoryListing(url: string): Promise<{ files: string[]; dirs: string[] }> {
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

  const result = { files, dirs };
  // Only cache if we found something, to avoid poisoning the cache with empty results from blocked connections
  if (files.length > 0 || dirs.length > 0) {
    dirListingCache.set(url, result);
  }
  return result;
}

export async function downloadRecursive(
  url: string,
  options: DownloadOptions,
  limit: ReturnType<typeof pLimit>,
  onProgress?: (progress: DownloadProgress) => void
): Promise<void> {
  const { files, dirs } = await getDirectoryListing(url);

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
        console.log(colors.gray(`🔍 Discovered ${files.length} files and ${dirs.length} subdirectories`));
      }
      await downloadRecursive(url, options, limit, onProgress);
    } else {
      await limit(() => downloadFile(url, options, onProgress));
    }
  } finally {
    await saveDiscoveryCache();
  }
}
