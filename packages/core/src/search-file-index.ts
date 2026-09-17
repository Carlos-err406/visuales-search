import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import pLimit from "p-limit";
import { CONFIG } from "./lib/types.js";
import { readJson, writeJson, withCacheLock } from "./lib/cache-io.js";
import { libraryUrl, listingEntries } from "./library-listing.js";
import type { DirectoryListing } from "./download/discovery-cache.js";
import type { LibraryEntry } from "./library-types.js";

export interface IndexedDirectory {
  version: 1;
  generation: string;
  url: string;
  fetchedAt: number;
  entries: LibraryEntry[];
}

interface IndexMeta {
  version: 1;
  generation: string;
  revision: number;
  changes: { revision: number; url: string }[];
  removed: Record<string, number>;
  imported?: string;
}

export const fileIndexDirectory = () => path.join(CONFIG.CACHE_DIR, "file-index");
const metaPath = () => path.join(fileIndexDirectory(), "meta.json");
const recordsPath = () => path.join(fileIndexDirectory(), "directories");
const recordPath = (url: string) => path.join(recordsPath(), `${createHash("sha256").update(url).digest("hex")}.json`);
export const withFileIndexLock = <T>(operation: () => Promise<T>) =>
  withCacheLock(path.join(CONFIG.CACHE_DIR, "file-index-store"), operation);

let memory: { home: string; meta: IndexMeta; directories: Map<string, IndexedDirectory> } | undefined;
let importing: Promise<void> | undefined;

async function meta(): Promise<IndexMeta> {
  const value = await readJson<IndexMeta>(metaPath());
  if (
    value?.version === 1 &&
    typeof value.generation === "string" &&
    Number.isSafeInteger(value.revision) &&
    Array.isArray(value.changes) &&
    value.removed
  )
    return value;
  return { version: 1, generation: randomUUID(), revision: 0, changes: [], removed: {} };
}

async function ensureMeta(): Promise<IndexMeta> {
  return withFileIndexLock(async () => {
    const value = await meta();
    const existing = await readJson<IndexMeta>(metaPath());
    if (existing?.generation !== value.generation) await writeJson(metaPath(), value);
    return value;
  });
}

export async function fileIndexGeneration(): Promise<string> {
  return (await ensureMeta()).generation;
}

function validateListing(value: unknown): value is DirectoryListing {
  if (!value || typeof value !== "object") return false;
  const listing = value as DirectoryListing;
  return (
    Array.isArray(listing.files) &&
    Array.isArray(listing.dirs) &&
    listing.files.every(
      (file) => file && typeof file.url === "string" && Number.isFinite(file.size) && file.size >= 0
    ) &&
    listing.dirs.every((url) => typeof url === "string")
  );
}

function validRecord(value: IndexedDirectory | undefined, state: IndexMeta): value is IndexedDirectory {
  if (
    !value ||
    value.version !== 1 ||
    value.generation !== state.generation ||
    !Number.isFinite(value.fetchedAt) ||
    !Array.isArray(value.entries)
  )
    return false;
  try {
    if (libraryUrl(value.url).href !== value.url || !value.url.endsWith("/")) return false;
    return value.entries.every((entry) => {
      const url = libraryUrl(entry.encodedUrl).href;
      const relative = url.slice(value.url.length).replace(/\/$/, "");
      return (
        url.startsWith(value.url) &&
        relative &&
        !relative.includes("/") &&
        typeof entry.text === "string" &&
        typeof entry.isDirectoryLink === "boolean" &&
        entry.isDirectoryLink === url.endsWith("/")
      );
    });
  } catch {
    return false;
  }
}

function change(state: IndexMeta, url: string) {
  state.changes.push({ revision: ++state.revision, url });
  if (state.changes.length > 512) state.changes.splice(0, state.changes.length - 512);
}

