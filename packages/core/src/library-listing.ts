import * as cheerio from "cheerio";
import { parseSize } from "./download/utils.js";
import { createDownloadHeaders } from "./download/http.js";
import type { DirectoryListing } from "./download/discovery-cache.js";
import { DIRECTORY_LISTING_PARSER_VERSION } from "./download/discovery-cache.js";
import { canonicalTreeUrl } from "./search-tree.js";
import type { LibraryEntry } from "./library-types.js";
import { decodeUriForDisplay } from "./uri-display.js";
import { parseLibraryDate } from "./library-date.js";

export function libraryUrl(value: string): URL {
  const url = new URL(value);
  if (
    url.hostname !== "visuales.uclv.cu" ||
    !["http:", "https:"].includes(url.protocol) ||
    url.port ||
    url.username ||
    url.password
  )
    throw new Error("Only Visuales library URLs are supported");
  url.protocol = "https:";
  url.hash = "";
  if (url.search) throw new Error("Library URLs cannot contain query parameters");
  return new URL(canonicalTreeUrl(url.href));
}

export function parseDirectoryListing(html: string, base: string, requireListing = false): DirectoryListing {
  const $ = cheerio.load(html);
  if (requireListing && (!$("pre, table").length || /URL not available/i.test($("title").text())))
    throw new Error("The library did not return a directory listing");
  const modified: Record<string, string> = {};
  const listing: DirectoryListing = { files: [], dirs: [], modified, parserVersion: DIRECTORY_LISTING_PARSER_VERSION };
  const seen = new Set<string>();
  function add(href: string | undefined, sizeText: string, dateText = "") {
    if (!href || href === "../" || href.startsWith("?") || href.startsWith("/") || href.includes("://")) return;
    const url = new URL(href, base).href;
    if (seen.has(url)) return;
    seen.add(url);
    const date = parseLibraryDate(dateText);
    if (date) modified[canonicalTreeUrl(url)] = date;
    if (href.endsWith("/")) listing.dirs.push(url);
    else {
      const size = parseSize(sizeText);
      listing.files.push({ url, size, exact: size > 0 && /^\d+\s*B?$/i.test(sizeText.trim()) });
    }
  }
  $("tr").each((_, element) => {
    const row = $(element);
    add(row.find("td a").first().attr("href"), row.find("td").eq(3).text().trim(), row.find("td").eq(2).text().trim());
  });
  $("pre a").each((_, element) => {
    const next = element.nextSibling;
    const metadata = next?.type === "text" ? next.data.trim().split(/\s+/) : [];
    add($(element).attr("href"), metadata.at(-1) ?? "", metadata.slice(0, 2).join(" "));
  });
  return listing;
}

export function listingEntries(
  value: string,
  listing: DirectoryListing,
  fetchedAt = listing.fetchedAt ?? 0
): LibraryEntry[] {
  const parent = libraryUrl(value);
  if (!parent.pathname.endsWith("/")) throw new Error("Choose a directory to browse");
  const entries = new Map<string, LibraryEntry>();
  for (const item of [
    ...listing.dirs.map((url) => ({ url, directory: true, size: undefined })),
    ...listing.files.map((file) => ({ url: file.url, directory: false, size: file.size || undefined })),
  ]) {
    try {
      const url = libraryUrl(item.url);
      const relative = url.pathname.slice(parent.pathname.length).replace(/\/$/, "");
      if (!url.pathname.startsWith(parent.pathname) || !relative || relative.includes("/")) continue;
      const text = decodeUriForDisplay(relative);
      const directory = decodeUriForDisplay(
        item.directory ? url.pathname.replace(/\/$/, "") : parent.pathname.replace(/\/$/, "")
      );
      entries.set(url.href, {
        url: url.href,
        encodedUrl: url.href,
        text,
        directory,
        isDirectoryLink: item.directory,
        size: item.size,
        ...(listing.modified && typeof listing.modified === "object" && !Array.isArray(listing.modified)
          ? {
              modifiedLocal: parseLibraryDate(listing.modified[url.href]),
              modifiedCheckedAt: fetchedAt,
            }
          : {}),
      });
    } catch {
      /* Ignore links outside the supported library. */
    }
  }
  return [...entries.values()];
}

export class LibraryRequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public retryAt?: number
  ) {
    super(message);
  }
}

export async function fetchLibraryResource(
  value: string,
  limit: number,
  signal?: AbortSignal,
  userAgent?: string
): Promise<Response> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, 120000);
  let url = libraryUrl(value);
  try {
    for (let redirects = 0; redirects <= 3; redirects++) {
      const headers = createDownloadHeaders();
      if (userAgent) headers["User-Agent"] = userAgent;
      const response = await fetch(url, { redirect: "manual", signal: controller.signal, headers });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get("location");
        if (!location) throw new Error("Library redirect has no destination");
        const next = libraryUrl(new URL(location, url).href);
        if (next.pathname !== url.pathname) throw new Error("The library redirected to a different resource");
        url = next;
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        const retry = response.headers.get("retry-after");
        const retryAt = retry
          ? /^\d+$/.test(retry)
            ? Date.now() + Number(retry) * 1000
            : Date.parse(retry)
          : undefined;
        throw new LibraryRequestError(`Library request failed (${response.status})`, response.status, retryAt);
      }
      if (Number(response.headers.get("content-length")) > limit) {
        await response.body?.cancel();
        throw new Error("File is too large to preview or index");
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
          if (size > limit) throw new Error("File is too large to preview or index");
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      return new Response(Buffer.concat(chunks), { headers: response.headers });
    }
    throw new Error("Too many library redirects");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

let browsing = 0;
export function libraryBrowsingBusy() {
  return browsing > 0;
}
export async function fetchInteractiveLibraryResource(url: string, limit: number): Promise<Response> {
  browsing++;
  try {
    return await fetchLibraryResource(url, limit);
  } finally {
    browsing--;
  }
}
export async function fetchLibraryListing(url: string, signal?: AbortSignal, background = false) {
  if (!background) browsing++;
  try {
    const response = await fetchLibraryResource(
      url,
      8 * 1024 * 1024,
      signal,
      background ? "VisualesIndexer/1.0" : undefined
    );
    return parseDirectoryListing(await response.text(), url, true);
  } finally {
    if (!background) browsing--;
  }
}
