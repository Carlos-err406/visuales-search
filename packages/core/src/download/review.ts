import fs from "node:fs/promises";
import path from "node:path";
import pLimit from "p-limit";
import { getDirectoryListing, type DownloadTarget } from "./downloader.js";
import { getCachedFileSizeInfo, loadDiscoveryCache } from "./discovery-cache.js";
import { createIgnoreMatcher } from "./ignore-rules.js";
import { fetchExpectedFileSize } from "./http.js";
import { decodePathSegment } from "./targets.js";
import type { DownloadOptions } from "./types.js";

export interface DownloadReviewEntry {
  url: string;
  path: string;
  kind: "file" | "directory";
  ignored: boolean;
  bytes: number | null;
  estimated: boolean;
}

export interface DownloadReview {
  output: string;
  entries: DownloadReviewEntry[];
  includedFiles: number;
  ignoredFiles: number;
  ignoredDirectories: number;
  knownBytes: number;
  estimated: boolean;
  unknownFiles: number;
  availableBytes: number | null;
  spaceWarning: boolean;
  checkedAt: number;
}

export async function availableDownloadSpace(output: string): Promise<number | null> {
  let directory = path.resolve(output);
  for (;;) {
    try {
      const stat = await fs.statfs(directory);
      const available = stat.bavail * stat.bsize;
      return Number.isSafeInteger(available) && available >= 0 ? available : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return null;
      const parent = path.dirname(directory);
      if (parent === directory) return null;
      directory = parent;
    }
  }
}

/** Metadata-only review. Explicit file targets bypass ignore rules, just like downloadUrls. */
export async function reviewDownload(
  targets: DownloadTarget[],
  options: DownloadOptions,
  capacity: (output: string) => Promise<number | null> = availableDownloadSpace
): Promise<DownloadReview> {
  if (!targets.length) throw new Error("Choose at least one download target.");
  await loadDiscoveryCache();
  const ignored = createIgnoreMatcher(options.exclude);
  const limit = pLimit(4);
  const entries: DownloadReviewEntry[] = [];
  const seen = new Set<string>();
  const basename = (url: string) => decodePathSegment(new URL(url).pathname.replace(/\/$/, "").split("/").at(-1)!);
  async function walk(url: string, relative: string) {
    const key = `${url}\n${relative}`;
    if (seen.has(key)) return;
    seen.add(key);
    const listing = await limit(() => getDirectoryListing(url, { allowEmptyCache: true }));
    for (const file of listing.files) {
      const name = path.posix.join(relative, basename(file.url));
      entries.push({
        url: file.url,
        path: name,
        kind: "file",
        ignored: ignored(name),
        bytes: file.size > 0 ? file.size : null,
        estimated: !file.exact,
      });
    }
    await Promise.all(
      listing.dirs.map(async (child) => {
        const name = path.posix.join(relative, basename(child));
        if (ignored(`${name}/`))
          entries.push({
            url: child,
            path: `${name}/`,
            kind: "directory",
            ignored: true,
            bytes: null,
            estimated: false,
          });
        else await walk(child, name);
      })
    );
  }
  for (const target of targets) {
    if (!["http:", "https:"].includes(new URL(target.url).protocol))
      throw new Error("Only HTTP and HTTPS downloads are supported");
    if (target.url.endsWith("/")) await walk(target.url, target.relativePath);
    else {
      const remote = await fetchExpectedFileSize(target.url, options);
      const cached = getCachedFileSizeInfo(target.url);
      const size = remote.size ? remote : cached;
      entries.push({
        url: target.url,
        path: path.posix.join(target.relativePath, basename(target.url)),
        kind: "file",
        ignored: false,
        bytes: size.size > 0 ? size.size : null,
        estimated: !size.exact,
      });
    }
  }
  entries.sort((a, b) => a.path.localeCompare(b.path) || a.url.localeCompare(b.url));
  const included = entries.filter((entry) => !entry.ignored);
  const knownBytes = included.reduce((sum, entry) => sum + (entry.bytes ?? 0), 0);
  const availableBytes = await capacity(options.output);
  return {
    output: path.resolve(options.output),
    entries,
    includedFiles: included.length,
    ignoredFiles: entries.filter((entry) => entry.ignored && entry.kind === "file").length,
    ignoredDirectories: entries.filter((entry) => entry.ignored && entry.kind === "directory").length,
    knownBytes,
    estimated: included.some((entry) => entry.bytes !== null && entry.estimated),
    unknownFiles: included.filter((entry) => entry.bytes === null).length,
    availableBytes,
    spaceWarning: availableBytes !== null && knownBytes > availableBytes,
    checkedAt: Date.now(),
  };
}
