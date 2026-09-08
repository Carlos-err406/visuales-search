import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import os from "node:os";
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
  deleteDownloadTask,
  updateDownloadTaskProgress,
  waitForQueueSlot,
  setLogger,
  type DownloadOptions,
  type DownloadProgress,
} from "@visuales/core";
import { createDownloadTargets } from "@visuales/core/download/targets";

const PROTOCOL_VERSION = 1;
setLogger({ log: (...values) => console.error(...values), error: (...values) => console.error(...values) });

type WorkerConfig = { taskId: string; urls: string[]; options: DownloadOptions; queue: boolean };
type WorkerMessage = { type: "ready" } | { type: "changed"; taskId: string };

async function runWorker(config: WorkerConfig) {
  const { taskId, urls, queue } = config;
  // JSON transports Infinity as null; task records use the explicit string "Infinity".
  const options = { ...config.options, timeout: config.options.timeout ?? Infinity };
  let progressWrites = Promise.resolve();
  const onProgress = (progress: DownloadProgress) => {
    progressWrites = progressWrites.then(() => updateDownloadTaskProgress(taskId, progress));
    // Avoid an unhandled rejection while the transfer is still producing progress.
    void progressWrites.catch(() => {});
  };
  try {
    if (queue) {
      if (!(await waitForQueueSlot(taskId))) return;
      await startDownloadTaskWithPid(urls, options, process.pid);
    }
    if (urls.length === 1) await downloadUrl(urls[0], options, onProgress);
    else await downloadUrls(createDownloadTargets(urls, options.output), options, onProgress);
    await progressWrites;
    await completeDownloadTask(taskId);
  } catch (error) {
    await progressWrites.catch(() => {});
    await failDownloadTask(taskId, error);
  }
  process.send?.({ type: "changed", taskId });
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
  const workers = new Map<string, { child: ChildProcess; closed: Promise<void> }>();
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  let shuttingDown = false;
  const send = (value: unknown) => {
    if (!process.stdout.destroyed) process.stdout.write(`${JSON.stringify(value)}\n`);
  };
  const changed = () => send({ jsonrpc: "2.0", method: "tasks.changed", params: {} });

  async function start(urls: string[], options: DownloadOptions, queue = false) {
    const taskId = createDownloadTaskId(urls, options.output);
    const existing = await findDownloadTask(taskId);
    if (existing?.status === "running" || existing?.status === "queued") return existing;
    if (workers.has(taskId)) throw new Error("This task is still stopping. Try again shortly.");
    const child = spawn(process.execPath, [process.argv[1], "--worker", "download", ...urls], {
      stdio: ["ignore", "ignore", "pipe", "ipc"],
      windowsHide: true,
    });
    child.stderr?.pipe(process.stderr, { end: false });
    let taskRegistered = false;
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
    workers.set(taskId, { child, closed });
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
      const task = await startDownloadTaskWithPid(urls, options, child.pid!, undefined, queue ? "queued" : "running");
      taskRegistered = true;
      child.on("message", changed);
      await new Promise<void>((resolve, reject) => {
        child.send({ taskId, urls, options, queue } satisfies WorkerConfig, (error) =>
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
        const terms = strings(params.terms, "terms");
        const { results, totalResults } = await searchContent(terms, { noCache: params.noCache === true });
        return { results, totalResults };
      }
      // Not in the read-only allowlist: updater snapshots wait behind pending starts/resumes.
      case "tasks.prepareUpdate":
      case "tasks.list":
        return listDownloadTasks();
      case "download.start": {
        const urls = strings(params.urls, "urls");
        for (const url of urls) {
          if (!["http:", "https:"].includes(new URL(url).protocol))
            throw new Error("Only HTTP and HTTPS downloads are supported");
        }
        const destination = outputPath(params.output);
        // Desktop destinations are parent folders. Store the resolved single target
        // once so resume keeps both new and legacy tasks at their original paths.
        const output = urls.length === 1 ? createDownloadTargets(urls, destination)[0].output : destination;
        return start(
          urls,
          {
            output,
            resume: true,
            maxRetries: 3,
            timeout: Infinity,
            concurrent: 5,
            connections: 3,
            compact: false,
            exclude: [],
          },
          params.queue === true
        );
      }
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
          params.queue === true
        );
      }
      case "tasks.cancel":
      case "tasks.delete": {
        const id = string(params.id, "id");
        const owned = workers.get(id);
        if (owned) {
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
      const readOnly = ["hello", "search", "tasks.list"].includes(request.method);
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

function strings(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${name} must be a nonempty array`);
  return [...new Set(value.map((entry) => string(entry, name)))];
}

function outputPath(value: unknown): string {
  const output = string(value, "output");
  if (output === "~") return os.homedir();
  if (output.startsWith("~/") || output.startsWith("~\\")) return path.join(os.homedir(), output.slice(2));
  if (!path.isAbsolute(output)) throw new Error("Output folder must be an absolute path");
  return path.normalize(output);
}
