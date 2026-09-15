import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { startTestServer, FILE_BODY } from "./helpers/test-server.mjs";

const home = await fs.mkdtemp(path.join(os.tmpdir(), "visuales-retry-review-"));
process.env.HOME = process.env.USERPROFILE = home;
const core = await import("../packages/core/dist/index.js");
const { recordDownloadFiles, reportDownloadFile, readDownloadFileDetails } =
  await import("../packages/core/dist/download/file-details.js");
const { downloadDefaults } = await import("../packages/core/dist/download/defaults.js");
const server = await startTestServer();
const options = (name) => ({
  ...downloadDefaults,
  output: path.join(home, name),
  maxRetries: 0,
  concurrent: 2,
  connections: 1,
  timeout: 5,
  compact: true,
  exclude: [],
});
after(async () => {
  await core.stopProgress();
  await server.close();
  await fs.rm(home, { recursive: true, force: true });
});

async function seed(name, files) {
  const opts = options(name);
  const task = await core.startDownloadTask(server.url("normal", `${name}/`), opts);
  await recordDownloadFiles(task.id, opts.output, async () => {
    for (const file of files)
      reportDownloadFile(file.url, path.join(opts.output, path.dirname(file.path)), path.basename(file.path), file);
  });
  await core.failDownloadTask(task.id, "Fixture failure");
  return task;
}

test("selective retries retain identity, history, paths and full aggregate progress without rediscovery", async () => {
  const completed = {
    url: server.url("normal", "done.bin"),
    path: "done.bin",
    status: "completed",
    downloadedBytes: 200,
    totalBytes: 200,
    verified: true,
  };
  const failed = (name) => ({
    url: server.url("normal", name),
    path: `nested/${name}`,
    status: "failed",
    downloadedBytes: 0,
    totalBytes: FILE_BODY.length,
    error: "Network unavailable",
  });
  const task = await seed("selective", [completed, failed("one.bin"), failed("two.bin")]);
  const claimed = await core.claimDownloadFileRetry(task.id, ["nested/one.bin"]);
  await assert.rejects(core.claimDownloadFileRetry(task.id), /stop/);
  const before = server.requests.length;
  await assert.rejects(core.runDownloadFileRetry(claimed), /1 file still needs attention/);
  assert.ok(server.requests.slice(before).every((request) => request.file === "one.bin"));
  assert.deepEqual(await fs.readFile(path.join(task.output, "nested/one.bin")), FILE_BODY);
  const details = await readDownloadFileDetails(task.id);
  assert.deepEqual(details.files[0], { ...completed, speedBytes: 0 });
  assert.equal(details.files[1].status, "completed");
  assert.equal(details.files[2].error, "Network unavailable");
  let current = await core.findDownloadTask(task.id);
  assert.equal(current.createdAt, task.createdAt);
  assert.equal(current.url, task.url);
  assert.equal(current.overallProgress.completedFiles, 2);
  assert.equal(current.overallProgress.downloadedBytes, FILE_BODY.length + 200);
  assert.equal(current.overallProgress.totalFiles, 3);
  assert.equal(current.status, "failed");
  await assert.rejects(core.claimDownloadFileRetry(task.id, ["done.bin"]), /Not a recorded failed/);
  await assert.rejects(core.claimDownloadFileRetry(task.id, ["missing.bin"]), /Not a recorded failed/);
  await core.runDownloadFileRetry(await core.claimDownloadFileRetry(task.id));
  current = await core.findDownloadTask(task.id);
  assert.equal(current.status, "completed");
  assert.equal(current.overallProgress.downloadedBytes, FILE_BODY.length * 2 + 200);
  assert.equal(current.overallProgress.completedFiles, 3);
  assert.equal((await readDownloadFileDetails(task.id)).files.length, 3);
});

test("claims are atomic and retries reject unsafe recorded destinations", async () => {
  const file = {
    url: server.url("normal", "safe.bin"),
    path: "safe.bin",
    status: "failed",
    downloadedBytes: 0,
    totalBytes: FILE_BODY.length,
  };
  const task = await seed("ownership", [file]);
  const claims = await Promise.allSettled([core.claimDownloadFileRetry(task.id), core.claimDownloadFileRetry(task.id)]);
  assert.equal(claims.filter((result) => result.status === "fulfilled").length, 1);
  await core.failDownloadTask(task.id, "End fixture");
  for (const unsafe of ["../safe.bin", "different.bin", "nested/safe.bin"]) {
    const record = await seed(`unsafe-${unsafe.replaceAll("/", "-")}`, [{ ...file, path: unsafe }]);
    if (unsafe === "nested/safe.bin") {
      await fs.mkdir(record.output, { recursive: true });
      await fs.symlink(home, path.join(record.output, "nested"), "dir");
    }
    const before = server.requests.length;
    await assert.rejects(core.runDownloadFileRetry(await core.claimDownloadFileRetry(record.id)), /Unsafe|Symlink/);
    assert.equal(server.requests.length, before);
  }
});

