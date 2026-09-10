import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import pLimit from "p-limit";
import { CONFIG } from "./lib/types.js";
import { registerPreviewCache } from "./lib/cache.js";
import { getDirectoryListing } from "./download/downloader.js";
import { createDownloadHeaders } from "./download/http.js";
import { dirListingCache, loadDiscoveryCache } from "./download/discovery-cache.js";
import { previewKind, previewLimits, type FilePreview, type LibraryEntry } from "./library-types.js";

const listings = pLimit(1);
const previews = pLimit(1);
const pendingPreviews = new Map<string, Promise<FilePreview>>();

export function libraryUrl(value: string): URL {
  const url = new URL(value);
  if (
    url.hostname !== "visuales.uclv.cu" ||
    !["http:", "https:"].includes(url.protocol) ||
    url.port ||
    url.username ||
    url.password
  ) {
    throw new Error("Only Visuales library URLs are supported");
  }
  url.protocol = "https:";
  url.hash = "";
  if (url.search) throw new Error("Library URLs cannot contain query parameters");
  return url;
}

// Bound both bytes and duration, including chunked responses. Never follow a redirect to another host.
async function fetchLibrary(url: string, limit: number): Promise<Response> {
  const signal = AbortSignal.timeout(120000);
  let current = libraryUrl(url);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await fetch(current, { redirect: "manual", signal, headers: createDownloadHeaders() });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location) throw new Error("Library redirect has no destination");
      const next = libraryUrl(new URL(location, current).href);
      if (next.pathname !== current.pathname) throw new Error("The library redirected to a different resource");
      current = next;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Library request failed (${response.status})`);
    }
    if (Number(response.headers.get("content-length")) > limit) {
      await response.body?.cancel();
      throw new Error(`File is too large to preview (limit ${Math.round(limit / 1024)} KB)`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Library returned no content");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > limit) throw new Error(`File is too large to preview (limit ${Math.round(limit / 1024)} KB)`);
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    return new Response(Buffer.concat(chunks), { headers: response.headers });
  }
  throw new Error("Too many library redirects");
}

function nameOf(url: URL): string {
  const part = url.pathname.replace(/\/$/, "").split("/").at(-1) || url.hostname;
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

export async function listLibraryDirectory(value: string, refresh = false): Promise<LibraryEntry[]> {
  const url = libraryUrl(value);
  if (!url.pathname.endsWith("/")) throw new Error("Choose a directory to browse");
  return listings(async () => {
    // Re-read disk so clearing discovery through the CLI also invalidates the desktop view.
    dirListingCache.clear();
    await loadDiscoveryCache().catch(() => dirListingCache.clear());
    const listing = await getDirectoryListing(url.href, {
      refresh,
      allowEmptyCache: true,
      fetcher: (target) => fetchLibrary(target, 8 * 1024 * 1024),
    });
    const entries = [
      ...listing.dirs.map((encodedUrl) => ({ encodedUrl, isDirectoryLink: true, size: undefined })),
      ...listing.files.map((file) => ({ encodedUrl: file.url, isDirectoryLink: false, size: file.size || undefined })),
    ];
    const unique = new Map<string, LibraryEntry>();
    for (const entry of entries) {
      let child: URL;
      try {
        child = libraryUrl(entry.encodedUrl);
      } catch {
        continue;
      }
      const relative = child.pathname.slice(url.pathname.length).replace(/\/$/, "");
      if (!child.pathname.startsWith(url.pathname) || !relative || relative.includes("/")) continue;
      unique.set(child.href, {
        ...entry,
        encodedUrl: child.href,
        url: child.href,
        text: nameOf(child),
        directory: url.pathname,
      });
    }
    return [...unique.values()];
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

export async function previewLibraryFile(value: string, refresh = false): Promise<FilePreview> {
  const url = libraryUrl(value).href;
  const kind = previewKind(url);
  if (!kind) throw new Error("Preview is not available for this file type");
  const key = `${url}:${refresh}`;
  const existing = pendingPreviews.get(key);
  if (existing) return existing;
  const operation = previews(async () => {
    const directory = path.join(CONFIG.CACHE_DIR, "previews");
    const file = path.join(directory, `${createHash("sha256").update(url).digest("hex")}.json`);
    if (!refresh) {
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
    }
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
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(data);
      } catch {
        throw new Error("Text preview supports UTF-8 files only");
      }
      if (
        [...content].some((character) => {
          const code = character.charCodeAt(0);
          return code < 9 || (code > 13 && code < 32);
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
  pendingPreviews.set(key, operation);
  try {
    return await operation;
  } finally {
    pendingPreviews.delete(key);
  }
}
