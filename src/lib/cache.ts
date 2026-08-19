import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { formatDistanceToNow } from "date-fns";
import colors from "ansi-colors";
import { CONFIG, type CacheData, type CacheIndex, type CacheEntry, type SearchAliasCache } from "./types.js";

export async function ensureCacheDirectory(): Promise<void> {
  if (!fs.existsSync(CONFIG.CACHE_DIR)) {
    fs.mkdirSync(CONFIG.CACHE_DIR, { recursive: true });
  }
}

function writeJsonFileAtomic(filePath: string, data: unknown): void {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(data));
  fs.renameSync(temporaryPath, filePath);
}

// Cache index management
async function loadCacheIndex(): Promise<CacheIndex> {
  if (!fs.existsSync(CONFIG.CACHE_INDEX_FILE)) {
    const defaultIndex: CacheIndex = {
      version: "1.0.0",
      entries: [],
    };
    await saveCacheIndex(defaultIndex);
    return defaultIndex;
  }

  try {
    const content = fs.readFileSync(CONFIG.CACHE_INDEX_FILE, "utf-8");
    return JSON.parse(content) as CacheIndex;
  } catch {
    console.log(colors.yellow("⚠️  Cache index corrupted, creating new one"));
    const defaultIndex: CacheIndex = {
      version: "1.0.0",
      entries: [],
    };
    await saveCacheIndex(defaultIndex);
    return defaultIndex;
  }
}

async function saveCacheIndex(index: CacheIndex): Promise<void> {
  await ensureCacheDirectory();
  try {
    writeJsonFileAtomic(CONFIG.CACHE_INDEX_FILE, index);
  } catch {
    console.log(colors.yellow("⚠️  Failed to save cache index"));
  }
}

async function updateCacheEntry(id: string, updates: Partial<CacheEntry>): Promise<void> {
  const index = await loadCacheIndex();
  const existingEntryIndex = index.entries.findIndex((entry) => entry.id === id);

  if (existingEntryIndex >= 0) {
    index.entries[existingEntryIndex] = {
      ...index.entries[existingEntryIndex],
      ...updates,
    };
  } else {
    // Create new entry
    const newEntry: CacheEntry = {
      id,
      name: updates.name || id,
      type: updates.type || "file",
      path: updates.path || "",
      size: updates.size || 0,
      created: updates.created || Date.now(),
      description: updates.description,
    };
    index.entries.push(newEntry);
  }

  await saveCacheIndex(index);
}

function calculateFileSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function calculateDirectorySize(dirPath: string): number {
  try {
    if (!fs.existsSync(dirPath)) {
      return 0;
    }
    return fs.readdirSync(dirPath).length;
  } catch {
    return 0;
  }
}

// Public cache management functions
export async function listCaches(): Promise<CacheEntry[]> {
  const index = await loadCacheIndex();

  // Auto-detect download cache if it exists but isn't indexed
  if (fs.existsSync(CONFIG.DOWNLOAD_CACHE_DIR)) {
    const downloadEntryExists = index.entries.some((e) => e.id === "download");
    if (!downloadEntryExists) {
      await updateCacheEntry("download", {
        id: "download",
        name: "Download Cache",
        type: "directory",
        path: "download",
        created: Date.now(),
        description: "Resumable download cache files",
      });
    }
  }

  // Auto-detect discovery cache if it exists
  if (fs.existsSync(CONFIG.DISCOVERY_CACHE_FILE)) {
    const discoveryEntryExists = index.entries.some((e) => e.id === "discovery");
    if (!discoveryEntryExists) {
      const stats = fs.statSync(CONFIG.DISCOVERY_CACHE_FILE);
      await updateCacheEntry("discovery", {
        id: "discovery",
        name: "Directory Discovery Cache",
        type: "file",
        path: "discovery.json",
        created: stats.birthtimeMs,
        description: "Cached directory listings for faster discovery",
      });
    }
  }

  // Auto-detect search aliases if they exist
  if (fs.existsSync(CONFIG.SEARCH_ALIAS_FILE)) {
    const aliasesEntryExists = index.entries.some((e) => e.id === "search-aliases");
    if (!aliasesEntryExists) {
      const stats = fs.statSync(CONFIG.SEARCH_ALIAS_FILE);
      await updateCacheEntry("search-aliases", {
        id: "search-aliases",
        name: "Search Download Aliases",
        type: "file",
        path: "search-aliases.json",
        created: stats.birthtimeMs,
        description: "Short ids for URLs shown by visuales search",
      });
    }
  }

  // Update sizes on the fly
  for (const entry of index.entries) {
    if (entry.type === "file") {
      entry.size = calculateFileSize(path.join(CONFIG.CACHE_DIR, entry.path));
    } else if (entry.type === "directory") {
      entry.size = calculateDirectorySize(path.join(CONFIG.CACHE_DIR, entry.path));
    }
  }

  return index.entries;
}

