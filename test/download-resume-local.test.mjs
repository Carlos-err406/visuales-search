import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createHash } from "node:crypto";

const home = await fs.mkdtemp(path.join(os.tmpdir(), "visuales-local-resume-"));
process.env.HOME = home;
process.env.USERPROFILE = home;
const { downloadUrl, downloadUrls, stopProgress } = await import("../packages/core/dist/download/downloader.js");
const { recordDownloadFiles, reportDownloadFile, readDownloadFileDetails, recordedFileCompletion } =
  await import("../packages/core/dist/download/file-details.js");
const { parallelBytesOnDisk } = await import("../packages/core/dist/download/parallel-download.js");
after(async () => {
  await stopProgress();
  await fs.rm(home, { recursive: true, force: true });
});

const options = (output) => ({
  output,
  concurrent: 1,
  connections: 1,
  resume: true,
  maxRetries: 0,
  timeout: 10,
  compact: true,
  exclude: [],
});

test("resume seeds all local bytes before network activity and never reprobes unchanged completed files", async (t) => {
  const bodies = {
    "active.bin": Buffer.alloc(3100, 67),
    "first.bin": Buffer.alloc(1100, 65),
    "second.bin": Buffer.alloc(2100, 66),
  };
  let requests = [];
  let events = [];
  let beforeNetwork;
  const server = http.createServer((req, res) => {
    if (req.url.endsWith("/")) {
      res.end(
        `<pre>${Object.keys(bodies)
          .map((name) => `<a href="${name}">${name}</a> 15-Sep-2026 09:00 4K`)
          .join("\n")}</pre>`
      );
      return;
    }
    beforeNetwork ??= events.at(-1)?.overall;
    requests.push({ method: req.method, url: req.url, range: req.headers.range });
    const body = bodies[req.url.split("/").at(-1)];
    const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
    const start = match ? Number(match[1]) : 0;
    const end = match?.[2] ? Math.min(Number(match[2]), body.length - 1) : body.length - 1;
    if (start >= body.length) {
      res.writeHead(416, { "content-range": `bytes */${body.length}` });
      res.end();
      return;
    }
    res.writeHead(match ? 206 : 200, {
      "content-length": end - start + 1,
      "accept-ranges": "bytes",
      etag: '"v1"',
      ...(match ? { "content-range": `bytes ${start}-${end}/${body.length}` } : {}),
    });
    res.end(req.method === "HEAD" ? undefined : body.subarray(start, end + 1));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const url = `http://127.0.0.1:${server.address().port}/series/`;
  for (const batch of [false, true]) {
    const output = path.join(home, batch ? "batch" : "single");
    const id = batch ? "batch" : "single";
    await fs.mkdir(path.join(output, ".visuales-parts"), { recursive: true });
    await fs.writeFile(path.join(output, ".visuales-parts", "active.bin"), bodies["active.bin"].subarray(0, 400));
    await recordDownloadFiles(id, output, async () => {
      for (const name of ["first.bin", "second.bin"]) {
        await fs.writeFile(path.join(output, name), bodies[name]);
        reportDownloadFile(`${url}${name}`, output, name, {
          status: "completed",
          verified: true,
          verificationVersion: 1,
          localMtimeMs: (await fs.stat(path.join(output, name))).mtimeMs,
          downloadedBytes: bodies[name].length,
          totalBytes: bodies[name].length,
          estimated: false,
        });
      }
    });
    requests = [];
    events = [];
    beforeNetwork = undefined;
    await recordDownloadFiles(
      id,
      output,
      async () => {
        assert.equal((await readDownloadFileDetails(id)).files.filter((file) => file.status === "completed").length, 2);
        if (batch)
          await downloadUrls([{ url, output, relativePath: "" }], options(output), (event) => events.push(event));
        else await downloadUrl(url, options(output), (event) => events.push(event));
      },
      { resume: true }
    );
    assert.equal(beforeNetwork.completedFiles, 2);
    assert.equal(
      beforeNetwork.downloadedBytes,
      3600,
      "all completions plus the existing partial prefix are counted before probing"
    );
    assert.equal(events[0].overall.downloadedBytes, 3600);
    assert.ok(
      requests.every((request) => request.url.endsWith("active.bin")),
      "completed files make no HEAD, probe or GET requests"
    );
    assert.ok(
      requests.some((request) => request.range?.startsWith("bytes=400-")),
      "partial bytes are reused"
    );
    assert.equal(events.at(-1).overall.downloadedBytes, 6300);
    assert.equal(events.at(-1).overall.totalBytes, 6300);
    assert.equal(events.at(-1).overall.completedFiles, 3);
    assert.deepEqual(await fs.readFile(path.join(output, "active.bin")), bodies["active.bin"]);
    requests = [];
    events = [];
    await recordDownloadFiles(id, output, () => downloadUrl(url, options(output), (event) => events.push(event)), {
      resume: true,
    });
    assert.deepEqual(requests, [], "repeated fully completed resumes are entirely local");
    assert.equal(events[0].overall.completedFiles, 3);
    assert.equal(events[0].overall.downloadedBytes, 6300);
  }
});

test("resume never trusts missing, changed, unverified or out-of-root completion records", async () => {
  const output = path.join(home, "trust");
  await fs.mkdir(output);
  const names = ["good", "missing", "truncated", "modified", "unverified", "unknown", "legacy", "no-mtime"];
  const files = [];
  for (const name of names) {
    await fs.writeFile(path.join(output, name), "data");
    const stat = await fs.stat(path.join(output, name));
    files.push({
      url: `http://example/${name}`,
      path: name,
      status: "completed",
      downloadedBytes: 4,
      totalBytes: 4,
      estimated: false,
      verified: name === "unknown" ? undefined : name !== "unverified",
      verificationVersion: name === "legacy" ? undefined : 1,
      localMtimeMs: name === "no-mtime" ? undefined : stat.mtimeMs,
    });
  }
  files.push({ ...files[0], path: "../good" });
  await recordDownloadFiles("trust", output, async () => {}, { initialFiles: files });
  await fs.rm(path.join(output, "missing"));
  await fs.writeFile(path.join(output, "truncated"), "x");
  await fs.utimes(path.join(output, "modified"), new Date(), new Date(Date.now() + 10000));
  await recordDownloadFiles(
    "trust",
    output,
    async () => {
      assert.deepEqual(
        (await readDownloadFileDetails("trust")).files.map((file) => file.path),
        ["good"]
      );
      assert.ok(await recordedFileCompletion("http://example/good", output, "good"));
      await fs.writeFile(path.join(output, "good"), "short");
      assert.equal(
        await recordedFileCompletion("http://example/good", output, "good"),
        null,
        "rechecks local changes after planning"
      );
    },
    { resume: true }
  );
  await recordDownloadFiles(
    "trust",
    output,
    async () => {
      assert.deepEqual((await readDownloadFileDetails("trust")).files, []);
    },
    { resume: false }
  );
});

test("local segmented progress counts actual chunk bytes without trusting invalid manifests or oversized chunks", async () => {
  const temp = path.join(home, "chunks", ".visuales-parts", "movie.bin");
  const directory = path.join(
    path.dirname(temp),
    `.ranges-${createHash("sha256").update(path.resolve(temp)).digest("hex")}`
  );
  await fs.mkdir(directory, { recursive: true });
  const metadata = { version: 1, url: "http://example/movie.bin", size: 20, chunkSize: 10, validator: '"v1"' };
  await fs.writeFile(path.join(directory, "manifest.json"), JSON.stringify(metadata));
  await fs.writeFile(path.join(directory, "0"), Buffer.alloc(10));
  await fs.writeFile(path.join(directory, "1"), Buffer.alloc(4));
  assert.equal(await parallelBytesOnDisk(temp, metadata.url), 14);
  assert.equal(await parallelBytesOnDisk(temp, "http://example/other.bin"), 0);
  await fs.writeFile(path.join(directory, "1"), Buffer.alloc(11));
  assert.equal(await parallelBytesOnDisk(temp, metadata.url), 10);
  await fs.writeFile(path.join(directory, "manifest.json"), JSON.stringify({ ...metadata, chunkSize: 0 }));
  assert.equal(await parallelBytesOnDisk(temp, metadata.url), 0);
});
