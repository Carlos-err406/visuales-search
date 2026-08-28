import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let home;
let tasks;

function options() {
  return {
    output: home,
    resume: true,
    maxRetries: 3,
    timeout: Infinity,
    concurrent: 5,
    connections: 3,
    compact: false,
    exclude: [],
  };
}

function progress(fileName = "movie.mp4") {
  return {
    fileName,
    progress: 25,
    downloadedSize: 250,
    totalSize: 1000,
    speed: "1 MB/s",
    overall: {
      completedFiles: 1,
      totalFiles: 4,
      downloadedBytes: 250,
      totalBytes: 1000,
      speedBytes: 1_000_000,
      activeFiles: [
        {
          fileName,
          progress: 25,
          downloadedSize: 250,
          totalSize: 1000,
          speed: "1 MB/s",
        },
      ],
    },
  };
}

before(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "visuales-task-lifecycle-"));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  const { CONFIG } = await import("../dist/lib/types.js");
  assert.ok(CONFIG.DOWNLOAD_CACHE_DIR.startsWith(home), "tests must run against an isolated HOME");
  tasks = await import("../dist/commands/download/tasks.js");
});

after(async () => {
  await fs.rm(home, { recursive: true, force: true });
});

describe("download task lifecycle", () => {
  it("does not demote a running detached task when the parent writes the queued record late", async () => {
    const url = "http://example/race.mp4";
    const running = await tasks.startDownloadTaskWithPid(url, options(), process.pid);

    await tasks.startDownloadTaskWithPid(url, options(), process.pid, undefined, "queued");

    const stored = await tasks.findDownloadTask(running.id);
    assert.equal(stored.status, "running");
  });

  it("promotes a queued task to running when fresh progress is written", async () => {
    const queued = await tasks.startDownloadTaskWithPid(
      "http://example/progress-started.mp4",
      options(),
      process.pid,
      undefined,
      "queued"
    );

    await tasks.updateDownloadTaskProgress(queued.id, progress());

    const stored = await tasks.findDownloadTask(queued.id);
    assert.equal(stored.status, "running");
    assert.equal(stored.queuedAt, undefined);
    assert.ok(stored.startedAt, "progress should stamp a start time");
  });

  it("normalizes a live queued task with post-queue progress as running", async () => {
    const queued = await tasks.startDownloadTaskWithPid(
      "http://example/live-progress.mp4",
      options(),
      process.pid,
      undefined,
      "queued"
    );

    await tasks.updateDownloadTaskProgress(queued.id, progress("live-progress.mp4"));

    const stored = await tasks.findDownloadTask(queued.id);
    assert.equal(stored.status, "running");
  });

  it("leaves queued tasks with stale progress queued", async () => {
    const stale = await tasks.startDownloadTaskWithPid(
      "http://example/stale-progress.mp4",
      options(),
      process.pid,
      undefined,
      "queued"
    );

    await tasks.interruptDownloadTask(stale.id, "canceled");
    await tasks.updateDownloadTaskProgress(stale.id, progress("stale-progress.mp4"));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await tasks.startDownloadTaskWithPid(
      "http://example/stale-progress.mp4",
      options(),
      process.pid,
      undefined,
      "queued"
    );

    const stored = await tasks.findDownloadTask(stale.id);
    assert.equal(stored.status, "queued");
  });
});