export async function clearCacheById(id: string): Promise<void> {
  const index = await loadCacheIndex();
  const entry = index.entries.find((e) => e.id === id);

  if (!entry) {
    throw new Error(`Cache with ID '${id}' not found`);
  }

  const fullPath = path.join(CONFIG.CACHE_DIR, entry.path);

  try {
    if (entry.type === "file" && fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    } else if (entry.type === "directory" && fs.existsSync(fullPath)) {
      fs.rmSync(fullPath, { recursive: true, force: true });
    }

    // Remove entry from index
    index.entries = index.entries.filter((e) => e.id !== id);
    await saveCacheIndex(index);

    console.log(colors.green(`✅ Cleared cache: ${entry.name}`));
  } catch (e: unknown) {
    throw new Error(`Failed to clear cache '${entry.name}': ${e instanceof Error ? e.message : e}`);
  }
}

export async function clearAllCaches(): Promise<void> {
  const index = await loadCacheIndex();

  for (const entry of index.entries) {
    try {
      const fullPath = path.join(CONFIG.CACHE_DIR, entry.path);

      if (entry.type === "file" && fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      } else if (entry.type === "directory" && fs.existsSync(fullPath)) {
        fs.rmSync(fullPath, { recursive: true, force: true });
      }
    } catch (e) {
      console.log(colors.yellow(`⚠️  Failed to clear cache '${entry.name}': ${e instanceof Error ? e.message : e}`));
    }
  }

  // Clear index
  index.entries = [];
  await saveCacheIndex(index);

  console.log(colors.green("✅ Cleared all caches"));
}

export async function getCacheInfo(id: string): Promise<CacheEntry | null> {
  const index = await loadCacheIndex();
  const entry = index.entries.find((e) => e.id === id);

  if (!entry) {
    return null;
  }

  // Update size
  if (entry.type === "file") {
    entry.size = calculateFileSize(path.join(CONFIG.CACHE_DIR, entry.path));
  } else if (entry.type === "directory") {
    entry.size = calculateDirectorySize(path.join(CONFIG.CACHE_DIR, entry.path));
  }

  return entry;
}

export async function getCachedHtml(): Promise<string | null> {
  if (!fs.existsSync(CONFIG.CACHE_FILE)) {
    return null;
  }

  try {
    const content = fs.readFileSync(CONFIG.CACHE_FILE, "utf-8");
    const data: CacheData = JSON.parse(content);
    const cacheDate = new Date(data.timestamp);
    const ageString = formatDistanceToNow(cacheDate, { addSuffix: true });

    // Ensure cache entry exists in index
    await updateCacheEntry("list", {
      id: "list",
      name: "Search Result Cache",
      type: "file",
      path: "list.json",
      created: data.timestamp,
      description: "Cached HTML content from visuales.uclv.cu",
    });

    console.log(colors.gray(`📦 Using cached data (${ageString})`));
    return data.html;
  } catch {
    console.log(colors.yellow("⚠️  Cache file corrupted, will fetch fresh data"));
    return null;
  }
}

export async function setCachedHtml(html: string): Promise<void> {
  await ensureCacheDirectory();
  const data: CacheData = {
    html,
    timestamp: Date.now(),
  };

  try {
    writeJsonFileAtomic(CONFIG.CACHE_FILE, data);

    // Update cache index
    await updateCacheEntry("list", {
      id: "list",
      name: "Search Result Cache",
      type: "file",
      path: "list.json",
      created: Date.now(),
      description: "Cached HTML content from visuales.uclv.cu",
    });

    console.log(colors.green("💾 Cached HTML"));
  } catch {
    console.log(colors.yellow("⚠️  Failed to cache HTML"));
  }
}

function createSearchAliasId(url: string, length = 8): string {
  return createHash("sha256").update(url).digest("hex").slice(0, length);
}

function loadSearchAliasCache(): SearchAliasCache {
  if (!fs.existsSync(CONFIG.SEARCH_ALIAS_FILE)) {
    return {
      version: "1.0.0",
      updated: Date.now(),
      entries: {},
    };
  }

  try {
    const content = fs.readFileSync(CONFIG.SEARCH_ALIAS_FILE, "utf-8");
    const cache = JSON.parse(content) as SearchAliasCache;

    return {
      version: cache.version ?? "1.0.0",
      updated: cache.updated ?? Date.now(),
      entries: cache.entries ?? {},
    };
  } catch {
    console.log(colors.yellow("⚠️  Search aliases cache corrupted, creating new one"));
    return {
      version: "1.0.0",
      updated: Date.now(),
      entries: {},
    };
  }
}

