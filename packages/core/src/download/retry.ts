import path from "node:path";
import fs from "node:fs/promises";
import pLimit from "p-limit";
import { downloadFile } from "./downloader.js";
import { readDownloadFileDetails, recordDownloadFiles, type DownloadFileDetail } from "./file-details.js";
import {
  completeDownloadTask,
  failDownloadTask,
  findDownloadTask,
  updateDownloadTaskProgress,
  type DownloadTaskRecord,
} from "./tasks.js";
import { decodePathSegment } from "./targets.js";

async function retryOutput(root: string, file: DownloadFileDetail): Promise<string> {
  const url = new URL(file.url);
  if (!["http:", "https:"].includes(url.protocol) || url.pathname.endsWith("/"))
    throw new Error("A file retry requires an HTTP file URL.");
  const segments = file.path.split("/");
  if (
    segments.some((part) => !part || part === "." || part === ".." || part.includes("\\") || part.includes(":")) ||
    segments.at(-1) !== decodePathSegment(url.pathname.split("/").at(-1)!)
  )
    throw new Error(`Unsafe recorded file path: ${file.path}`);
  let current = path.resolve(root);
  // Refuse symlinked descendants rather than writing outside the recorded output directory.
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      if ((await fs.lstat(current)).isSymbolicLink()) throw new Error(`Symlink in retry destination: ${file.path}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return path.dirname(current);
}

/** Runs only a previously claimed selection, retaining all untouched records and the original task identity. */
export async function runDownloadFileRetry(
  task: DownloadTaskRecord,
  fileLimit?: ReturnType<typeof pLimit>
): Promise<void> {
  const current = await findDownloadTask(task.id);
  if (!current || current.pid !== process.pid || current.status !== "running" || !current.retryPaths?.length)
    throw new Error("The retry must be claimed by this worker first.");
  task = current;
  try {
    const details = await readDownloadFileDetails(task.id);
    if (!details) throw new Error("File details are unavailable.");
    const files = details.files;
    const selected = files.filter((file) => task.retryPaths!.includes(file.path) && file.status !== "completed");
    const targets = await Promise.all(
      selected.map(async (file) => ({ file, output: await retryOutput(task.output, file) }))
    );
    const totalFiles = Math.max(files.length, task.overallProgress?.totalFiles ?? 0);
    const missingBytes =
      totalFiles > files.length
        ? Math.max(
            0,
            (task.overallProgress?.totalBytes ?? 0) -
              files.reduce((sum, file) => sum + (file.totalBytes ?? file.downloadedBytes), 0)
          )
        : 0;
    const options = {
      ...task.options,
      resume: true,
      timeout: task.options.timeout === "Infinity" ? Infinity : task.options.timeout,
    };
    const limit = fileLimit ?? pLimit(options.concurrent);
    await recordDownloadFiles(
      task.id,
      task.output,
      async () => {
        await Promise.all(
          targets.map(({ file, output }, index) =>
            limit(async () => {
              try {
                await downloadFile(
                  file.url,
                  { ...options, output },
                  undefined,
                  file.totalBytes ?? undefined,
                  index + 1
                );
              } catch {
                // downloadFile records the failure; other selected files must still get their retry.
              }
            })
          )
        );
      },
      {
        initialFiles: files.map((file) => ({
          ...file,
          status: file.status === "downloading" ? "interrupted" : file.status,
          speedBytes: 0,
          connections: undefined,
        })),
        onSnapshot: async (snapshot) => {
          const active = snapshot.filter(
            (file) => file.status === "downloading" && task.retryPaths!.includes(file.path)
          );
          const current = active[0];
          await updateDownloadTaskProgress(
            task.id,
            {
              url: current?.url,
              fileName: current?.path ?? selected[0]?.path ?? "Retry",
              progress: current?.totalBytes ? (100 * current.downloadedBytes) / current.totalBytes : 0,
              downloadedSize: current?.downloadedBytes ?? 0,
              totalSize: current?.totalBytes ?? 0,
              speed: `${current?.speedBytes ?? 0} B/s`,
              overall: {
                completedFiles: snapshot.filter((file) => file.status === "completed").length,
                totalFiles,
                downloadedBytes: snapshot.reduce((sum, file) => sum + file.downloadedBytes, 0),
                totalBytes:
                  missingBytes +
                  snapshot.reduce((sum, file) => sum + Math.max(file.totalBytes ?? 0, file.downloadedBytes), 0),
                speedBytes: active.reduce((sum, file) => sum + (file.speedBytes ?? 0), 0),
                activeFiles: active.map((file) => ({
                  url: file.url,
                  fileName: file.path,
                  progress: file.totalBytes ? (100 * file.downloadedBytes) / file.totalBytes : 0,
                  downloadedSize: file.downloadedBytes,
                  totalSize: file.totalBytes ?? 0,
                  speed: `${file.speedBytes ?? 0} B/s`,
                })),
              },
            },
            true
          );
        },
      }
    );
    const final = await readDownloadFileDetails(task.id);
    const unfinished = totalFiles - (final?.files.filter((file) => file.status === "completed").length ?? 0);
    if (unfinished)
      throw new Error(
        `${unfinished} ${unfinished === 1 ? "file still needs" : "files still need"} attention. Retry failed files or resume the transfer.`
      );
    await completeDownloadTask(task.id);
  } catch (error) {
    if (task.pid === process.pid) await failDownloadTask(task.id, error);
    throw error;
  }
}
