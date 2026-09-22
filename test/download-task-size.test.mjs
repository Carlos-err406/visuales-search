import assert from "node:assert/strict";
import { beforeEach, afterEach, test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { publishIndexedDirectory, clearFileIndex } from "../packages/core/dist/search-file-index.js";
import { withCachedTaskSizes } from "../packages/core/dist/download/task-size.js";

const base = "https://visuales.uclv.cu/Series/Test/";
let home;
const originalHome = process.env.HOME;
const originalProfile = process.env.USERPROFILE;
beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "visuales-task-size-"));
  process.env.HOME = process.env.USERPROFILE = home;
});
afterEach(async () => {
  process.env.HOME = originalHome;
  if (originalProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalProfile;
  await fs.rm(home, { recursive: true, force: true });
});
const task = (extra = {}) => ({
  id: "fixture",
  url: base,
  output: path.join(home, "output"),
  options: { exclude: ["*.jpg", "!poster.jpg"] },
  status: "interrupted",
  createdAt: 1,
  updatedAt: 2,
  interruptedAt: 2,
  interruptedCause: "canceled",
  ...extra,
});
const listing = (url, files, dirs = [], at) =>
  publishIndexedDirectory(
    url,
    {
      files: files.map(([name, size]) => ({ url: `${url}${name}`, size })),
      dirs: dirs.map((name) => `${url}${name}/`),
    },
    at
  );

test("interrupted totals come from complete cached branches with the original ignore rules", async () => {
  await listing(
    base,
    [
      ["poster.jpg", 100],
      ["thumb.jpg", 50],
    ],
    ["Season%201"]
  );
  await listing(`${base}Season%201/`, [
    ["episode.mp4", 2000],
    ["sub.srt", 20],
  ]);
  const original = task();
  const before = structuredClone(original);
  for (let i = 0; i < 2; i++) {
    const [result] = await withCachedTaskSizes([original]);
    assert.deepEqual(result.sizeEstimate, { totalBytes: 2120, totalFiles: 3 });
    assert.equal(result.status, "interrupted");
    assert.equal(result.overallProgress, undefined, "cached metadata must never become transfer progress");
    assert.equal(result.updatedAt, 2);
  }
  assert.deepEqual(original, before);
  await assert.rejects(fs.stat(original.output), { code: "ENOENT" });
  await assert.rejects(fs.stat(path.join(home, ".visuales-cli-cache/download/tasks.json")), { code: "ENOENT" });
});

test("missing branches and unknown sizes never produce misleading full totals", async () => {
  await listing(base, [["episode.mp4", 2000]], ["Missing"]);
  assert.equal((await withCachedTaskSizes([task()]))[0].sizeEstimate, undefined);
  await listing(`${base}Missing/`, [["unknown.mp4", 0]]);
  assert.equal((await withCachedTaskSizes([task()]))[0].sizeEstimate, undefined);
  const excluded = task({ options: { exclude: ["Missing/"] } });
  assert.deepEqual((await withCachedTaskSizes([excluded]))[0].sizeEstimate, { totalBytes: 2000, totalFiles: 1 });
  await listing(`${base}Missing/`, [["unknown.mp4", 3000]], [], Date.now() + 10);
  assert.deepEqual((await withCachedTaskSizes([task()]))[0].sizeEstimate, { totalBytes: 5000, totalFiles: 2 });
});

test("authoritative progress wins and only inactive or queued unknown totals are enriched", async () => {
  await listing(base, [["episode.mp4", 2000]]);
  const progress = { totalBytes: 3000, downloadedBytes: 1000, updatedAt: 2 };
  const known = task({ overallProgress: progress });
  const running = task({ status: "running" });
  const completed = task({ status: "completed" });
  const [a, b, c, d, e] = await withCachedTaskSizes([
    known,
    running,
    completed,
    task({ status: "queued" }),
    task({ status: "failed" }),
  ]);
  assert.equal(a, known);
  assert.equal(b, running);
  assert.equal(c, completed);
  assert.equal(d.sizeEstimate.totalBytes, 2000);
  assert.equal(e.sizeEstimate.totalBytes, 2000);
  assert.deepEqual(known.overallProgress, progress);
});

test("batch relative paths, duplicate targets and explicit file exceptions match the downloader", async () => {
  const other = "https://visuales.uclv.cu/Series/Other/";
  await listing(base, [
    ["episode.mp4", 2000],
    ["poster.jpg", 100],
  ]);
  await listing(other, [
    ["episode.mp4", 3000],
    ["poster.jpg", 50],
  ]);
  const input = task({
    urls: [base, base, other, `${base}poster.jpg`],
    options: { exclude: ["/Test/episode.mp4", "*.jpg"] },
  });
  const [result] = await withCachedTaskSizes([input]);
  assert.deepEqual(result.sizeEstimate, { totalBytes: 3100, totalFiles: 2 });
  const [single] = await withCachedTaskSizes([task({ options: { exclude: ["/episode.mp4", "*.jpg"] } })]);
  assert.deepEqual(single.sizeEstimate, { totalBytes: 0, totalFiles: 0 });
});

test("unsupported sources stay unknown without hiding healthy tasks, and cache clearing invalidates totals", async () => {
  await listing(base, [["episode.mp4", 2000]]);
  const [unknown, known] = await withCachedTaskSizes([task({ url: "https://example.test/" }), task()]);
  assert.equal(unknown.sizeEstimate, undefined);
  assert.equal(known.sizeEstimate.totalBytes, 2000);
  await clearFileIndex();
  assert.equal((await withCachedTaskSizes([task()]))[0].sizeEstimate, undefined);
});