test("retries resume partial data, keep failed attempts visible, and continue other selected files", async () => {
  const task = await seed("partial", [
    {
      url: server.url("normal", "partial.bin"),
      path: "partial.bin",
      status: "failed",
      downloadedBytes: FILE_BODY.length / 2,
      totalBytes: FILE_BODY.length,
    },
    {
      url: server.url("unavailable", "blocked.bin"),
      path: "blocked.bin",
      status: "failed",
      downloadedBytes: 0,
      totalBytes: FILE_BODY.length,
    },
  ]);
  await fs.mkdir(task.output, { recursive: true });
  await fs.writeFile(path.join(task.output, "partial.bin"), FILE_BODY.subarray(0, FILE_BODY.length / 2));
  const before = server.requests.length;
  await assert.rejects(core.runDownloadFileRetry(await core.claimDownloadFileRetry(task.id)), /still needs attention/);
  const details = await readDownloadFileDetails(task.id);
  assert.equal(details.files[0].status, "completed");
  assert.deepEqual(await fs.readFile(path.join(task.output, "partial.bin")), FILE_BODY);
  assert.ok(
    server.requests
      .slice(before)
      .some((request) => request.file === "partial.bin" && request.range?.startsWith(`bytes=${FILE_BODY.length / 2}-`))
  );
  assert.equal(details.files[1].status, "failed");
  assert.ok(details.files[1].error);
  const current = await core.findDownloadTask(task.id);
  assert.equal(current.status, "failed");
  assert.equal(current.overallProgress.completedFiles, 1);
  assert.equal(current.overallProgress.downloadedBytes, FILE_BODY.length);
});

test("CLI retries a named failed file on its existing task and lists recorded paths", async () => {
  const file = {
    url: server.url("normal", "cli.bin"),
    path: "cli.bin",
    status: "failed",
    downloadedBytes: 0,
    totalBytes: FILE_BODY.length,
  };
  const task = await seed("cli", [file]);
  const exec = promisify(execFile);
  await exec(process.execPath, ["dist/cli.js", "tasks", "retry", task.id, "--file", file.path]);
  const { stdout } = await exec(process.execPath, ["dist/cli.js", "tasks", "files", task.id, "--json"]);
  assert.equal(JSON.parse(stdout).files[0].status, "completed");
  assert.equal((await core.findDownloadTask(task.id)).status, "completed");
});

test("reviews apply ordered ignore rules, skip ignored subtrees, retain estimates and never create tasks or outputs", async () => {
  const requests = [];
  const listingServer = http.createServer((req, res) => {
    requests.push(req.url);
    res.setHeader("content-type", "text/html");
    res.end(
      `<pre>${
        req.url === "/album/"
          ? '<a href="poster.jpg">poster.jpg</a> 01-Jan-2026 12:00 1K\n<a href="other.jpg">other.jpg</a> 01-Jan-2026 12:00 2048\n<a href="unknown.txt">unknown.txt</a> 01-Jan-2026 12:00 -\n<a href="skip/">skip/</a> 01-Jan-2026 12:00 -\n<a href="nested/">nested/</a> 01-Jan-2026 12:00 -\n'
          : '<a href="readme.txt">readme.txt</a> 01-Jan-2026 12:00 2048\n'
      }</pre>`
    );
  });
  await new Promise((resolve) => listingServer.listen(0, "127.0.0.1", resolve));
  try {
    const url = `http://127.0.0.1:${listingServer.address().port}/album/`;
    const opts = { ...options("review"), exclude: ["*.jpg", "!poster.jpg", "skip/"] };
    const tasks = await core.listDownloadTasks();
    const review = await core.reviewDownload([{ url, output: opts.output, relativePath: "" }], opts, async () => 100);
    assert.equal(review.includedFiles, 3);
    assert.equal(review.ignoredFiles, 1);
    assert.equal(review.ignoredDirectories, 1);
    assert.equal(review.unknownFiles, 1);
    assert.equal(review.estimated, true);
    assert.equal(review.knownBytes, 3072);
    assert.equal(review.spaceWarning, true);
    assert.ok(!requests.some((url) => url.includes("skip")));
    assert.deepEqual(await core.listDownloadTasks(), tasks);
    await assert.rejects(fs.stat(opts.output), { code: "ENOENT" });
    const unavailable = await core.reviewDownload(
      [{ url, output: opts.output, relativePath: "" }],
      opts,
      async () => null
    );
    assert.equal(unavailable.availableBytes, null);
    assert.equal(unavailable.spaceWarning, false);
    const scoped = await core.reviewDownload([{ url, output: opts.output, relativePath: "album" }], {
      ...opts,
      exclude: ["/album/nested/"],
    });
    assert.ok(scoped.entries.some((entry) => entry.path === "album/nested/" && entry.ignored));
    assert.ok((await core.availableDownloadSpace(path.join(home, "not/created/yet"))) > 0);
    const { stdout } = await promisify(execFile)(process.execPath, [
      "dist/cli.js",
      "download",
      url,
      "--output",
      opts.output,
      "--dry-run",
      "--json",
      "--ignore",
      "*.jpg",
      "--ignore",
      "!poster.jpg",
      "--ignore",
      "skip/",
    ]);
    const cli = JSON.parse(stdout);
    assert.equal(cli.includedFiles, review.includedFiles);
    assert.deepEqual(cli.entries, review.entries);
    await assert.rejects(fs.stat(opts.output), { code: "ENOENT" });
  } finally {
    await new Promise((resolve) => listingServer.close(resolve));
  }
});

test("reviewing an explicitly selected file bypasses ignore rules and only requests metadata", async () => {
  const opts = { ...options("explicit"), exclude: ["*.jpg"] };
  const before = server.requests.length;
  const review = await core.reviewDownload(
    [{ url: server.url("normal", "poster.jpg"), output: opts.output, relativePath: "" }],
    opts
  );
  assert.equal(review.includedFiles, 1);
  assert.equal(review.estimated, false);
  assert.equal(review.knownBytes, FILE_BODY.length);
  assert.ok(
    server.requests.slice(before).every((request) => request.method === "HEAD" || request.range === "bytes=0-0")
  );
  await assert.rejects(fs.stat(opts.output), { code: "ENOENT" });
});
