import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

export interface SearchResult {
  url: string;
  text: string;
  directory: string;
  encodedUrl: string;
  isDirectoryLink: boolean;
}

export interface TreeNode {
  name: string;
  fullPath: string;
  children: Map<string, TreeNode>;
  results: SearchResult[];
  isDirectoryLink: boolean;
  ownUrl?: string;
  ownEncodedUrl?: string;
}

export interface CacheData {
  html: string;
  timestamp: number;
}

export interface DisplayOptions {
  prefix: string;
  isLast: boolean;
  isRoot: boolean;
}

export const CONFIG = {
  TARGET_URL: "https://visuales.uclv.cu/listado.html",
  get CACHE_FILE(): string {
    // Use fileURLToPath to properly convert URL to filesystem path
    const cliPath = fileURLToPath(new URL('./cli.js', import.meta.url));
    // From dist/cli.js -> go up to project root
    const projectRoot = path.dirname(path.dirname(cliPath));
    return path.join(projectRoot, '.cache', 'listado.html.json');
  },
  CACHE_EXPIRY_MS: 24 * 60 * 60 * 1000,
} as const;