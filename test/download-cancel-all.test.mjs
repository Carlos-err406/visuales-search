import { after, before, beforeEach, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let home, tasks;
const options = () => ({
  output: home,
  resume: true,
  maxRetries: 3,
  timeout: Infinity,
  concurrent: 5,
  connections: 3,
  compact: false,
  exclude: [],
});
const progress = {
  fileName: "file.bin",
  progress: 40,
  downloadedSize: 400,
  totalSize: 1000,
  speed: "1 MB/s",
  overall: {
    completedFiles: 1,
    totalFiles: 2,
    downloadedBytes: 400,
    totalBytes: 1000,
    speedBytes: 100,
    activeFiles: [],
  },
};
const pids = [900001, 900002, 900003];
function mockWorkers(t, onSignal = () => {}) {
  const kill = process.kill;
  t.mock.method(process, "kill", (pid, signal) => {
    if (!pids.includes(pid)) return kill.call(process, pid, signal);
    if (signal !== 0) onSignal(pid, signal);
    return true;
  });
}
before(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "visuales-cancel-all-"));
  process.env.HOME = process.env.USERPROFILE = home;
  tasks = await import("../packages/core/dist/download/tasks.js");
});
beforeEach(async () => tasks.clearDownloadTasks());
after(async () => fs.rm(home, { recursive: true, force: true }));

it("interrupts the whole active snapshot without granting a queued slot or changing history", async (t) => {
  let claim;
  const signals = [];
  mockWorkers(t, (pid, signal) => {
    signals.push([pid, signal]);
    claim ??= tasks.claimQueuedDownloadTask(queued.id, pids[1]);
  });
  const running = await tasks.startDownloadTaskWithPid("https://example.test/running", options(), pids[0]);
  await tasks.updateDownloadTaskProgress(running.id, progress, true);
  const queued = await tasks.enqueueDownloadTask("https://example.test/queued", options(), pids[1]);
  const history = await tasks.startDownloadTaskWithPid("https://example.test/done", options(), pids[2]);
  await tasks.completeDownloadTask(history.id);
  const completed = await tasks.findDownloadTask(history.id);
  const result = await tasks.cancelAllDownloadTasks();
  assert.equal(await claim, "canceled", "queue claim cannot slip between interrupts");
  assert.deepEqual(new Set(result.interrupted.map((task) => task.id)), new Set([running.id, queued.id]));
  assert.deepEqual(result.failures, []);
  assert.deepEqual(signals.map(([pid]) => pid).sort(), [pids[0], pids[1]]);
  assert.ok(signals.every(([, signal]) => signal === "SIGTERM"));
  const stopped = await tasks.findDownloadTask(running.id);
  assert.equal(stopped.overallProgress.downloadedBytes, 400);
  assert.equal(stopped.overallProgress.speedBytes, 0);
  assert.equal(stopped.pid, undefined);
  assert.equal(stopped.interruptedCause, "canceled");
  assert.deepEqual(await tasks.findDownloadTask(history.id), completed);
  assert.deepEqual(await tasks.cancelAllDownloadTasks(), { interrupted: [], failures: [] });
});

it("late progress, completion, failure and signal callbacks cannot undo cancellation; explicit resume can", async (t) => {
  mockWorkers(t);
  const task = await tasks.startDownloadTaskWithPid("https://example.test/late", options(), pids[0]);
  await tasks.updateDownloadTaskProgress(task.id, progress, true);
  await tasks.cancelAllDownloadTasks();
  const canceled = await tasks.findDownloadTask(task.id);
  await tasks.updateDownloadTaskProgress(task.id, { ...progress, checkpoint: true, downloadedSize: 800 }, true);
  await tasks.completeDownloadTask(task.id);
  await tasks.failDownloadTask(task.id, new Error("late failure"));
  await tasks.interruptDownloadTask(task.id, "signal");
  assert.deepEqual(await tasks.findDownloadTask(task.id), canceled);
  await tasks.startDownloadTaskWithPid(task.url, options(), pids[0]);
  await tasks.updateDownloadTaskProgress(task.id, progress, true);
  assert.equal((await tasks.findDownloadTask(task.id)).status, "running");
});

it("continues after signal errors and revokes queued slots even when their signal fails", async (t) => {
  mockWorkers(t, (pid) => {
    if (pid !== pids[2]) throw Object.assign(new Error("Permission denied"), { code: "EPERM" });
  });
  const running = await tasks.startDownloadTaskWithPid("https://example.test/denied", options(), pids[0]);
  const queued = await tasks.enqueueDownloadTask("https://example.test/denied-queued", options(), pids[1]);
  const other = await tasks.startDownloadTaskWithPid("https://example.test/other", options(), pids[2]);
  const result = await tasks.cancelAllDownloadTasks();
  assert.deepEqual(new Set(result.failures.map((failure) => failure.id)), new Set([running.id, queued.id]));
  assert.equal((await tasks.findDownloadTask(running.id)).status, "running");
  assert.equal((await tasks.findDownloadTask(other.id)).status, "interrupted");
  assert.equal(await tasks.claimQueuedDownloadTask(queued.id, pids[1]), "canceled");
});

it("never signals the caller itself", async () => {
  const task = await tasks.startDownloadTask("https://example.test/self", options());
  const result = await tasks.cancelAllDownloadTasks();
  assert.equal(result.interrupted.length, 0);
  assert.equal(result.failures[0].id, task.id);
  assert.match(result.failures[0].message, /process handling this request/);
});
