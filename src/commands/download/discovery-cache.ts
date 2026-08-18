import { getDiscoveryCache, setDiscoveryCache } from "../../lib/cache.js";

export interface DirectoryListing {
  files: { url: string; size: number; exact?: boolean }[];
  dirs: string[];
  parserVersion?: number;
}

export const DIRECTORY_LISTING_PARSER_VERSION = 4;

export const dirListingCache = new Map<string, DirectoryListing>();

export async function loadDiscoveryCache() {
  const data = await getDiscoveryCache();
  if (data) {
    for (const [url, entries] of Object.entries(data)) {
      dirListingCache.set(url, normalizeDirectoryListing(entries as DirectoryListing));
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

export function getCachedFileSize(fileUrl: string): number {
  return getCachedFileSizeInfo(fileUrl).size;
}

export function getCachedFileSizeInfo(fileUrl: string): { size: number; exact: boolean } {
  try {
    const parentUrl = fileUrl.substring(0, fileUrl.lastIndexOf("/") + 1);
    const cached = dirListingCache.get(parentUrl);
    if (cached) {
      const file = cached.files.find((f) => f.url === fileUrl);
      return {
        size: file?.size || 0,
        exact: cached.parserVersion === DIRECTORY_LISTING_PARSER_VERSION && file?.exact === true,
      };
    }
  } catch {
    // Ignore URL parsing errors
  }
  return { size: 0, exact: false };
}

function normalizeDirectoryListing(listing: DirectoryListing): DirectoryListing {
  return {
    files: listing.files.map((file) => ({
      ...file,
      size: isSuspiciousUnavailablePageSize(file) ? 0 : file.size,
      exact:
        listing.parserVersion === DIRECTORY_LISTING_PARSER_VERSION &&
        file.exact === true &&
        !isSuspiciousUnavailablePageSize(file),
    })),
    dirs: listing.dirs,
    parserVersion: DIRECTORY_LISTING_PARSER_VERSION,
  };
}

function isSuspiciousUnavailablePageSize(file: { url: string; size: number }): boolean {
  const pathname = new URL(file.url).pathname.toLowerCase();
  const extension = pathname.split(".").pop() ?? "";

  return file.size >= 100 && file.size <= 512 && extension !== "html" && extension !== "htm";
}
