import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import {
  searchContent,
  downloadUrl,
  downloadUrls,
  listDownloadTasks,
  findDownloadTask,
  createDownloadTaskId,
  startDownloadTaskWithPid,
  completeDownloadTask,
  failDownloadTask,
  interruptDownloadTask,
  cancelDownloadTask,
  cancelAllDownloadTasks,
  deleteDownloadTask,
  updateDownloadTaskProgress,
  waitForQueueSlot,
  moveQueuedDownloadTask,
  type QueueMove,
  setLogger,
  type DownloadOptions,
  type DownloadProgress,
  claimDownloadFileRetry,
  runDownloadFileRetry,
  reviewDownload,
} from "@visuales/core";
import { createDownloadTargets } from "@visuales/core/download/targets";
import { downloadDefaults } from "@visuales/core/download/defaults";
import { summarizeTransfers, transferName } from "@visuales/core/download/transfer-summary";
import { loadDesktopSettings, saveDesktopSettings, resolveDesktopOutput } from "@visuales/core/desktop-settings";
import {
  listLibraryDirectory,
  previewLibraryFile,
  cachedLibraryPreview,
  libraryPreviewStatus,
  libraryUrl,
} from "@visuales/core/library";
import { downloadedLibraryFile } from "@visuales/core/library-local";
import { canonicalTreeUrl } from "@visuales/core/search-tree";
import { previewKind } from "@visuales/core/library-types";
import { recordDownloadFiles, readDownloadFileDetails } from "@visuales/core/download/file-details";

const PROTOCOL_VERSION = 1;
setLogger({ log: (...values) => console.error(...values), error: (...values) => console.error(...values) });

type WorkerConfig = { taskId: string; urls: string[]; options: DownloadOptions; queue: boolean; retry?: boolean };
type WorkerMessage = { type: "ready" } | { type: "finished"; taskId: string; status: "completed" | "failed" };
type TransferNotice = { taskId: string; name: string; status: "completed" | "failed"; at: number };

async function runWorker(config: WorkerConfig) {
  const { taskId, urls, queue } = config;
  // JSON transports Infinity as null; task records use the explicit string "Infinity".
  const options = { ...config.options, timeout: config.options.timeout ?? Infinity };
  let progressWrites = Promise.resolve();
  let status: "completed" | "failed" = "completed";
  const onProgress = (progress: DownloadProgress) => {
    progressWrites = progressWrites.then(() => updateDownloadTaskProgress(taskId, progress));
    // Avoid an unhandled rejection while the transfer is still producing progress.
    void progressWrites.catch(() => {});
  };
  try {
    if (queue) {
      if (!(await waitForQueueSlot(taskId))) return;
    }
    if (config.retry) {
      const task = await findDownloadTask(taskId);
      if (!task) throw new Error("Download task not found");
      await runDownloadFileRetry(task);
    } else {
      await recordDownloadFiles(
        taskId,
        options.output,
        async () => {
          if (urls.length === 1) await downloadUrl(urls[0], options, onProgress);
          else await downloadUrls(createDownloadTargets(urls, options.output), options, onProgress);
        },
        { resume: options.resume }
      );
      await progressWrites;
      await completeDownloadTask(taskId);
    }
  } catch (error) {
    await progressWrites.catch(() => {});
    await failDownloadTask(taskId, error);
    status = "failed";
  }
  // Flush the terminal event before exiting, including transfers faster than a poll.
  await new Promise<void>((resolve) => {
    if (process.send)
      process.send({ type: "finished", taskId, status } satisfies WorkerMessage, undefined, undefined, () => resolve());
    else resolve();
  });
}