function findAvailableSearchAliasId(url: string, entries: Record<string, string>): string {
  for (const length of [8, 10, 12, 16, 24, 32]) {
    const id = createSearchAliasId(url, length);

    if (!entries[id] || entries[id] === url) {
      return id;
    }
  }

  return createSearchAliasId(url, 64);
}

export async function saveSearchAliases(urls: string[]): Promise<Map<string, string>> {
  await ensureCacheDirectory();
  const cache = loadSearchAliasCache();
  const aliases = new Map<string, string>();

  for (const url of urls) {
    const id = findAvailableSearchAliasId(url, cache.entries);
    cache.entries[id] = url;
    aliases.set(url, id);
  }

  cache.updated = Date.now();

  try {
    writeJsonFileAtomic(CONFIG.SEARCH_ALIAS_FILE, cache);
    await updateCacheEntry("search-aliases", {
      id: "search-aliases",
      name: "Search Download Aliases",
      type: "file",
      path: "search-aliases.json",
      created: cache.updated,
      description: "Short ids for URLs shown by visuales search",
    });
  } catch {
    console.log(colors.yellow("⚠️  Failed to cache search download aliases"));
  }

  return aliases;
}

export async function resolveSearchAlias(idOrUrl: string): Promise<string> {
  if (idOrUrl.includes("://")) {
    return idOrUrl;
  }

  const cache = loadSearchAliasCache();
  return cache.entries[idOrUrl] ?? idOrUrl;
}

// Download cache functions
export async function ensureDownloadCacheDirectory(): Promise<void> {
  if (!fs.existsSync(CONFIG.DOWNLOAD_CACHE_DIR)) {
    fs.mkdirSync(CONFIG.DOWNLOAD_CACHE_DIR, { recursive: true });
  }

  // Update cache index for download cache
  await updateCacheEntry("download", {
    id: "download",
    name: "Download Cache",
    type: "directory",
    path: "download",
    created: Date.now(),
    description: "Resumable download cache files",
  });
}

export function getDownloadCachePath(url: string): string {
  const urlHash = Buffer.from(url).toString("base64").replace(/[+/=]/g, "").substr(0, 16);
  return path.join(CONFIG.DOWNLOAD_CACHE_DIR, `${urlHash}.json`);
}

export async function clearStaleDownloadCache(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): Promise<void> {
  await ensureDownloadCacheDirectory();

  try {
    const files = fs.readdirSync(CONFIG.DOWNLOAD_CACHE_DIR);
    const now = Date.now();
    let deletedCount = 0;

    for (const file of files) {
      const filePath = path.join(CONFIG.DOWNLOAD_CACHE_DIR, file);
      const stats = fs.statSync(filePath);

      if (now - stats.mtime.getTime() > maxAgeMs) {
        fs.unlinkSync(filePath);
        deletedCount++;
      }
    }

    if (deletedCount > 0) {
      console.log(colors.gray(`🗑️  Cleaned ${deletedCount} stale download cache files`));
      // Update cache index size
      await updateCacheEntry("download", {
        size: calculateDirectorySize(CONFIG.DOWNLOAD_CACHE_DIR),
      });
    }
  } catch {
    // Silently fail cache cleanup
  }
}

export async function getDiscoveryCache(): Promise<Record<string, unknown> | null> {
  if (!fs.existsSync(CONFIG.DISCOVERY_CACHE_FILE)) {
    return null;
  }

  try {
    const content = fs.readFileSync(CONFIG.DISCOVERY_CACHE_FILE, "utf-8");
    const data = JSON.parse(content);

    // Update index
    const stats = fs.statSync(CONFIG.DISCOVERY_CACHE_FILE);
    await updateCacheEntry("discovery", {
      id: "discovery",
      name: "Directory Discovery Cache",
      type: "file",
      path: "discovery.json",
      created: stats.birthtimeMs,
      description: "Cached directory listings for faster discovery",
    });

    return data;
  } catch {
    return null;
  }
}

export async function setDiscoveryCache(data: Record<string, unknown>): Promise<void> {
  await ensureCacheDirectory();
  try {
    writeJsonFileAtomic(CONFIG.DISCOVERY_CACHE_FILE, data);

    // Update index
    await updateCacheEntry("discovery", {
      id: "discovery",
      name: "Directory Discovery Cache",
      type: "file",
      path: "discovery.json",
      created: Date.now(),
      description: "Cached directory listings for faster discovery",
    });
  } catch {
    // Silently fail
  }
}
