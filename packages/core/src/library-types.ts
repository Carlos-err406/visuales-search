import type { SearchResult } from "./lib/types.js";

export interface LibraryEntry extends SearchResult {
  size?: number;
}

export interface FilePreview {
  url: string;
  kind: "image" | "text";
  mime: string;
  content: string;
  bytes: number;
  cached: boolean;
  fetchedAt: number;
}

export const previewLimits = { image: 4 * 1024 * 1024, text: 512 * 1024, cache: 32 * 1024 * 1024, age: 86400000 };

export function previewKind(url: string): FilePreview["kind"] | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname.toLowerCase();
  } catch {
    return null;
  }
  const extension = pathname.split(".").at(-1) ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(extension)) return "image";
  if (
    [
      "txt",
      "md",
      "nfo",
      "srt",
      "vtt",
      "csv",
      "json",
      "log",
      "ini",
      "conf",
      "yaml",
      "yml",
      "xml",
      "html",
      "htm",
      "css",
      "js",
      "ts",
      "py",
      "sh",
    ].includes(extension)
  )
    return "text";
  return null;
}