if (process.argv.includes("--worker")) {
  process.on("disconnect", () => process.exit(130));
  process.on("SIGTERM", () => process.exit(130));
  process.on("SIGINT", () => process.exit(130));
  process.once("message", (config: WorkerConfig) => {
    void runWorker(config).then(
      () => process.exit(0),
      (error) => {
        console.error(error);
        process.exit(1);
      }
    );
  });
  process.send?.({ type: "ready" });
} else {
  void runServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

async function runServer() {
  const workers = new Map<string, { child: ChildProcess; closed: Promise<void>; silence: () => void }>();
  const notices: TransferNotice[] = [];
  const reviews = new Map<string, { urls: string[]; options: DownloadOptions; expires: number }>();
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  let shuttingDown = false;
  const send = (value: unknown) => {
    if (!process.stdout.destroyed) process.stdout.write(`${JSON.stringify(value)}\n`);
  };
  const changed = () => send({ jsonrpc: "2.0", method: "tasks.changed", params: {} });

  async function start(urls: string[], options: DownloadOptions, queue = false, retry?: { paths?: string[] }) {
    const taskId = createDownloadTaskId(urls, options.output);
    const existing = await findDownloadTask(taskId);
    if (existing?.status === "running" || existing?.status === "queued") {
      if (retry) throw new Error("Wait for this transfer to stop before retrying its files.");
      return existing;
    }
    if (workers.has(taskId)) throw new Error("This task is still stopping. Try again shortly.");
    const child = spawn(process.execPath, [process.argv[1], "--worker", "download", ...urls], {
      stdio: ["ignore", "ignore", "pipe", "ipc"],
      windowsHide: true,
    });
    child.stderr?.pipe(process.stderr, { end: false });
    let taskRegistered = false;
    let notificationAllowed = true;
    const closed = new Promise<void>((resolve) => {
      child.once("close", () => {
        void (async () => {
          if (taskRegistered) {
            const task = await findDownloadTask(taskId);
            if (task && task.pid === child.pid && (task.status === "running" || task.status === "queued")) {
              await interruptDownloadTask(taskId, "process-exited");
            }
          }
          workers.delete(taskId);
          changed();
        })()
          .catch(console.error)
          .finally(resolve);
      });
    });
    workers.set(taskId, { child, closed, silence: () => (notificationAllowed = false) });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Download worker did not start")), 15000);
        const finish = (error?: Error) => {
          clearTimeout(timer);
          child.removeListener("error", onError);
          child.removeListener("exit", onExit);
          if (error) reject(error);
          else resolve();
        };
        const onError = (error: Error) => finish(error);
        const onExit = () => finish(new Error("Download worker exited before startup"));
        child.once("error", onError);
        child.once("exit", onExit);
        child.once("message", (message: WorkerMessage) => {
          finish(message.type === "ready" ? undefined : new Error("Invalid worker handshake"));
        });
      });
      const task = retry
        ? await claimDownloadFileRetry(taskId, retry.paths, child.pid!)
        : await startDownloadTaskWithPid(urls, options, child.pid!, undefined, queue ? "queued" : "running");
      taskRegistered = true;
      child.on("message", (message: WorkerMessage) => {
        if (
          message.type === "finished" &&
          message.taskId === taskId &&
          (message.status === "completed" || message.status === "failed") &&
          notificationAllowed &&
          !shuttingDown
        ) {
          notificationAllowed = false;
          notices.push({ taskId, name: transferName(task), status: message.status, at: Date.now() });
          // Session-only, bounded outbox: never replay task history after launch.
          if (notices.length > 100) notices.shift();
        }
        changed();
      });
      await new Promise<void>((resolve, reject) => {
        child.send({ taskId, urls, options, queue, retry: !!retry } satisfies WorkerConfig, (error) =>
          error ? reject(error) : resolve()
        );
      });
      changed();
      return task;
    } catch (error) {
      child.kill();
      await closed;
      throw error;
    }
  }

  async function dispatch(method: string, params: Record<string, unknown>) {
    switch (method) {
      case "hello":
        return { protocolVersion: PROTOCOL_VERSION, runtime: process.version };
      case "search": {
        const terms = strings(params.terms, "terms", true);
        if (params.root != null && typeof params.root !== "string") throw new Error("Search root must be a URL");
        const { results, totalResults } = await searchContent(terms, {
          noCache: params.noCache === true,
          root: typeof params.root === "string" ? params.root : undefined,
        });
        return { results, totalResults };
      }
      case "settings.get":
        return loadDesktopSettings(
          params.defaultOutput === undefined ? undefined : resolveDesktopOutput(params.defaultOutput)
        );
      case "library.list":
        return listLibraryDirectory(string(params.url, "url"), params.refresh === true);
      case "library.preview":
        return previewLibraryFile(string(params.url, "url"), params.refresh === true);
      case "library.preview.cached":
        return cachedLibraryPreview(string(params.url, "url"));
      case "library.preview.status":
        return libraryPreviewStatus(string(params.url, "url"));
      case "library.local":
        return downloadedLibraryFile(string(params.url, "url"));
      case "library.resource": {
        const url = canonicalTreeUrl(libraryUrl(string(params.url, "url")).href);
        const folder = url.endsWith("/");
        if (!folder && !previewKind(url)) throw new Error("Preview is not available for this file type");
        const segment = new URL(url).pathname.replace(/\/$/, "").split("/").at(-1);
        return { url, name: segment ? decodeURIComponent(segment) : "Visuales", kind: folder ? "folder" : "preview" };
      }
      case "settings.save":
        return saveDesktopSettings(
          params.settings,
          params.defaultOutput === undefined ? undefined : resolveDesktopOutput(params.defaultOutput)
        );
      // Not in the read-only allowlist: updater snapshots wait behind pending starts/resumes.
      case "tasks.prepareUpdate":
      case "tasks.list":
        return listDownloadTasks();
      case "tasks.snapshot": {
        const tasks = await listDownloadTasks();
        return { tasks, summary: summarizeTransfers(tasks) };
      }
      case "tasks.files": {
        const task = await findDownloadTask(string(params.id, "id"));
        if (!task) throw new Error("Download task not found");
        return readDownloadFileDetails(task.id);
      }
      case "notifications.take": {
        // Read before draining: failed settings reads must not bypass disabled preferences.
        const { settings } = await loadDesktopSettings();
        return notices.splice(0).filter((notice) => {
          const age = Date.now() - notice.at;
          return (
            age >= 0 &&
            age <= 30000 &&
            (notice.status === "completed" ? settings.notifyCompleted : settings.notifyFailed)
          );
        });
      }
      case "tasks.prepareQuit": {
        const tasks = await listDownloadTasks();
        const summary = { running: 0, queued: 0, ownedRunning: 0, ownedQueued: 0 };
        for (const task of tasks) {
          if (task.status !== "running" && task.status !== "queued") continue;
          summary[task.status]++;
          const worker = workers.get(task.id)?.child;
          if (worker && worker.pid === task.pid && worker.exitCode === null && worker.signalCode === null) {
            summary[task.status === "running" ? "ownedRunning" : "ownedQueued"]++;
          }
        }
        return summary;
      }
      case "download.review":
      case "download.start": {
        if (method === "download.start" && params.reviewId != null) {
          const id = string(params.reviewId, "reviewId");
          const reviewed = reviews.get(id);
          if (!reviewed || reviewed.expires < Date.now())
            throw new Error("This review expired. Review the download again.");
          const task = await start(reviewed.urls, reviewed.options, params.queue === true);
          reviews.delete(id);
          return task;
        }
        const urls = strings(params.urls, "urls");
        for (const url of urls) {
          if (!["http:", "https:"].includes(new URL(url).protocol))
            throw new Error("Only HTTP and HTTPS downloads are supported");
        }
        const { settings } = await loadDesktopSettings(
          params.defaultOutput === undefined ? undefined : resolveDesktopOutput(params.defaultOutput)
        );
        const destination = params.output == null ? settings.output : resolveDesktopOutput(params.output);
        // Desktop destinations are parent folders. Store the resolved single target
        // once so resume keeps both new and legacy tasks at their original paths.
        const output = urls.length === 1 ? createDownloadTargets(urls, destination)[0].output : destination;
        const options = {
          output,
          resume: downloadDefaults.resume,
          maxRetries: settings.maxRetries,
          timeout: downloadDefaults.timeout,
          concurrent: settings.concurrent,
          connections: settings.connections,
          compact: downloadDefaults.compact,
          exclude: settings.exclude,
        };
        if (method === "download.review") {
          const review = await reviewDownload(
            urls.length === 1 ? [{ url: urls[0], output, relativePath: "" }] : createDownloadTargets(urls, output),
            options
          );
          const reviewId = randomUUID();
          if (reviews.size >= 20) reviews.delete(reviews.keys().next().value!);
          reviews.set(reviewId, { urls, options, expires: Date.now() + 10 * 60 * 1000 });
          return { ...review, reviewId };
        }
        return start(urls, options, params.queue === true);
      }
      case "tasks.move": {
        const queue = await moveQueuedDownloadTask(string(params.id, "id"), params.position as QueueMove);
        changed();
        return queue;
      }
      case "tasks.retry":
      case "tasks.resume": {
        const task = await findDownloadTask(string(params.id, "id"));
        if (!task) throw new Error("Download task not found");
        if (task.status === "completed") throw new Error("Download is already complete");
        return start(
          task.urls ?? [task.url],
          {
            ...task.options,
            resume: true,
            timeout: task.options.timeout === "Infinity" ? Infinity : task.options.timeout,
          },
          params.queue === true,
          method === "tasks.retry"
            ? { paths: params.paths == null ? undefined : strings(params.paths, "paths") }
            : undefined
        );
      }
      case "tasks.cancelAll": {
        const result = await cancelAllDownloadTasks();
        const stopped = new Set(result.interrupted.map((task) => task.id));
        for (const [id, worker] of workers) {
          if (stopped.has(id)) worker.silence();
        }
        for (let index = notices.length - 1; index >= 0; index--) {
          if (stopped.has(notices[index].taskId)) notices.splice(index, 1);
        }
        await Promise.all([...workers].filter(([id]) => stopped.has(id)).map(([, worker]) => worker.closed));
        changed();
        return result;
      }
      case "tasks.cancel":
      case "tasks.delete": {
        const id = string(params.id, "id");
        const owned = workers.get(id);
        for (let index = notices.length - 1; index >= 0; index--) {
          if (notices[index].taskId === id) notices.splice(index, 1);
        }
        if (owned) {
          owned.silence();
          owned.child.kill();
          await owned.closed;
          if (method === "tasks.cancel") await interruptDownloadTask(id, "canceled");
        }
        const task = method === "tasks.delete" ? await deleteDownloadTask(id) : await cancelDownloadTask(id);
        if (!task) throw new Error("Download task not found");
        changed();
        return task;
      }
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }

  // Serialize state-changing requests; a slow search must not block cancellation.
  let mutations = Promise.resolve<unknown>(undefined);
  input.on("line", (line) => {
    let id: unknown = null;
    void (async () => {
      const request = JSON.parse(line);
      id = request.id;
      if (request.jsonrpc !== "2.0" || typeof id !== "string" || typeof request.method !== "string") {
        throw new Error("Invalid JSON-RPC request");
      }
      const params = request.params ?? {};
      if (typeof params !== "object" || params === null || Array.isArray(params)) throw new Error("Invalid params");
      if (shuttingDown) throw new Error("Sidecar is shutting down");
      const readOnly = [
        "hello",
        "search",
        "tasks.list",
        "tasks.snapshot",
        "tasks.files",
        "download.review",
        "library.list",
        "library.preview",
        "library.preview.cached",
        "library.preview.status",
        "library.local",
        "library.resource",
      ].includes(request.method);
      const result = readOnly
        ? dispatch(request.method, params)
        : mutations.then(() => dispatch(request.method, params));
      if (!readOnly) mutations = result.catch(() => {});
      send({ jsonrpc: "2.0", id, result: await result });
    })().catch((error) =>
      send({
        jsonrpc: "2.0",
        id,
        error: { code: -32000, message: error instanceof Error ? error.message : String(error) },
      })
    );
  });

  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    await mutations;
    const active = [...workers.values()];
    for (const { child } of active) child.kill();
    await Promise.all(active.map(({ closed }) => closed));
    process.exit(0);
  }
  input.once("close", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
}

function string(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a nonempty string`);
  return value;
}

function strings(value: unknown, name: string, allowEmpty = false): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0))
    throw new Error(`${name} must be ${allowEmpty ? "an array" : "a nonempty array"}`);
  return [...new Set(value.map((entry) => string(entry, name)))];
}
