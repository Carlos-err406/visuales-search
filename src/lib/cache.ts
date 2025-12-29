import * as fs from "node:fs";
import * as path from "node:path";
import { formatDistanceToNow } from "date-fns";
import colors from "ansi-colors";
import {
  CONFIG,
  type CacheData,
  type CacheIndex,
  type CacheEntry,
} from "./types.js";

export async function ensureCacheDirectory(): Promise<void> {
  if (!fs.existsSync(CONFIG.CACHE_DIR)) {
    fs.mkdirSync(CONFIG.CACHE_DIR, { recursive: true });
  }
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
  } catch (e) {
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
    fs.writeFileSync(CONFIG.CACHE_INDEX_FILE, JSON.stringify(index, null, 2));
  } catch (e) {
    console.log(colors.yellow("⚠️  Failed to save cache index"));
  }
}

async function updateCacheEntry(
  id: string,
  updates: Partial<CacheEntry>
): Promise<void> {
  const index = await loadCacheIndex();
  const existingEntryIndex = index.entries.findIndex(
    (entry) => entry.id === id
  );

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

  // Update sizes on the fly
  for (const entry of index.entries) {
    if (entry.type === "file") {
      entry.size = calculateFileSize(path.join(CONFIG.CACHE_DIR, entry.path));
    } else if (entry.type === "directory") {
      entry.size = calculateDirectorySize(
        path.join(CONFIG.CACHE_DIR, entry.path)
      );
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
  } catch (e) {
    throw new Error(`Failed to clear cache '${entry.name}': ${e}`);
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
      console.log(
        colors.yellow(`⚠️  Failed to clear cache '${entry.name}': ${e}`)
      );
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
    entry.size = calculateDirectorySize(
      path.join(CONFIG.CACHE_DIR, entry.path)
    );
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
  } catch (e) {
    console.log(
      colors.yellow("⚠️  Cache file corrupted, will fetch fresh data")
    );
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
    fs.writeFileSync(CONFIG.CACHE_FILE, JSON.stringify(data, null, 2));

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
  } catch (e) {
    console.log(colors.yellow("⚠️  Failed to cache HTML"));
  }
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
  const urlHash = Buffer.from(url)
    .toString("base64")
    .replace(/[+/=]/g, "")
    .substr(0, 16);
  return path.join(CONFIG.DOWNLOAD_CACHE_DIR, `${urlHash}.json`);
}

export async function clearStaleDownloadCache(
  maxAgeMs: number = 7 * 24 * 60 * 60 * 1000
): Promise<void> {
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
      console.log(
        colors.gray(`🗑️  Cleaned ${deletedCount} stale download cache files`)
      );
      // Update cache index size
      await updateCacheEntry("download", {
        size: calculateDirectorySize(CONFIG.DOWNLOAD_CACHE_DIR),
      });
    }
  } catch (e) {
    // Silently fail cache cleanup
  }
}
