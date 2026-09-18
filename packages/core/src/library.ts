import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import pLimit from "p-limit";
import { CONFIG } from "./lib/types.js";
import { registerPreviewCache } from "./lib/cache.js";
import { getDirectoryListing } from "./download/downloader.js";
import { libraryUrl, listingEntries, fetchInteractiveLibraryResource as fetchLibrary } from "./library-listing.js";
import { cachedIndexedDirectory } from "./search-file-index.js";
import { dirListingCache, loadDiscoveryCache } from "./download/discovery-cache.js";
import { previewKind, previewLimits, type FilePreview, type LibraryEntry } from "./library-types.js";
import { canonicalTreeUrl } from "./search-tree.js";

const listings = pLimit(1);
const previews = pLimit(1);
const pendingPreviews = new Map<string, Promise<FilePreview>>();
const previewStates = new Map<string, "waiting" | "loading">();
export { libraryUrl } from "./library-listing.js";

export async function listLibraryDirectory(
  value: string,
  refresh = false,
  requireDates = false
): Promise<LibraryEntry[]> {
  const url = libraryUrl(value);
  if (!url.pathname.endsWith("/")) throw new Error("Choose a directory to browse");
  if (!refresh) {
    const indexed = await cachedIndexedDirectory(url.href);
    if (indexed && (!requireDates || indexed.entries.every((entry) => entry.modifiedCheckedAt !== undefined)))
      return indexed.entries;
  }
  return listings(async () => {
    // Another window may have filled the missing dates while this request waited.
    if (requireDates && !refresh) {
      const indexed = await cachedIndexedDirectory(url.href);
      if (indexed && indexed.entries.every((entry) => entry.modifiedCheckedAt !== undefined)) return indexed.entries;
    }
    // Re-read disk so clearing discovery through the CLI also invalidates the desktop view.
    dirListingCache.clear();
    await loadDiscoveryCache().catch(() => dirListingCache.clear());
    const listing = await getDirectoryListing(url.href, {
      refresh,
      allowEmptyCache: true,
      requireDates,
      fetcher: (target) => fetchLibrary(target, 8 * 1024 * 1024),
    });
    return listingEntries(url.href, listing);
  });
}

function imageMime(data: Buffer): string {
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) return "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(data.toString("ascii", 0, 6))) return "image/gif";
  if (data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  throw new Error("This file is not a supported image");
}

async function prunePreviews(directory: string, incoming: number) {
  const files = await fs.readdir(directory);
  const entries = await Promise.all(
    files
      .filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
      .map(async (name) => {
        const file = path.join(directory, name);
        const stat = await fs.stat(file).catch(() => null);
        return { file, size: stat?.size ?? 0, time: stat?.mtimeMs ?? 0 };
      })
  );
  let total = entries.reduce((sum, entry) => sum + entry.size, incoming);
  for (const entry of entries.sort((a, b) => a.time - b.time)) {
    if (Date.now() - entry.time > previewLimits.age || total > previewLimits.cache) {
      await fs.rm(entry.file, { force: true });
      total -= entry.size;
    }
  }
}

export function libraryPreviewStatus(value: string): "waiting" | "loading" | "idle" {
  return previewStates.get(canonicalTreeUrl(libraryUrl(value).href)) ?? "idle";
}

export async function cachedLibraryPreview(value: string): Promise<FilePreview | null> {
  const url = canonicalTreeUrl(libraryUrl(value).href);
  const kind = previewKind(url);
  if (!kind) throw new Error("Preview is not available for this file type");
  const file = path.join(CONFIG.CACHE_DIR, "previews", `${createHash("sha256").update(url).digest("hex")}.json`);
  try {
    const stat = await fs.stat(file);
    if (stat.size <= previewLimits.image * 1.5 && Date.now() - stat.mtimeMs < previewLimits.age) {
      const cached: FilePreview = JSON.parse(await fs.readFile(file, "utf8"));
      if (
        cached.url === url &&
        cached.kind === kind &&
        typeof cached.content === "string" &&
        cached.bytes <= previewLimits[kind] &&
        Date.now() - cached.fetchedAt < previewLimits.age &&
        (kind === "text" || ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(cached.mime))
      ) {
        await registerPreviewCache();
        return { ...cached, cached: true };
      }
    }
  } catch {
    /* A missing or damaged cache entry is fetched again. */
  }
  return null;
}

export async function previewLibraryFile(value: string, refresh = false): Promise<FilePreview> {
  const url = canonicalTreeUrl(libraryUrl(value).href);
  const kind = previewKind(url);
  if (!kind) throw new Error("Preview is not available for this file type");
  // Cache hits must not wait behind unrelated slow network requests.
  if (!refresh) {
    const cached = await cachedLibraryPreview(url);
    if (cached) return cached;
  }
  const existing = pendingPreviews.get(url);
  if (existing) return existing;
  previewStates.set(url, "waiting");
  const operation = previews(async () => {
    previewStates.set(url, "loading");
    const directory = path.join(CONFIG.CACHE_DIR, "previews");
    const file = path.join(directory, `${createHash("sha256").update(url).digest("hex")}.json`);
    const response = await fetchLibrary(url, previewLimits[kind]);
    const data = Buffer.from(await response.arrayBuffer());
    let content: string;
    let mime: string;
    if (kind === "image") {
      mime = imageMime(data);
      content = data.toString("base64");
    } else {
      if (response.headers.get("content-type")?.includes("text/html") && !/\.html?$/.test(new URL(url).pathname)) {
        throw new Error("The library returned an HTML page instead of this text file");
      }
      content = decodePreviewText(data);
      if (
        [...content].some((character) => {
          const code = character.charCodeAt(0);
          return code < 9 || (code > 13 && code < 32) || (code >= 127 && code <= 159);
        })
      )
        throw new Error("This file contains binary data");
      mime = "text/plain";
    }
    const result: FilePreview = { url, kind, mime, content, bytes: data.length, cached: false, fetchedAt: Date.now() };
    const serialized = JSON.stringify(result);
    await fs.mkdir(directory, { recursive: true });
    await prunePreviews(directory, Buffer.byteLength(serialized));
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, serialized);
      await fs.rename(temporary, file);
      await registerPreviewCache();
    } finally {
      await fs.rm(temporary, { force: true });
    }
    return result;
  });
  pendingPreviews.set(url, operation);
  try {
    return await operation;
  } finally {
    pendingPreviews.delete(url);
    previewStates.delete(url);
  }
}

function decodePreviewText(data: Uint8Array): string {
  // BOMs take precedence; older Spanish synopsis/subtitle files commonly use Windows-1252.
  const encoding =
    data[0] === 0xff && data[1] === 0xfe ? "utf-16le" : data[0] === 0xfe && data[1] === 0xff ? "utf-16be" : "utf-8";
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(data);
  } catch {
    if (encoding !== "utf-8" || (data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf))
      throw new Error("This text file has invalid Unicode data");
    return new TextDecoder("windows-1252").decode(data);
  }
}
