import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { CONFIG } from "../lib/types.js";
import type { DownloadConnectionProgress } from "./types.js";
import { isUnavailablePageFile } from "./file-state.js";

export const FILE_VERIFICATION_VERSION = 1;

export interface DownloadFileDetail {
  url: string;
  path: string;
  status: "waiting" | "downloading" | "completed" | "failed" | "interrupted";
  downloadedBytes: number;
  totalBytes: number | null;
  estimated?: boolean;
  verified?: boolean;
  verificationVersion?: number;
  localMtimeMs?: number;
  error?: string;
  speedBytes?: number;
  progressUpdatedAt?: number;
  connections?: DownloadConnectionProgress;
}

export interface DownloadFileDetails {
  version: 1;
  updatedAt: number;
  files: DownloadFileDetail[];
}

interface Recorder {
  output: string;
  files: Map<string, DownloadFileDetail>;
  dirty: boolean;
  restoredKeys: Set<string>;
}

const recording = new AsyncLocalStorage<Recorder>();

async function unchangedCompletion(file: DownloadFileDetail, output: string) {
  if (
    file.status !== "completed" ||
    file.verified !== true ||
    file.verificationVersion !== FILE_VERIFICATION_VERSION ||
    file.localMtimeMs === undefined ||
    file.totalBytes !== file.downloadedBytes ||
    file.estimated
  )
    return null;
  const segments = file.path.split("/");
  if (segments.some((part) => !part || part === "." || part === ".." || /[\\:]/.test(part))) return null;
  let destination = path.resolve(output);
  try {
    for (const segment of segments) {
      destination = path.join(destination, segment);
      if ((await fs.lstat(destination)).isSymbolicLink()) return null;
    }
    const stat = await fs.stat(destination);
    if (!stat.isFile() || stat.size !== file.totalBytes) return null;
    if (stat.mtimeMs !== file.localMtimeMs) return null;
    if (await isUnavailablePageFile(destination)) return null;
    return { ...file, localMtimeMs: stat.mtimeMs, speedBytes: 0, connections: undefined };
  } catch {
    return null;
  }
}

export async function recordedFileCompletion(
  url: string,
  output: string,
  name: string
): Promise<DownloadFileDetail | null> {
  const recorder = recording.getStore();
  if (!recorder) return null;
  const relative = path.relative(recorder.output, path.join(output, name)).split(path.sep).join("/");
  const file = recorder.files.get(`${url}\n${relative}`);
  recorder.restoredKeys.delete(`${url}\n${relative}`);
  return file ? unchangedCompletion(file, recorder.output) : null;
}

function detailsPath(taskId: string): string {
  const key = createHash("sha256").update(taskId).digest("hex");
  return path.join(CONFIG.DOWNLOAD_CACHE_DIR, "file-details", `${key}.json`);
}

export function reportDownloadFile(
  url: string,
  output: string,
  name: string,
  update: Partial<Omit<DownloadFileDetail, "url" | "path">>
): void {
  const recorder = recording.getStore();
  if (!recorder) return;
  const filePath = path.relative(recorder.output, path.join(output, name)).split(path.sep).join("/");
  const key = `${url}\n${filePath}`;
  recorder.restoredKeys.delete(key);
  const previous = recorder.files.get(key);
  recorder.files.set(key, {
    url,
    path: filePath,
    status: "waiting",
    downloadedBytes: 0,
    totalBytes: null,
    ...previous,
    ...update,
    ...(update.status === "completed" && previous?.verified === false ? { totalBytes: null } : {}),
  });
  recorder.dirty = true;
}

