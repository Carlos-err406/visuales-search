import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pLimit from "p-limit";
import { setTimeout as sleep } from "node:timers/promises";
import { controlledDownloadServer, waitUntil } from "./helpers/controlled-download-server.mjs";

const home = await fs.mkdtemp(path.join(os.tmpdir(), "visuales-concurrency-"));
process.env.HOME = process.env.USERPROFILE = home;
const core = await import("../packages/core/dist/index.js");
const { downloadDefaults } = await import("../packages/core/dist/download/defaults.js");
const { recordDownloadFiles, reportDownloadFile } = await import("../packages/core/dist/download/file-details.js");
const options = (name) => ({
  ...downloadDefaults,
  output: path.join(home, name),
  concurrent: 5,
  connections: 1,
  maxRetries: 0,
  timeout: 30,
  exclude: [],
});
after(async () => {
  await core.stopProgress();
  await fs.rm(home, { recursive: true, force: true });
});

for (const mode of ["folder", "batch", "retry"]) {
  test(`live file concurrency preserves payloads and fills slots for ${mode} downloads`, async () => {
    const names = Array.from({ length: 9 }, (_, index) => `${index > 5 ? "nested/" : ""}file${index}.bin`);
    const server = await controlledDownloadServer(names);
    const opts = options(mode);
    const limit = pLimit(opts.concurrent);
    let run;
    try {
      if (mode === "retry") {
        const task = await core.startDownloadTask(server.url, opts);
        await recordDownloadFiles(task.id, opts.output, async () => {
          for (const name of names)
            reportDownloadFile(server.url + name, path.join(opts.output, path.dirname(name)), path.basename(name), {
              status: "failed",
              downloadedBytes: 0,
              totalBytes: server.body.length,
              error: "Fixture failure",
            });
        });
        await core.failDownloadTask(task.id, "Fixture failure");
        run = core.runDownloadFileRetry(await core.claimDownloadFileRetry(task.id), limit);
      } else if (mode === "batch") {
        run = core.downloadUrls(
          names.map((name) => ({
            url: server.url + name,
            output: path.join(opts.output, path.dirname(name)),
            relativePath: path.dirname(name),
          })),
          opts,
          undefined,
          limit
        );
      } else {
        run = core.downloadUrl(server.url, opts, undefined, limit);
      }
      void run.catch(() => {});
      await waitUntil(() => server.started.length === 5, "five payloads");
      limit.concurrency = 3;
      for (let index = 0; index < 2; index++) {
        server.finish(server.started[index]);
        await waitUntil(() => limit.activeCount === 4 - index, "active file drains");
        await sleep(100);
        assert.equal(server.started.length, 5, "decreasing does not fill the first two released slots");
      }
      server.finish(server.started[2]);
      await waitUntil(() => server.started.length === 6, "replacement below new limit");
      assert.equal(limit.activeCount, 3);
      limit.concurrency = 5;
      await waitUntil(() => server.started.length === 8, "increase fills two slots without a completion");
      assert.equal(limit.activeCount, 5);
      limit.concurrency = 1;
      limit.concurrency = 9;
      limit.concurrency = 2;
      await sleep(100);
      assert.equal(server.started.length, 8, "latest limit wins before queued starts run");
      limit.concurrency = 32;
      await waitUntil(() => server.started.length === 9, "last pending file");
      assert.equal(limit.activeCount, 6, "fewer pending files than the newly available slots");
      assert.deepEqual(server.aborted, [], "changing limits never aborts active payloads");
      server.releaseAll();
      await run;
      assert.equal(new Set(server.started).size, names.length, "no duplicate starts");
      assert.equal(server.started.length, names.length);
      for (const name of names) assert.deepEqual(await fs.readFile(path.join(opts.output, name)), server.body);
    } finally {
      server.releaseAll();
      await run?.catch(() => {});
      await server.close();
    }
  });
}

test("live task limits persist only for the current active owner without rewriting queue or progress", async () => {
  const opts = options("ownership");
  const task = await core.startDownloadTaskWithPid(
    "http://example.test/owned/",
    opts,
    process.pid,
    undefined,
    "queued"
  );
  const stored = await core.findDownloadTask(task.id);
  assert.equal(await core.updateDownloadTaskConcurrency(task.id, 3, process.pid + 1), false);
  assert.deepEqual(await core.findDownloadTask(task.id), stored);
  for (const value of [0, -1, 1.5, Infinity, NaN, "3"])
    await assert.rejects(core.updateDownloadTaskConcurrency(task.id, value, process.pid), /positive whole number/);
  assert.equal(await core.updateDownloadTaskConcurrency(task.id, 3, process.pid), true);
  assert.deepEqual(await core.findDownloadTask(task.id), { ...stored, options: { ...stored.options, concurrent: 3 } });
  await core.interruptDownloadTask(task.id, "canceled");
  assert.equal(await core.updateDownloadTaskConcurrency(task.id, 9, process.pid), false);
  const resumed = await core.startDownloadTask(task.url, { ...opts, concurrent: 3 });
  await core.completeDownloadTask(resumed.id);
  assert.equal(await core.updateDownloadTaskConcurrency(task.id, 9, process.pid), false);
  assert.equal((await core.findDownloadTask(task.id)).options.concurrent, 3);
  assert.equal(await core.updateDownloadTaskConcurrency("missing", 3, process.pid), false);
});
