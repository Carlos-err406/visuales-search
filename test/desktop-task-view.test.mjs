import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundled = await build({
  entryPoints: ["apps/desktop/src/task-view.ts"],
  bundle: true,
  write: false,
  format: "esm",
});
const code = bundled.outputFiles[0].text;
const view = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);

test("desktop names decode folder URLs and distinguish batches", () => {
  const url = "https://visuales.uclv.cu/Documentales/Planet%20Earth/";
  assert.equal(view.taskName({ url }), "Planet Earth");
  assert.equal(view.taskName({ url, urls: [url, `${url}2`, `${url}3`] }), "Planet Earth + 2 more");
  assert.equal(view.taskName({ url: "invalid source" }), "invalid source");
  assert.equal(view.taskName({ url: "https://visuales.uclv.cu/" }), "visuales.uclv.cu");
});

test("desktop progress distinguishes unknown size, queued work and verified completion", () => {
  assert.equal(
    view.taskProgress({
      status: "running",
      overallProgress: { downloadedBytes: 90, totalBytes: 1000, completedFiles: 6, totalFiles: 7 },
    }),
    9
  );
  assert.equal(view.taskProgress({ status: "running" }), null);
  assert.equal(view.taskProgress({ status: "queued" }), 0);
  assert.equal(view.taskProgress({ status: "completed" }), 100);
  assert.equal(view.taskProgress({ status: "running", overallProgress: { downloadedBytes: 25, totalBytes: 100 } }), 25);
  assert.equal(
    view.taskProgress({ status: "running", overallProgress: { downloadedBytes: 100, totalBytes: 100 } }),
    99.9
  );
  assert.equal(view.taskProgress({ status: "running", overallProgress: { completedFiles: 1, totalFiles: 4 } }), 25);
  assert.equal(view.taskProgress({ status: "interrupted", lastProgress: { totalSize: 100, progress: 40 } }), 40);
});

test("only running and queued tasks belong in desktop activity", () => {
  for (const status of ["running", "queued"]) assert.equal(view.isActive({ status }), true);
  for (const status of ["completed", "failed", "interrupted"]) assert.equal(view.isActive({ status }), false);
});

test("desktop hides stale and inactive transfer speeds", () => {
  const now = Date.now();
  const task = { status: "running", overallProgress: { speedBytes: 2048, updatedAt: now } };
  assert.equal(view.taskSpeedBytes(task, now), 2048);
  assert.equal(view.taskSpeedBytes(task, now + 10001), null);
  assert.equal(view.taskSpeedBytes({ ...task, status: "completed" }, now), null);
  assert.equal(view.taskSpeed(task), "2.0 KB/s");
  assert.equal(view.taskSpeed({ status: "running", lastProgress: { updatedAt: now, speed: "1 MB/s" } }), "1 MB/s");
  assert.equal(view.taskSpeed({ status: "failed", lastProgress: { updatedAt: now, speed: "1 MB/s" } }), "--");
});

test("desktop byte labels handle unknown, fractional and non-finite values", () => {
  assert.equal(view.formatBytes(1024), "1.0 KB");
  assert.equal(view.formatBytes(0.5), "1 B");
  assert.equal(view.formatBytes(-1), "0 B");
  assert.equal(view.formatBytes(Infinity), "0 B");
  assert.equal(view.taskSize({}), "--");
  assert.equal(view.taskSize({ overallProgress: { downloadedBytes: 512, totalBytes: 1024 } }), "512 B / 1.0 KB");
  assert.equal(view.taskSize({ lastProgress: { downloadedSize: 512 } }), "512 B");
});