/** One writer per running task; snapshots stay separate from the frequently polled task summaries. */
export async function recordDownloadFiles<T>(
  taskId: string,
  output: string,
  operation: () => Promise<T>,
  options: {
    resume?: boolean;
    initialFiles?: DownloadFileDetail[];
    onSnapshot?: (files: DownloadFileDetail[]) => Promise<void>;
  } = {}
): Promise<T> {
  let initialFiles = options.initialFiles;
  if (options.resume && !initialFiles) {
    const previous = await readDownloadFileDetails(taskId).catch(() => null);
    initialFiles = [];
    // Only restore proven local completions. Discovery rebuilds the remaining records.
    for (const file of previous?.files ?? []) {
      const completed = await unchangedCompletion(file, output);
      if (completed) initialFiles.push(completed);
    }
  }
  const recorder: Recorder = {
    output,
    files: new Map(initialFiles?.map((file) => [`${file.url}\n${file.path}`, { ...file }])),
    dirty: true,
    restoredKeys: new Set(options.resume ? initialFiles?.map((file) => `${file.url}\n${file.path}`) : []),
  };
  const destination = detailsPath(taskId);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  let writes = Promise.resolve();
  const flush = () => {
    writes = writes.then(async () => {
      if (!recorder.dirty) return;
      recorder.dirty = false;
      const snapshot: DownloadFileDetails = { version: 1, updatedAt: Date.now(), files: [...recorder.files.values()] };
      const temporary = `${destination}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, JSON.stringify(snapshot), "utf8");
        await fs.rename(temporary, destination);
        await options.onSnapshot?.(snapshot.files);
      } finally {
        await fs.rm(temporary, { force: true });
      }
    });
    void writes.catch(() => {});
    return writes;
  };
  await flush();
  const timer = setInterval(() => void flush(), 1000);
  timer.unref();
  let succeeded = false;
  try {
    const result = await recording.run(recorder, operation);
    succeeded = true;
    return result;
  } finally {
    clearInterval(timer);
    if (succeeded && recorder.restoredKeys.size) {
      for (const key of recorder.restoredKeys) recorder.files.delete(key);
      recorder.dirty = true;
    }
    await flush();
  }
}

export async function readDownloadFileDetails(taskId: string): Promise<DownloadFileDetails | null> {
  try {
    const data = JSON.parse(await fs.readFile(detailsPath(taskId), "utf8")) as DownloadFileDetails;
    if (
      data?.version !== 1 ||
      !Number.isFinite(data.updatedAt) ||
      !Array.isArray(data.files) ||
      !data.files.every(
        (file) =>
          file &&
          typeof file.url === "string" &&
          typeof file.path === "string" &&
          ["waiting", "downloading", "completed", "failed", "interrupted"].includes(file.status) &&
          Number.isFinite(file.downloadedBytes) &&
          file.downloadedBytes >= 0 &&
          (file.localMtimeMs === undefined || (Number.isFinite(file.localMtimeMs) && file.localMtimeMs >= 0)) &&
          (file.totalBytes === null || (Number.isFinite(file.totalBytes) && file.totalBytes >= 0)) &&
          (file.speedBytes === undefined || (Number.isFinite(file.speedBytes) && file.speedBytes >= 0)) &&
          (file.progressUpdatedAt === undefined ||
            (Number.isFinite(file.progressUpdatedAt) && file.progressUpdatedAt >= 0)) &&
          (file.connections === undefined ||
            (file.connections !== null &&
              Number.isInteger(file.connections.active) &&
              file.connections.active >= 0 &&
              ((file.connections.chunksCompleted === undefined && file.connections.chunksTotal === undefined) ||
                (typeof file.connections.chunksCompleted === "number" &&
                  typeof file.connections.chunksTotal === "number" &&
                  Number.isInteger(file.connections.chunksCompleted) &&
                  Number.isInteger(file.connections.chunksTotal) &&
                  file.connections.chunksCompleted >= 0 &&
                  file.connections.chunksTotal > 0 &&
                  file.connections.chunksCompleted <= file.connections.chunksTotal)))) &&
          (file.error === undefined || typeof file.error === "string")
      )
    )
      throw new Error("The recorded file details are invalid or use an unsupported format.");
    return data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function removeDownloadFileDetails(taskId: string): Promise<void> {
  await fs.rm(detailsPath(taskId), { force: true });
}
