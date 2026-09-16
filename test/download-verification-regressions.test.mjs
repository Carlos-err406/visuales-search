import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";

const home = await fs.mkdtemp(path.join(os.tmpdir(), "visuales-verification-regressions-"));
process.env.HOME = home;
process.env.USERPROFILE = home;
const { downloadUrl, stopProgress } = await import("../packages/core/dist/download/downloader.js");
const { recordDownloadFiles, readDownloadFileDetails } = await import("../packages/core/dist/download/file-details.js");
const { probeRemoteCompletion } = await import("../packages/core/dist/download/verify.js");
const body = Buffer.alloc(1000, 120);
const options = (output) => ({
  output,
  resume: true,
  concurrent: 1,
  connections: 1,
  maxRetries: 0,
  timeout: 5,
  compact: true,
  exclude: [],
});

after(async () => {
  await stopProgress();
  await fs.rm(home, { recursive: true, force: true });
});

async function fixture(t, mode) {
  const requests = [];
  let tailMetadata = false;
  let remoteSize = body.length;
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, range: req.headers.range });
    if (req.url.endsWith("/")) {
      res.end(
        '<pre><a href="a.bin">a.bin</a> 16-Sep-2026 09:00 1000\n<a href="b.bin">b.bin</a> 16-Sep-2026 09:00 10</pre>'
      );
      return;
    }
    if (req.url.endsWith("b.bin")) {
      res.writeHead(200, { "content-length": 10 });
      res.end(req.method === "HEAD" ? undefined : body.subarray(0, 10));
      return;
    }
    if (req.method === "HEAD") {
      res.writeHead(200, mode === "tail-only" ? {} : { "content-length": remoteSize, etag: '"v1"' });
      res.end();
      return;
    }
    if (mode === "reset-failure") {
      res.writeHead(200, { "content-length": remoteSize });
      res.flushHeaders();
      setTimeout(() => res.destroy(), 20);
      return;
    }
    const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
    if (match) {
      const start = Number(match[1]);
      if (!match[2] && (mode === "repair-conflict" || mode === "repair-changed")) {
        if (mode === "repair-changed") remoteSize = 300;
        res.writeHead(200, { "content-length": 300, etag: mode === "repair-changed" ? '"v2"' : '"v1"' });
        res.end(body.subarray(0, 300));
        return;
      }
      const end = match[2] ? Math.min(Number(match[2]), remoteSize - 1) : remoteSize - 1;
      const known = mode !== "tail-only" || (tailMetadata && start > 0);
      if (start >= remoteSize) {
        res.writeHead(416, {
          ...(known ? { "content-range": `bytes */${remoteSize}` } : {}),
          "content-type": "text/html",
        });
        res.end("<html>Range not satisfiable</html>");
      } else {
        res.writeHead(206, {
          ...(known ? { "content-range": `bytes ${start}-${end}/${remoteSize}`, etag: '"v1"' } : {}),
          "transfer-encoding": "chunked",
        });
        res.end(body.subarray(start, end + 1));
      }
      return;
    }
    const payload = mode === "tail-only" ? body : body.subarray(0, 400);
    res.writeHead(
      200,
      mode === "conflict" ? { "content-length": payload.length, etag: '"v1"' } : { "transfer-encoding": "chunked" }
    );
    res.end(payload);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}/`;
  const output = await fs.mkdtemp(path.join(home, "output-"));
  const events = [];
  return {
    output,
    requests,
    events,
    base,
    enableTailMetadata: () => {
      tailMetadata = true;
    },
    run: (folder = false) =>
      recordDownloadFiles(
        output,
        output,
        () => downloadUrl(folder ? base : `${base}a.bin`, options(output), (p) => events.push(p)),
        { resume: true }
      ),
    details: async () => (await readDownloadFileDetails(output)).files,
  };
}

test("a short GET cannot override a conflicting HEAD size and bypass the assurance/repair pass", async (t) => {
  const f = await fixture(t, "conflict");
  await f.run();
  assert.deepEqual(await fs.readFile(path.join(f.output, "a.bin")), body);
  assert.ok(
    f.requests.some((r) => r.range === "bytes=400-400"),
    "check the end before accepting conflicting sizes"
  );
  assert.ok(
    f.requests.some((r) => r.range === "bytes=400-"),
    "repair the missing tail"
  );
  assert.equal((await f.details())[0].status, "completed");
  assert.equal((await f.details())[0].downloadedBytes, body.length);
});

test("a complete unverified parts file resumes using the EOF proof without requesting bytes beyond EOF", async (t) => {
  const f = await fixture(t, "tail-only");
  await assert.rejects(f.run(), /Could not verify/);
  assert.equal((await fs.stat(path.join(f.output, ".visuales-parts", "a.bin"))).size, 1000);
  f.enableTailMetadata();
  f.requests.length = 0;
  await f.run();
  assert.deepEqual(await fs.readFile(path.join(f.output, "a.bin")), body);
  assert.ok(f.requests.some((r) => r.range === "bytes=1000-1000"));
  assert.ok(!f.requests.some((r) => r.range === "bytes=1000-"));
  assert.equal((await f.details())[0].verified, true);
});

test("failed restart reconciles zero bytes on disk into per-file and aggregate progress", async (t) => {
  const f = await fixture(t, "reset-failure");
  const partial = path.join(f.output, ".visuales-parts", "a.bin");
  await fs.mkdir(path.dirname(partial), { recursive: true });
  await fs.writeFile(partial, body.subarray(0, 400));
  await assert.rejects(f.run(true));
  assert.equal((await fs.stat(partial)).size, 0);
  const files = await f.details();
  assert.equal(files.find((file) => file.path === "a.bin").downloadedBytes, 0);
  assert.equal(f.events.at(-1).overall.downloadedBytes, 10);
  assert.equal(f.events.at(-1).overall.completedFiles, 1);
  assert.deepEqual(f.events.at(-1).overall.activeFiles, []);
});

test("the final repair cannot certify a conflicting short response and clears deleted bytes from progress", async (t) => {
  const f = await fixture(t, "repair-conflict");
  await assert.rejects(f.run(true), /still incomplete/);
  assert.ok(
    f.requests.some((r) => r.range === "bytes=300-300"),
    "even the last repair gets a final check"
  );
  await assert.rejects(fs.stat(path.join(f.output, "a.bin")), { code: "ENOENT" });
  await assert.rejects(fs.stat(path.join(f.output, ".visuales-parts", "a.bin")), { code: "ENOENT" });
  assert.equal((await f.details()).find((file) => file.path === "a.bin").status, "failed");
  assert.equal(f.events.at(-1).overall.downloadedBytes, 10);
});

test("the last repair can accept a genuinely smaller replacement only after a fresh EOF proof", async (t) => {
  const f = await fixture(t, "repair-changed");
  await f.run();
  assert.deepEqual(await fs.readFile(path.join(f.output, "a.bin")), body.subarray(0, 300));
  assert.ok(f.requests.some((r) => r.range === "bytes=300-300"));
  assert.equal((await f.details())[0].downloadedBytes, 300);
  assert.equal((await f.details())[0].verified, true);
});

test("assurance probes reject mismatched/malformed ranges and accept a valid HTML-bodied 416", async (t) => {
  const replies = [
    [206, "bytes 0-0/400"],
    [206, "bytes 400-400/400"],
    [206, "garbage/400"],
    [416, "garbage/400"],
    [416, "bytes */400"],
  ];
  const server = http.createServer((req, res) => {
    const [status, range] = replies.shift();
    res.writeHead(status, {
      "content-range": range,
      "content-type": status === 416 ? "text/html" : "application/octet-stream",
    });
    res.end("x");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/file.bin`;
  for (let i = 0; i < 4; i++) assert.equal((await probeRemoteCompletion(url, 400, options(home))).known, false);
  const complete = await probeRemoteCompletion(url, 400, options(home));
  assert.equal(complete.complete, true);
  assert.equal(complete.totalSize, 400);
});
