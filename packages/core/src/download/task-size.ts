import path from "node:path";
import { libraryUrl } from "../library-listing.js";
import { fileIndexRevision, readFileIndex, type IndexedDirectory } from "../search-file-index.js";
import { CONFIG } from "../lib/types.js";
import { createIgnoreMatcher } from "./ignore-rules.js";
import { createDownloadTargets, decodePathSegment } from "./targets.js";
import type { DownloadTaskRecord } from "./tasks.js";

type SizeEstimate = NonNullable<DownloadTaskRecord["sizeEstimate"]>;
let revision: string | undefined;
const estimates = new Map<string, SizeEstimate | undefined>();

function estimateTask(task: DownloadTaskRecord, directories: Map<string, IndexedDirectory>): SizeEstimate | undefined {
  const urls = (task.urls?.length ? task.urls : [task.url]).map((url) => libraryUrl(url).href);
  const targets = urls.length === 1 ? [{ url: urls[0], relativePath: "" }] : createDownloadTargets(urls, task.output);
  const ignored = createIgnoreMatcher(task.options.exclude);
  const seen = new Set<string>();
  let totalBytes = 0;
  let totalFiles = 0;
  const basename = (url: string) => decodePathSegment(new URL(url).pathname.replace(/\/$/, "").split("/").at(-1)!);
  const add = (size: number | undefined) => {
    if (size === undefined || !Number.isFinite(size) || size <= 0) return false;
    totalBytes += size;
    totalFiles++;
    return Number.isFinite(totalBytes);
  };
  function walk(url: string, relative: string): boolean {
    const key = `${url}\n${relative}`;
    if (seen.has(key)) return true;
    seen.add(key);
    if (!url.endsWith("/")) {
      const parent = directories.get(url.slice(0, url.lastIndexOf("/") + 1));
      return add(parent?.entries.find((entry) => entry.encodedUrl === url)?.size);
    }
    const directory = directories.get(url);
    if (!directory) return false;
    for (const entry of directory.entries) {
      const name = path.posix.join(relative, basename(entry.encodedUrl));
      if (ignored(entry.isDirectoryLink ? `${name}/` : name)) continue;
      if (entry.isDirectoryLink) {
        if (!walk(entry.encodedUrl, name)) return false;
      } else {
        const fileKey = `${entry.encodedUrl}\n${name}`;
        if (seen.has(fileKey)) continue;
        seen.add(fileKey);
        if (!add(entry.size)) return false;
      }
    }
    return true;
  }
  // Missing branches or unknown file sizes must not be presented as a whole-folder total.
  return targets.every((target) => walk(target.url, target.relativePath)) ? { totalBytes, totalFiles } : undefined;
}

/** Enrich display snapshots only: no requests, task writes, progress updates, or worker starts. */
export async function withCachedTaskSizes(tasks: DownloadTaskRecord[]): Promise<DownloadTaskRecord[]> {
  const needsSize = (task: DownloadTaskRecord) =>
    ["interrupted", "failed", "queued"].includes(task.status) && !((task.overallProgress?.totalBytes ?? 0) > 0);
  if (!tasks.some(needsSize)) return tasks;
  try {
    const index = await readFileIndex();
    const current = `${CONFIG.CACHE_DIR}:${fileIndexRevision(index)}`;
    if (current !== revision) {
      estimates.clear();
      revision = current;
    }
    const used = new Set<string>();
    const result = tasks.map((task) => {
      if (!needsSize(task)) return task;
      const key = JSON.stringify([task.url, task.urls, task.output, task.options.exclude]);
      used.add(key);
      if (!estimates.has(key)) {
        try {
          estimates.set(key, estimateTask(task, index.directories));
        } catch {
          estimates.set(key, undefined);
        }
      }
      const sizeEstimate = estimates.get(key);
      return sizeEstimate ? { ...task, sizeEstimate } : task;
    });
    for (const key of estimates.keys()) if (!used.has(key)) estimates.delete(key);
    return result;
  } catch {
    // A missing or damaged disposable index must not hide the download history.
    return tasks;
  }
}
