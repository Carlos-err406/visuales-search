export type SearchIndexPhase = "idle" | "indexing" | "waiting" | "paused" | "offline" | "complete" | "partial";

export interface SearchIndexStatus {
  phase: SearchIndexPhase;
  files: number;
  completed: number;
  total: number;
  failed: number;
  skipped: number;
  deferred?: number;
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
  const finished = status.total > 0 && status.completed + status.failed + status.skipped >= status.total;
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
      return finished ? "Scan finished with exceptions" : "File indexing - retrying later";
    case "partial":
      return "Scan finished with exceptions";
    case "complete":
      return `${status.files.toLocaleString()} files indexed`;
    default:
      return status.total ? "File indexing pending" : "File index not started";
  }
}
