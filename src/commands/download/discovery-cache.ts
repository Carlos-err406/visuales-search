import { getDiscoveryCache, setDiscoveryCache } from "../../lib/cache.js";

export const dirListingCache = new Map<
  string,
  { files: { url: string; size?: number; exact?: boolean }[]; dirs: string[] }
>();

export async function loadDiscoveryCache() {
  const data = await getDiscoveryCache();
  if (data) {
    for (const [url, entries] of Object.entries(data)) {
      dirListingCache.set(url, entries as any);
    }
  }
}

export async function saveDiscoveryCache() {
  const data = Object.fromEntries(dirListingCache.entries());
  await setDiscoveryCache(data);
}

export function updateCachedFileSize(fileUrl: string, bytes: number) {
  if (bytes <= 0) return;
  try {
    const parentUrl = fileUrl.substring(0, fileUrl.lastIndexOf("/") + 1);
    const cached = dirListingCache.get(parentUrl);
    if (cached) {
      const file = cached.files.find((f) => f.url === fileUrl);
      if (file && (file.size !== bytes || !file.exact)) {
        file.size = bytes;
        file.exact = true;
      }
    }
  } catch {
    // Ignore URL parsing errors
  }
}
