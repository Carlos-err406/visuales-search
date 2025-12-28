import * as fs from "node:fs";
import * as path from "node:path";
import { formatDistanceToNow } from "date-fns";
import colors from "ansi-colors";
import { CONFIG, type CacheData } from "./types.js";

export async function ensureCacheDirectory(): Promise<void> {
  const cacheDir = path.dirname(CONFIG.CACHE_FILE);
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
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

    if (Date.now() - data.timestamp < CONFIG.CACHE_EXPIRY_MS) {
      console.log(colors.gray(`📦 Using cached data (${ageString})`));
      return data.html;
    }

    console.log(colors.yellow(`⏰ Cache expired (${ageString})`));
    return null;
  } catch (e) {
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
    fs.writeFileSync(CONFIG.CACHE_FILE, JSON.stringify(data, null, 2));
    console.log(colors.green("💾 Cached HTML for 24 hours"));
  } catch (e) {
    console.log(colors.yellow("⚠️  Failed to cache HTML"));
  }
}