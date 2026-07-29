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
  totalSize: number;
  downloadedSize: number;
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
