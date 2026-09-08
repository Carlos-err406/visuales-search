import path from "node:path";
import { createHash } from "node:crypto";
import type { DownloadTarget } from "./downloader.js";

export function createDownloadTargets(urls: string[], outputBasePath: string): DownloadTarget[] {
  const usedDirectoryNames = new Map<string, string>();

  return urls.map((url) => {
    if (!url.endsWith("/")) {
      return {
        url,
        output: outputBasePath,
        relativePath: "",
      };
    }

    const directoryName = getUrlDirectoryName(url);
    const uniqueDirectoryName = getUniqueDirectoryName(directoryName, url, usedDirectoryNames);

    return {
      url,
      output: path.join(outputBasePath, uniqueDirectoryName),
      relativePath: uniqueDirectoryName,
    };
  });
}

function getUrlDirectoryName(url: string): string {
  const trimmedPathname = new URL(url).pathname.replace(/\/+$/, "");
  const directoryName = decodePathSegment(path.basename(trimmedPathname));

  return directoryName || "download";
}

function getUniqueDirectoryName(directoryName: string, url: string, usedDirectoryNames: Map<string, string>): string {
  const existingUrl = usedDirectoryNames.get(directoryName);
  if (!existingUrl) {
    usedDirectoryNames.set(directoryName, url);
    return directoryName;
  }

  if (existingUrl === url) {
    return directoryName;
  }

  const suffix = createHash("sha1").update(url).digest("hex").slice(0, 6);
  const uniqueDirectoryName = `${directoryName}-${suffix}`;
  usedDirectoryNames.set(uniqueDirectoryName, url);
  return uniqueDirectoryName;
}

export function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
