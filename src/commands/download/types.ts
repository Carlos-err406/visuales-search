export interface DownloadOptions {
  output: string;
  resume: boolean;
  maxRetries: number;
  timeout: number;
  concurrent: number;
  verbose?: boolean;
}

export interface DownloadProgress {
  fileName: string;
  progress: number;
  speed: string;
  totalSize: number;
  downloadedSize: number;
}
