import type { DownloadTaskRecord, DownloadTaskStatus } from "./download/tasks.js";
import { createGlobMatcher } from "./download/utils.js";
import { canonicalTreeUrl } from "./search-tree.js";

export interface SearchDownloadStatus {
  status: DownloadTaskStatus;
  label: string;
  description: string;
}

type Match = { task: DownloadTaskRecord; source: string; progress?: number };
const priority = (task: DownloadTaskRecord) => (task.status === "running" ? 2 : task.status === "queued" ? 1 : 0);

function parents(url: string): string[] {
  const parsed = new URL(url);
  const parts = parsed.pathname.replace(/\/$/, "").split("/");
  const result: string[] = [];
  while (parts.length > 1) {
    parts.pop();
    result.push(`${parsed.origin}${parts.join("/")}/`);
  }
  return result;
}

function identity(value: string): string | undefined {
  try {
    const url = new URL(canonicalTreeUrl(value));
    if (url.protocol !== "https:" && url.protocol !== "http:") return;
    url.hash = "";
    return url.href;
  } catch {
    return;
  }
}

// Build once per task snapshot, not once per library row. Historical folder tasks
// are coverage context, never proof that an individual file exists on disk.
export function createSearchDownloadStatusIndex(tasks: readonly DownloadTaskRecord[], now = Date.now()) {
  const exact = new Map<string, Match[]>();
  const excluded = new Map<DownloadTaskRecord, ReturnType<typeof createGlobMatcher>>();
  function add(map: Map<string, Match[]>, key: string, match: Match) {
    const values = map.get(key) ?? [];
    const existing = values.find((value) => value.task === match.task && value.source === match.source);
    if (!existing) values.push(match);
    else if (match.progress !== undefined) existing.progress = match.progress;
    map.set(key, values);
  }
  for (const task of tasks) {
    excluded.set(task, createGlobMatcher(task.options?.exclude ?? []));
    for (const value of task.urls?.length ? task.urls : [task.url]) {
      const source = identity(value);
      if (!source) continue;
      const match = { task, source };
      add(exact, source, match);
    }
    const overall = task.overallProgress;
    const progress = overall?.activeFiles ?? (task.lastProgress ? [task.lastProgress] : []);
    const updatedAt = overall?.updatedAt ?? task.lastProgress?.updatedAt ?? 0;
    if (task.status === "running" && now - updatedAt <= 10000 && updatedAt >= (task.startedAt ?? 0)) {
      for (const file of progress) {
        const source = file.url && identity(file.url);
        if (source) add(exact, source, { task, source, progress: file.progress });
      }
    }
  }
  return (value: string, directory: boolean): SearchDownloadStatus | undefined => {
    const url = identity(value);
    if (!url) return;
    const matches: (Match & { relation: "exact" | "parent" })[] = [];
    exact.get(url)?.forEach((match) => matches.push({ ...match, relation: "exact" }));
    for (const parent of parents(url)) {
      exact.get(parent)?.forEach((match) => {
        if (match.task.status === "completed") return;
        const relative = new URL(url).pathname.slice(new URL(parent).pathname.length);
        let decoded = relative;
        try {
          decoded = decodeURIComponent(relative);
        } catch {
          /* Keep malformed escapes literal. */
        }
        if (!excluded.get(match.task)?.(decoded)) matches.push({ ...match, relation: "parent" });
      });
    }
    matches.sort(
      (a, b) =>
        priority(b.task) - priority(a.task) ||
        b.task.updatedAt - a.task.updatedAt ||
        Number(b.relation === "exact") - Number(a.relation === "exact") ||
        Number(b.progress !== undefined) - Number(a.progress !== undefined)
    );
    const match = matches[0];
    if (!match) return;
    const { task, relation } = match;
    const state = task.status;
    let label = state.charAt(0).toUpperCase() + state.slice(1);
    if (relation === "parent") label = `Folder transfer ${state}`;
    else if (state === "completed" && directory && task.options?.exclude?.length) label = "Completed subset";
    else if (state === "running" && match.progress !== undefined && Number.isFinite(match.progress)) {
      label = `Downloading ${Math.floor(Math.max(0, Math.min(99, match.progress)))}%`;
    }
    const coverage =
      relation === "exact"
        ? "Recorded transfer status; local files have not been rechecked."
        : "Status of the enclosing folder transfer; this item's individual completion is unknown.";
    return { status: state, label, description: `${label}. ${coverage} Destination: ${task.output}` };
  };
}
