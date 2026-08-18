import * as path from "node:path";
import * as os from "node:os";

export interface SearchResult {
  url: string;
  text: string;
  directory: string;
  encodedUrl: string;
  isDirectoryLink: boolean;
  downloadId?: string;
}

export interface SearchAliasCache {
  version: string;
  updated: number;
  entries: Record<string, string>;
}

export interface TreeNode {
  name: string;
  fullPath: string;
  children: Map<string, TreeNode>;
  results: SearchResult[];
  isDirectoryLink: boolean;
  ownUrl?: string;
  ownEncodedUrl?: string;
  ownDownloadId?: string;
}

export interface CacheData {
  html: string;
  timestamp: number;
}

export interface CacheIndex {
  version: string;
  entries: CacheEntry[];
}

export interface CacheEntry {
  id: string;
  name: string;
  type: "file" | "directory";
  path: string;
  size: number;
  created: number;
  description?: string;
}

export interface DisplayOptions {
  prefix: string;
  isLast: boolean;
  isRoot: boolean;
}

export interface DownloadOptions {
  output: string; // Required output path
  resume: boolean; // default: true
  maxRetries: number; // default: 3
  timeout: number; // default: Infinity
  concurrent: number; // default: 3
}

export interface DownloadProgress {
  fileName: string;
  total: number;
  downloaded: number;
  percentage: number;
  speed: number;
  eta: number;
}

export interface DownloadStats {
  totalFiles: number;
  discoveredFiles: number;
  downloadingFiles: number;
  completedFiles: number;
  failedFiles: number;
  totalBytes: number;
  downloadedBytes: number;
  activeDownloads: Map<string, DownloadProgress>;
  startTime: Date;
}

export interface DirectoryItem {
  name: string;
  url: string;
  isDirectory: boolean;
  size?: number;
  lastModified?: Date;
}

export interface DiscoveredFile {
  url: string;
  localPath: string;
  relativePath: string;
  size?: number;
}

export interface DownloadTask {
  id: string;
  url: string;
  localPath: string;
  size?: number;
  retries: number;
  directoryContext: string;
}

export const CONFIG = {
  TARGET_URL: "https://visuales.uclv.cu/listado.html",
  get CACHE_DIR(): string {
    return path.join(os.homedir(), ".visuales-cli-cache");
  },
  get CACHE_INDEX_FILE(): string {
    return path.join(this.CACHE_DIR, "index.json");
  },
  get CACHE_FILE(): string {
    return path.join(this.CACHE_DIR, "list.json");
  },
  get DOWNLOAD_CACHE_DIR(): string {
    return path.join(this.CACHE_DIR, "download");
  },
  get DISCOVERY_CACHE_FILE(): string {
    return path.join(this.CACHE_DIR, "discovery.json");
  },
  get SEARCH_ALIAS_FILE(): string {
    return path.join(this.CACHE_DIR, "search-aliases.json");
  },
} as const;
