import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Point the CLI's cache (CONFIG uses os.homedir(), which honors $HOME on POSIX) at a throwaway
// directory BEFORE importing the task store, so these tests never touch the real ~/.visuales-cli-cache.
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

// Register a task with a dead pid and mark it completed, so deleteDownloadTask never signals a real process.
async function seedTask(url) {
  const record = await tasks.startDownloadTaskWithPid(url, options(), 2147483646);
  await tasks.completeDownloadTask(record.id);
  return record.id;
}

before(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "visuales-delete-"));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  const { CONFIG } = await import("../dist/lib/types.js");
  assert.ok(CONFIG.DOWNLOAD_CACHE_DIR.startsWith(home), "tests must run against an isolated HOME");
  tasks = await import("../dist/commands/download/tasks.js");
});

after(async () => {
  await fs.rm(home, { recursive: true, force: true });
});

describe("deleteDownloadTask", () => {
  it("removes a task by id and reports the removed record", async () => {
    const id = await seedTask("http://example/one.bin");

    const removed = await tasks.deleteDownloadTask(id);

    assert.equal(removed?.id, id);
    assert.equal(await tasks.findDownloadTask(id), null);
  });

  it("returns null for an unknown task", async () => {
    assert.equal(await tasks.deleteDownloadTask("does-not-exist"), null);
  });

  it("deletes only the requested task, leaving the rest intact", async () => {
    const keep = await seedTask("http://example/keep.bin");
    const drop = await seedTask("http://example/drop.bin");

    await tasks.deleteDownloadTask(drop);

    assert.equal(await tasks.findDownloadTask(drop), null);
    assert.ok(await tasks.findDownloadTask(keep), "unrelated task should survive");
  });

  it("matches by URL as well as id", async () => {
    const url = "http://example/by-url.bin";
    await seedTask(url);

    const removed = await tasks.deleteDownloadTask(url);

    assert.ok(removed, "expected the task to be found by its URL");
    assert.equal(await tasks.findDownloadTask(url), null);
  });

  it("removes the task log file", async () => {
    const id = await seedTask("http://example/with-log.bin");
    const logPath = tasks.getDownloadTaskLogPath(id);
    await fs.writeFile(logPath, "detached download output\n");

    await tasks.deleteDownloadTask(id);

    assert.equal(
      await fs
        .stat(logPath)
        .then(() => true)
        .catch(() => false),
      false,
      "the task log should be gone"
    );
  });
});
