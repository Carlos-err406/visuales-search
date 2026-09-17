export type SearchIndexPhase = "idle" | "indexing" | "waiting" | "paused" | "offline" | "complete" | "partial";

export interface SearchIndexStatus {
  phase: SearchIndexPhase;
  files: number;
  completed: number;
  total: number;
  failed: number;
  skipped: number;
  revision: string;
  libraryRevision?: string;
  running: boolean;
  current?: string;
  lastUpdated?: number;
  error?: string;
  retryAt?: number;
}

export type SearchIndexAction = "pause" | "resume" | "refresh";

export function searchIndexLabel(status: SearchIndexStatus): string {
  switch (status.phase) {
    case "indexing":
      return status.total
        ? `Indexing files - ${status.completed.toLocaleString()} / ${status.total.toLocaleString()} folders`
        : "Preparing file index";
    case "waiting":
      return "Indexing - waiting for folder browsing";
    case "paused":
      return "File indexing paused";
    case "offline":
      return "File indexing - retrying later";
    case "partial":
      return `File index incomplete - ${status.failed + status.skipped} folders unavailable`;
    case "complete":
      return `${status.files.toLocaleString()} files indexed`;
    default:
      return status.total ? "File indexing pending" : "File index not started";
  }
}
