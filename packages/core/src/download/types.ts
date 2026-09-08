export interface DownloadOptions {
  output: string;
  resume: boolean;
  maxRetries: number;
  timeout: number;
  concurrent: number;
  connections: number;
  compact: boolean;
  exclude: string[];
  verbose?: boolean;
}

export interface ThreadState {
  id: number;
  percentage: number;
  speed: number;
  bytes: number;
  isComplete: boolean;
  hasError: boolean;
}

export interface DownloadProgress {
  fileName: string;
  progress: number;
  speed: string;
  speedBytes?: number;
  totalSize: number;
  downloadedSize: number;
  overall?: DownloadOverallProgress;
}

export interface DownloadOverallProgress {
  completedFiles: number;
  totalFiles: number;
  downloadedBytes: number;
  totalBytes: number;
  speedBytes: number;
  activeFiles: DownloadActiveFileProgress[];
}

export interface DownloadActiveFileProgress {
  fileName: string;
  progress: number;
  downloadedSize: number;
  totalSize: number;
  speed: string;
}

// EasyDL progress event interfaces for better type safety
export interface EasyDLThreadDetail {
  speed: number;
  bytes: number;
  percentage: number;
}

export interface EasyDLProgressTotal {
  speed: number;
  bytes: number;
  percentage: number;
}

export interface EasyDLProgressReport {
  details: EasyDLThreadDetail[];
  total: EasyDLProgressTotal;
}

export interface EasyDLBuildProgress {
  percentage: number;
}
