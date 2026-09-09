import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { downloadWithFetch } from "../packages/core/dist/download/fetch-download.js";
import { clearParallelParts, withDownloadConnection } from "../packages/core/dist/download/parallel-download.js";
import { downloadFile, stopProgress } from "../packages/core/dist/download/downloader.js";

const BODY = randomBytes(16 * 1024 * 1024 + 37);
const CHUNK = 4 * 1024 * 1024;

test(
  "cancelling work queued behind busy connection slots does not wait for unrelated files",
  { timeout: 3000 },
  async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const occupied = Array.from({ length: 16 }, () => withDownloadConnection(() => gate));
    const abort = new AbortController();
    let ran = false;
    try {
      const queued = withDownloadConnection(async () => {
        ran = true;
      }, abort.signal);
      abort.abort(new Error("Cancelled while queued"));
      await assert.rejects(queued, /Cancelled while queued/);
    } finally {
      release();
      await Promise.all(occupied);
    }
    assert.equal(ran, false);
  }
);

async function fixture(t, mode = "normal", size = BODY.length) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "visuales-parallel-"));
  const state = { mode, revision: 1, active: 0, peak: 0, requests: [], cut: false };
  const body = () => (state.revision === 1 ? BODY.subarray(0, size) : Buffer.alloc(size, 73));
  const server = http.createServer((req, res) => {
    const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
    const start = match ? Number(match[1]) : 0;
    const end = match && match[2] ? Number(match[2]) : size - 1;
    const probe = match && start === 0 && end === 0;
    const segment = match && !probe;
    state.requests.push({
      range: req.headers.range,
      start,
      end,
      probe,
      ifRange: req.headers["if-range"],
      method: req.method,
    });
    if (state.mode === "changed" && segment) state.revision = 2;
    const headers = { "Content-Type": "application/octet-stream", ETag: `"revision-${state.revision}"` };
    if (state.mode === "weak") headers.ETag = 'W/"revision-1"';
    if (state.mode === "no-validator") delete headers.ETag;
    if (state.mode === "last-modified") {
      delete headers.ETag;
      headers["Last-Modified"] = "Mon, 01 Jan 2024 00:00:00 GMT";
    }
    if (req.method === "HEAD") {
      res.writeHead(200, { ...headers, "Content-Length": size });
      res.end();
      return;
    }
    if (segment && state.mode === "unavailable") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html>unavailable</html>");
      return;
    }
    if (segment && (state.mode === "always-503" || (state.mode === "retry-503" && !state.cut))) {
      state.cut = true;
      res.writeHead(503);
      res.end();
      return;
    }
    const full =
      !match ||
      state.mode === "ignore" ||
      (state.mode === "ignore-later" && segment) ||
      (req.headers["if-range"] &&
        req.headers["if-range"] !== headers.ETag &&
        req.headers["if-range"] !== headers["Last-Modified"]);
    if (!full && start >= size) {
      res.writeHead(416, { ...headers, "Content-Range": `bytes */${size}` });
      res.end();
      return;
    }
    const last = Math.min(end, size - 1);
    let data = full ? body() : body().subarray(start, last + 1);
    const extra = full ? {} : { "Content-Range": `bytes ${start}-${last}/${size}` };
    if (segment && state.mode === "wrong-offset") extra["Content-Range"] = `bytes ${start + 1}-${last + 1}/${size + 1}`;
    if (segment && state.mode === "wrong-total") extra["Content-Range"] = `bytes ${start}-${last}/${size + 1}`;
    if (state.mode === "unknown") delete extra["Content-Range"];
    if (segment && state.mode === "changed-header") headers.ETag = '"other"';
    if (segment && state.mode === "encoded") headers["Content-Encoding"] = "gzip";
    const short = segment && (state.mode === "short" || state.mode === "cut") && !state.cut;
    if (short) state.cut = true;
    if (short && state.mode === "short") data = data.subarray(0, 128 * 1024);
    res.writeHead(full ? 200 : 206, {
      ...headers,
      ...extra,
      ...(state.mode === "short" || state.mode === "unknown" ? {} : { "Content-Length": data.length }),
    });
    if (probe && !full) {
      res.end(data);
      return;
    }
    state.active++;
    state.peak = Math.max(state.peak, state.active);
    let cursor = 0;
    let timer;
    res.once("close", () => {
      state.active--;
      clearTimeout(timer);
    });
    const send = () => {
      if (res.destroyed) return;
      if (short && state.mode === "cut" && cursor >= 128 * 1024) {
        res.destroy();
        return;
      }
      const next = Math.min(cursor + 64 * 1024, data.length);
      res.write(data.subarray(cursor, next));
      cursor = next;
      if (cursor === data.length) res.end();
      else timer = setTimeout(send, 2);
    };
    send();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const request = {
    url: `http://127.0.0.1:${server.address().port}/file.bin`,
    tempPath: path.join(directory, "file.bin"),
    options: {
      output: directory,
      resume: true,
      maxRetries: 0,
      timeout: 10,
      concurrent: 5,
      connections: 4,
      compact: true,
      exclude: [],
    },
    expectedFileSize: { size, exact: true },
  };
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { request, state, body, directory };
}

