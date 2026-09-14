import { after, before, beforeEach, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
let home, tasks, tasksFile;
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
const enqueue = (name) => tasks.enqueueDownloadTask(`https://example.test/${name}`, options());
const queue = async () =>
  (await tasks.listDownloadTasks())
    .filter((task) => task.status === "queued")
    .sort((a, b) => tasks.compareQueueRank(tasks.queueRank(a), tasks.queueRank(b)));

before(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "visuales-queue-"));
  process.env.HOME = process.env.USERPROFILE = home;
  tasks = await import("../packages/core/dist/download/tasks.js");
  const { CONFIG } = await import("../packages/core/dist/lib/types.js");
  tasksFile = path.join(CONFIG.DOWNLOAD_CACHE_DIR, "tasks.json");
});
beforeEach(async () => tasks.clearDownloadTasks());
after(async () => fs.rm(home, { recursive: true, force: true }));

it("persists moves without changing enqueue timestamps, preserves registration and appends new work", async () => {
  const a = await enqueue("a"),
    b = await enqueue("b"),
    c = await enqueue("c");
  assert.deepEqual(
    (await queue()).map((t) => t.id),
    [a.id, b.id, c.id]
  );
  await tasks.moveQueuedDownloadTask(c.id, "next");
  await enqueue("c");
  const d = await enqueue("d");
  assert.deepEqual(
    (await queue()).map((t) => t.id),
    [c.id, a.id, b.id, d.id]
  );
  assert.equal((await tasks.findDownloadTask(c.id)).queuedAt, c.queuedAt);
  await tasks.moveQueuedDownloadTask(c.id, "down");
  await tasks.moveQueuedDownloadTask(d.id, 2);
  assert.deepEqual(
    (await queue()).map((t) => t.id),
    [a.id, d.id, c.id, b.id]
  );
  await tasks.moveQueuedDownloadTask(c.id, "up");
  await tasks.interruptDownloadTask(c.id);
  await enqueue("c");
  assert.deepEqual(
    (await queue()).map((t) => t.id),
    [a.id, d.id, b.id, c.id]
  );
});

it("rejects invalid mutations and keeps active downloads untouched", async () => {
  const running = await tasks.startDownloadTask("https://example.test/running", options());
  const a = await enqueue("a"),
    b = await enqueue("b");
  for (const position of [0, -1, 3, 1.5, "bogus", null])
    await assert.rejects(tasks.moveQueuedDownloadTask(a.id, position));
  await assert.rejects(tasks.moveQueuedDownloadTask("missing", "next"));
  await assert.rejects(tasks.moveQueuedDownloadTask(running.id, "next"));
  await tasks.moveQueuedDownloadTask(b.id, "next");
  assert.equal(await tasks.claimQueuedDownloadTask(b.id), "waiting");
  assert.equal((await tasks.findDownloadTask(running.id)).status, "running");
  await tasks.moveQueuedDownloadTask(b.id, "up");
  assert.deepEqual(
    (await queue()).map((t) => t.id),
    [b.id, a.id]
  );
});

it("claims under the same lock as reordering and only lets one waiter start", async () => {
  const a = await enqueue("a"),
    b = await enqueue("b");
  assert.equal(await tasks.claimQueuedDownloadTask(a.id, process.pid + 1), "canceled");
  const results = await Promise.all([
    tasks.claimQueuedDownloadTask(a.id),
    tasks.moveQueuedDownloadTask(b.id, "next"),
    tasks.claimQueuedDownloadTask(b.id),
  ]);
  assert.ok(results.filter((result) => result === "acquired").length <= 1);
  if (!results.includes("acquired")) {
    // A move can happen after the old head's check and before the new head's next poll.
    assert.equal(await tasks.claimQueuedDownloadTask((await queue())[0].id), "acquired");
  }
  assert.equal((await tasks.listDownloadTasks()).filter((task) => task.status === "running").length, 1);
  const running = (await tasks.listDownloadTasks()).find((t) => t.status === "running");
  await tasks.completeDownloadTask(running.id);
  const next = (await queue())[0];
  assert.equal(await tasks.waitForQueueSlot(next.id), true);
  assert.equal((await tasks.findDownloadTask(next.id)).status, "running");
  assert.equal(await tasks.claimQueuedDownloadTask(next.id), "canceled");
});

it("does not grant the same queue slot twice and ignores a canceled waiter", async () => {
  const a = await enqueue("a");
  const results = await Promise.all([tasks.claimQueuedDownloadTask(a.id), tasks.claimQueuedDownloadTask(a.id)]);
  assert.deepEqual(results.sort(), ["acquired", "canceled"]);
  await tasks.completeDownloadTask(a.id);
  const b = await enqueue("b");
  await tasks.interruptDownloadTask(b.id);
  assert.equal(await tasks.claimQueuedDownloadTask(b.id), "canceled");
  await assert.rejects(tasks.moveQueuedDownloadTask(b.id, 1), /Only queued/);
});

it("retains legacy FIFO order when records have no queueOrder", async () => {
  const a = await enqueue("a"),
    b = await enqueue("b");
  const store = JSON.parse(await fs.readFile(tasksFile, "utf8"));
  for (const task of store.tasks) delete task.queueOrder;
  store.tasks.find((t) => t.id === a.id).queuedAt = 100;
  store.tasks.find((t) => t.id === b.id).queuedAt = 200;
  await fs.writeFile(tasksFile, JSON.stringify(store));
  assert.deepEqual(
    (await queue()).map((t) => t.id),
    [a.id, b.id]
  );
  await tasks.moveQueuedDownloadTask(b.id, 1);
  const c = await enqueue("c");
  assert.deepEqual(
    (await queue()).map((t) => t.id),
    [b.id, a.id, c.id]
  );
});

it("CLI queue, move and next read and change the same persisted order", async () => {
  const a = await enqueue("a"),
    b = await enqueue("b");
  const cli = (...args) => exec(process.execPath, ["dist/cli.js", "tasks", ...args]);
  await cli("next", b.id);
  assert.deepEqual(
    (await queue()).map((t) => t.id),
    [b.id, a.id]
  );
  const { stdout } = await cli("queue");
  assert.ok(stdout.indexOf(b.id) < stdout.indexOf(a.id));
  assert.match(stdout, /1\s+.*b/);
  await cli("move", b.id, "2");
  assert.deepEqual(
    (await queue()).map((t) => t.id),
    [a.id, b.id]
  );
  await assert.rejects(cli("move", b.id, "0"));
  await assert.rejects(cli("next", "missing"));
});
