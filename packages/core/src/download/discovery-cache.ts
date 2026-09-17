import { getDiscoveryCache, mergeDiscoveryCache } from "../lib/cache.js";

export interface DirectoryListing {
  files: { url: string; size: number; exact?: boolean }[];
  dirs: string[];
  parserVersion?: number;
  fetchedAt?: number;
}

export const DIRECTORY_LISTING_PARSER_VERSION = 4;

export const dirListingCache = new Map<string, DirectoryListing>();
const baseline = new Map<string, string>();

export async function loadDiscoveryCache() {
  const data = await getDiscoveryCache();
  if (data) {
    for (const [url, entries] of Object.entries(data)) {
      try {
        const listing = normalizeDirectoryListing(entries as DirectoryListing);
        dirListingCache.set(url, listing);
        baseline.set(url, JSON.stringify(listing));
      } catch {
        /* One corrupt directory must not discard healthy cache entries. */
      }
    }
  }
}

export async function saveDiscoveryCache() {
  const dirty = [...dirListingCache].filter(([url, listing]) => baseline.get(url) !== JSON.stringify(listing));
  if (!dirty.length) return;
  await mergeDiscoveryCache((current) => {
    for (const [url, listing] of dirty) {
      const stored = current[url] as DirectoryListing | undefined;
      if (!stored || (listing.fetchedAt ?? 0) > (stored.fetchedAt ?? 0)) current[url] = listing;
      else if (stored.fetchedAt === listing.fetchedAt && Array.isArray(stored.files)) {
        const previous = baseline.get(url);
        const old = previous ? (JSON.parse(previous) as DirectoryListing) : undefined;
        for (const file of listing.files) {
          const before = old?.files.find((item) => item.url === file.url);
          const target = stored.files.find((item) => item.url === file.url);
          if (before && target && file.exact && (before.size !== file.size || before.exact !== file.exact))
            Object.assign(target, { size: file.size, exact: true });
        }
      }
    }
    return current;
  });
  for (const [url, listing] of dirty) baseline.set(url, JSON.stringify(listing));
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
    fetchedAt: listing.fetchedAt,
  };
}

function isSuspiciousUnavailablePageSize(file: { url: string; size: number }): boolean {
  const pathname = new URL(file.url).pathname.toLowerCase();
  const extension = pathname.split(".").pop() ?? "";

  return file.size >= 100 && file.size <= 512 && extension !== "html" && extension !== "htm";
}