test("parallel fetch uses multiple bounded connections and assembles byte-exact output", async (t) => {
  const { request, state } = await fixture(t);
  const progress = [];
  const result = await downloadWithFetch({ ...request, onProgress: (p) => progress.push(p) });
  assert.equal(result.exactSize, BODY.length);
  assert.equal(state.peak, 4);
  assert.deepEqual(await fs.readFile(request.tempPath), BODY);
  assert.ok(state.requests.filter((r) => r.range && !r.probe).every((r) => r.ifRange === '"revision-1"'));
  for (let i = 1; i < progress.length; i++) assert.ok(progress[i].downloadedBytes >= progress[i - 1].downloadedBytes);
  assert.equal(progress.at(-1).downloadedBytes, BODY.length);
  await clearParallelParts(request.tempPath);
  assert.deepEqual(await fs.readdir(path.dirname(request.tempPath)), ["file.bin"]);
});

test("small files and one connection use the established single-stream path", async (t) => {
  for (const size of [1024, BODY.length]) {
    const { request, state } = await fixture(t, "normal", size);
    if (size === BODY.length) request.options.connections = 1;
    await downloadWithFetch(request);
    assert.equal(
      state.requests.some((r) => r.range),
      false
    );
    assert.equal(state.peak, 1);
  }
});

test("multiple files share the process connection budget", async (t) => {
  const { request, state, directory } = await fixture(t);
  const requests = Array.from({ length: 5 }, (_, index) => ({
    ...request,
    tempPath: path.join(directory, `parallel-${index}.bin`),
    options: { ...request.options, connections: 8 },
  }));
  await Promise.all(requests.map(downloadWithFetch));
  assert.ok(state.peak > 8, "files can download concurrently");
  assert.ok(state.peak <= 16, "combined payload requests stay bounded");
  for (const download of requests) assert.deepEqual(await fs.readFile(download.tempPath), BODY);
});

test("unknown initial size and strong Last-Modified can negotiate parallel downloads", async (t) => {
  const { request, state } = await fixture(t, "last-modified");
  request.expectedFileSize = { size: 0, exact: false };
  await downloadWithFetch(request);
  assert.equal(state.peak, 4);
  assert.deepEqual(await fs.readFile(request.tempPath), BODY);
});

test("unsupported and unsafe ranges fall back without mixing bytes", async (t) => {
  for (const mode of [
    "ignore",
    "ignore-later",
    "weak",
    "no-validator",
    "unknown",
    "wrong-offset",
    "wrong-total",
    "changed-header",
    "encoded",
    "changed",
    "unavailable",
  ]) {
    await t.test(mode, async (t) => {
      const { request, state, body } = await fixture(t, mode);
      await downloadWithFetch(request);
      assert.deepEqual(await fs.readFile(request.tempPath), body());
      assert.ok(state.requests.some((r) => !r.range && r.method !== "HEAD"));
    });
  }
});

test("legacy partial files resume their contiguous prefix without splitting", async (t) => {
  const { request, state } = await fixture(t);
  await fs.writeFile(request.tempPath, BODY.subarray(0, 100_000));
  await downloadWithFetch({ ...request, validator: '"revision-1"' });
  assert.deepEqual(await fs.readFile(request.tempPath), BODY);
  assert.equal(state.peak, 1);
  assert.equal(state.requests[0].range, "bytes=100000-");
});

for (const mode of ["short", "cut"]) {
  test(`${mode} responses preserve segments for retry instead of promoting an incomplete file`, async (t) => {
    const { request, state } = await fixture(t, mode);
    await assert.rejects(downloadWithFetch(request));
    await assert.rejects(fs.access(request.tempPath));
    const before = state.requests.length;
    await downloadWithFetch(request);
    assert.ok(state.requests.slice(before).some((r) => r.range && !r.probe && r.start % CHUNK > 0));
    assert.deepEqual(await fs.readFile(request.tempPath), BODY);
  });
}