export async function publishIndexedDirectory(
  value: string,
  listing: DirectoryListing,
  fetchedAt = Date.now(),
  generation?: string
): Promise<boolean> {
  const url = libraryUrl(value).href;
  if (!url.endsWith("/") || !validateListing(listing)) throw new Error("Invalid indexed directory");
  const entries = listingEntries(url, listing);
  const expected = generation ?? (await fileIndexGeneration());
  return withFileIndexLock(async () => {
    const state = await meta();
    if (state.generation !== expected) return false;
    if (Object.entries(state.removed).some(([prefix, at]) => url.startsWith(prefix) && fetchedAt <= at)) return false;
    const previous = await readJson<IndexedDirectory>(recordPath(url));
    if (validRecord(previous, state) && previous.fetchedAt >= fetchedAt) return false;
    const record: IndexedDirectory = { version: 1, generation: state.generation, url, fetchedAt, entries };
    // Authoritative parent removal invalidates descendants and fences older in-flight fetches.
    const currentDirs = new Set(entries.filter((entry) => entry.isDirectoryLink).map((entry) => entry.encodedUrl));
    const removed = (previous?.entries ?? []).filter(
      (entry) => entry.isDirectoryLink && !currentDirs.has(entry.encodedUrl)
    );
    if (fetchedAt > 0 && removed.length) {
      for (const entry of removed) state.removed[entry.encodedUrl] = fetchedAt;
      for (const name of await fs.readdir(recordsPath()).catch(() => [] as string[])) {
        const file = path.join(recordsPath(), name);
        const child = await readJson<IndexedDirectory>(file);
        if (child && removed.some((entry) => child.url.startsWith(entry.encodedUrl)) && child.fetchedAt <= fetchedAt) {
          await fs.rm(file, { force: true });
          change(state, child.url);
        }
      }
    }
    for (const child of currentDirs) if (fetchedAt > (state.removed[child] ?? Infinity)) delete state.removed[child];
    await writeJson(recordPath(url), record);
    change(state, url);
    await writeJson(metaPath(), state);
    return true;
  });
}

export async function importDiscoveryFiles(): Promise<void> {
  if (importing) return importing;
  importing = (async () => {
    const stat = await fs.stat(CONFIG.DISCOVERY_CACHE_FILE).catch(() => undefined);
    if (!stat) return;
    const signature = `${stat.mtimeMs}:${stat.size}:${stat.ino}`;
    const state = await ensureMeta();
    if (state.imported === signature) return;
    const data = await readJson<Record<string, unknown>>(CONFIG.DISCOVERY_CACHE_FILE);
    if (!data || Array.isArray(data)) return;
    for (const [url, listing] of Object.entries(data)) {
      if (!validateListing(listing)) continue;
      try {
        const existing = await readJson<IndexedDirectory>(recordPath(libraryUrl(url).href));
        if (validRecord(existing, state)) continue;
        await publishIndexedDirectory(url, listing, 0, state.generation);
      } catch {
        /* Legacy caches can contain unsupported URLs or damaged entries. */
      }
    }
    await withFileIndexLock(async () => {
      const latest = await meta();
      if (latest.generation !== state.generation) return;
      latest.imported = signature;
      await writeJson(metaPath(), latest);
    });
  })();
  try {
    await importing;
  } finally {
    importing = undefined;
  }
}

export async function readFileIndex() {
  await importDiscoveryFiles();
  const state = await ensureMeta();
  if (
    memory?.home === CONFIG.CACHE_DIR &&
    memory.meta.generation === state.generation &&
    memory.meta.revision === state.revision
  )
    return memory;
  const incremental =
    memory?.home === CONFIG.CACHE_DIR &&
    memory.meta.generation === state.generation &&
    memory.meta.revision >= (state.changes[0]?.revision ?? 1) - 1;
  const directories = incremental ? new Map(memory!.directories) : new Map<string, IndexedDirectory>();
  const urls = incremental
    ? [...new Set(state.changes.filter((item) => item.revision > memory!.meta.revision).map((item) => item.url))]
    : undefined;
  const files = urls
    ? urls.map(recordPath)
    : (await fs.readdir(recordsPath()).catch(() => [] as string[]))
        .filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
        .map((name) => path.join(recordsPath(), name));
  const limit = pLimit(16);
  await Promise.all(
    files.map((file, index) =>
      limit(async () => {
        const value = await readJson<IndexedDirectory>(file);
        if (validRecord(value, state)) directories.set(value.url, value);
        else if (urls) directories.delete(urls[index]);
      })
    )
  );
  memory = { home: CONFIG.CACHE_DIR, meta: state, directories };
  const { registerFileIndexCache } = await import("./lib/cache.js");
  await registerFileIndexCache();
  return memory;
}

export async function cachedIndexedDirectory(url: string): Promise<IndexedDirectory | undefined> {
  const state = await ensureMeta();
  const record = await readJson<IndexedDirectory>(recordPath(libraryUrl(url).href));
  return validRecord(record, state) ? record : undefined;
}

export async function clearFileIndex(): Promise<void> {
  await withFileIndexLock(async () => {
    await fs.rm(fileIndexDirectory(), { recursive: true, force: true });
    await writeJson(metaPath(), await meta());
  });
  memory = undefined;
}

export async function indexDirectoryRemoved(url: string, startedAt: number): Promise<boolean> {
  return Object.entries((await ensureMeta()).removed).some(([prefix, at]) => url.startsWith(prefix) && startedAt <= at);
}

export function fileIndexRevision(index: Awaited<ReturnType<typeof readFileIndex>>) {
  return `${index.meta.generation}:${index.meta.revision}`;
}
