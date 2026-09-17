import { fetchHtml, parseHtml } from "./lib/html-parser.js";
import { saveSearchAliases } from "./lib/cache.js";
import { libraryUrl, listLibraryDirectory } from "./library.js";
import { canonicalTreeUrl } from "./search-tree.js";
import { readFileIndex, fileIndexRevision, type IndexedDirectory } from "./search-file-index.js";
import type { SearchResult } from "./lib/types.js";
import { decodeUriForDisplay } from "./uri-display.js";

function normalized(value: string) {
  return value
    .normalize("NFC")
    .toLowerCase()
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function searchable(entry: SearchResult) {
  let pathname = new URL(entry.encodedUrl).pathname;
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    /* Retain malformed escapes. */
  }
  return { entry, name: normalized(entry.text), path: normalized(`${entry.url} ${pathname}`) };
}

let parsed: { html: string; entries: ReturnType<typeof searchable>[] } | undefined;
let files:
  | {
      revision: string;
      entries: ReturnType<typeof searchable>[];
      directories: Map<IndexedDirectory, ReturnType<typeof searchable>[]>;
    }
  | undefined;

export async function searchContent(terms: string[], options: { noCache?: boolean; root?: string } = {}) {
  const root = options.root === undefined ? undefined : canonicalTreeUrl(libraryUrl(options.root).href);
  if (root && !root.endsWith("/")) throw new Error("Search root must be a directory");
  const html = await fetchHtml(options);
  if (parsed?.html !== html) parsed = { html, entries: parseHtml(html, []).map(searchable) };
  const index = parsed.entries.map(({ entry }) => entry);
  const catalog = await readFileIndex();
  const revision = fileIndexRevision(catalog);
  if (terms.length && files?.revision !== revision) {
    const directories = new Map<IndexedDirectory, ReturnType<typeof searchable>[]>();
    for (const directory of catalog.directories.values())
      directories.set(directory, files?.directories.get(directory) ?? directory.entries.map(searchable));
    files = { revision, directories, entries: [...directories.values()].flat() };
  }
  const withinRoot = (entry: SearchResult) => {
    if (!root) return true;
    const url = canonicalTreeUrl(entry.encodedUrl);
    return url !== root && url.startsWith(root);
  };
  const allResults = new Map(index.filter(withinRoot).map((entry) => [canonicalTreeUrl(entry.encodedUrl), entry]));
  if (root) {
    const children = await listLibraryDirectory(root, options.noCache);
    for (const entry of children) allResults.set(canonicalTreeUrl(entry.encodedUrl), entry);
  }
  let results: SearchResult[];
  if (terms.length) {
    const query = terms.map(normalized).filter(Boolean);
    const matches = new Map<string, { entry: SearchResult; filename: boolean }>();
    const sources = [
      ...parsed.entries,
      ...(files?.entries ?? []),
      ...(root ? [...allResults.values()].map(searchable) : []),
    ];
    for (const item of sources) {
      if (!withinRoot(item.entry)) continue;
      const filename = query.every((term) => item.name.includes(term));
      if (filename || query.every((term) => `${item.name} ${item.path}`.includes(term)))
        matches.set(canonicalTreeUrl(item.entry.encodedUrl), { entry: item.entry, filename });
    }
    results = [...matches.values()].sort((a, b) => Number(b.filename) - Number(a.filename)).map(({ entry }) => entry);
    for (const entry of results) allResults.set(canonicalTreeUrl(entry.encodedUrl), entry);
  } else results = [...allResults.values()];
  const exposed = new Map(results.map((result) => [canonicalTreeUrl(result.encodedUrl), result]));
  for (const result of results) {
    let parent = new URL(result.isDirectoryLink ? ".." : ".", result.encodedUrl).href;
    while (new URL(parent).pathname !== "/" && (!root || parent.startsWith(root))) {
      const key = canonicalTreeUrl(parent);
      const ancestor = allResults.get(key) ?? {
        encodedUrl: key,
        url: key,
        isDirectoryLink: true,
        text: decodeUriForDisplay(new URL(key).pathname.split("/").filter(Boolean).at(-1)!),
        directory: decodeUriForDisplay(new URL(key).pathname.replace(/\/$/, "")),
      };
      allResults.set(key, ancestor);
      exposed.set(key, ancestor);
      parent = new URL("..", parent).href;
    }
  }
  const aliases = await saveSearchAliases([...exposed.values()].map((result) => result.encodedUrl));
  for (const result of exposed.values()) result.downloadId = aliases.get(result.encodedUrl);
  return { results, allResults: [...allResults.values()], totalResults: results.length, indexRevision: revision };
}