test("process interruption resumes persisted segments even with a different connection count", async (t) => {
  const { request, state } = await fixture(t);
  const moduleUrl = new URL("../packages/core/dist/download/fetch-download.js", import.meta.url).href;
  const script = `import { downloadWithFetch } from ${JSON.stringify(moduleUrl)};
    await downloadWithFetch({...JSON.parse(process.argv[1]), onProgress(p) { if(p.downloadedBytes >= 262144) process.send(p); }});`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script, JSON.stringify(request)], {
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  t.after(() => child.kill("SIGKILL"));
  await Promise.race([
    once(child, "message"),
    once(child, "exit").then(() => {
      throw new Error("Child exited before progress");
    }),
  ]);
  const closed = once(child, "exit");
  child.kill("SIGKILL");
  await closed;
  const before = state.requests.length;
  request.options.connections = 1;
  await downloadWithFetch(request);
  assert.ok(state.requests.slice(before).some((r) => r.range && !r.probe && r.start % CHUNK > 0));
  assert.deepEqual(await fs.readFile(request.tempPath), BODY);
});

test("changed remote content invalidates persisted segments", async (t) => {
  const { request, state, body } = await fixture(t, "cut");
  await assert.rejects(downloadWithFetch(request));
  state.revision = 2;
  const before = state.requests.length;
  await downloadWithFetch(request);
  assert.ok(
    state.requests
      .slice(before)
      .filter((r) => r.range && !r.probe)
      .every((r) => r.start % CHUNK === 0)
  );
  assert.deepEqual(await fs.readFile(request.tempPath), body());
});

test("resume off discards segment progress, and an interrupted assembly is rebuilt", async (t) => {
  const { request, state } = await fixture(t, "cut");
  await assert.rejects(downloadWithFetch(request));
  const before = state.requests.length;
  request.options.resume = false;
  await downloadWithFetch(request);
  assert.ok(
    state.requests
      .slice(before)
      .filter((r) => r.range && !r.probe)
      .every((r) => r.start % CHUNK === 0)
  );
  // Segments remain until promotion. Simulate a crash leaving an incomplete assembled destination.
  await fs.truncate(request.tempPath, 200);
  request.options.resume = true;
  const finished = state.requests.length;
  await downloadWithFetch(request);
  assert.ok(
    state.requests.slice(finished).every((r) => r.probe),
    "complete segments need only a metadata probe"
  );
  assert.deepEqual(await fs.readFile(request.tempPath), BODY);
});

test("the distributed CLI honors --connections without changing its defaults", async (t) => {
  const { request, state, directory } = await fixture(t);
  const child = spawn(
    process.execPath,
    ["dist/cli.js", "download", request.url, "--output", directory, "--connections", "4", "--compact"],
    { env: { ...process.env, HOME: directory, USERPROFILE: directory }, stdio: ["ignore", "pipe", "pipe"] }
  );
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  t.after(() => child.kill());
  const [code] = await once(child, "exit");
  assert.equal(code, 0, output);
  assert.equal(state.peak, 4);
  assert.deepEqual(await fs.readFile(request.tempPath), BODY);
});

test("shared downloadFile uses parallel connections, retries, verifies and cleans up", async (t) => {
  const { request, state, directory } = await fixture(t, "retry-503");
  t.after(stopProgress);
  await downloadFile(request.url, { ...request.options, maxRetries: 1 });
  assert.ok(state.peak > 1);
  assert.deepEqual(await fs.readFile(path.join(directory, "file.bin")), BODY);
  assert.deepEqual(await fs.readdir(path.join(directory, ".visuales-parts")), []);
});

test("zero retries fails without promotion; explicit cancellation releases all work", async (t) => {
  const { request, state } = await fixture(t, "always-503");
  t.after(stopProgress);
  await assert.rejects(downloadFile(request.url, request.options), /HTTP 503/);
  await assert.rejects(fs.access(request.tempPath));
  state.mode = "normal";
  const controller = new AbortController();
  await assert.rejects(
    downloadWithFetch({
      ...request,
      signal: controller.signal,
      onProgress(p) {
        if (p.downloadedBytes > 0) controller.abort(new Error("User cancelled"));
      },
    }),
    /User cancelled/
  );
  await downloadWithFetch(request);
  assert.deepEqual(await fs.readFile(request.tempPath), BODY);
});
