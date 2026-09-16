import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { FILE_BODY, startTestServer } from "./helpers/test-server.mjs";

let home, rpc, server, slowServer, slowUrl;
const sleeps = new Set();

async function startRpc() {
  const script = path.join(home, "packaged engine", "sidecar.cjs");
  await fs.mkdir(path.dirname(script), { recursive: true });
  await fs.copyFile("apps/sidecar/dist/sidecar.cjs", script);
  // Run outside the repository so accidental runtime imports cannot find node_modules.
  const child = spawn(process.execPath, [script], {
    cwd: home,
    env: { ...process.env, HOME: home, USERPROFILE: home, NODE_PATH: "" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map();
  let sequence = 0,
    stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const closed = once(child, "close");
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    if (message.id) {
      const handler = pending.get(message.id);
      pending.delete(message.id);
      if (!handler) return;
      clearTimeout(handler.timer);
      if (message.error) handler.reject(new Error(message.error.message));
      else handler.resolve(message.result);
    }
  });
  child.on("close", () => {
    for (const handler of pending.values()) {
      clearTimeout(handler.timer);
      handler.reject(new Error(`Sidecar exited: ${stderr}`));
    }
    pending.clear();
  });
  return {
    child,
    request(method, params = {}) {
      const id = String(++sequence);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Timed out: ${method}\n${stderr}`));
        }, 20000);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      });
    },
    async close() {
      child.stdin.end();
      await closed;
    },
  };
}

async function waitForTask(id, status, client = rpc) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const tasks = await client.request("tasks.list");
    const task = tasks.find((entry) => entry.id === id);
    if (task?.status === status) return task;
    if (task?.status === "failed" && status !== "failed") assert.fail(task.lastError);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`Task ${id} did not become ${status}`);
}

async function waitForPartial(output) {
  const parts = path.join(output, ".visuales-parts");
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const files = await fs.readdir(parts).catch(() => []);
    for (const file of files) {
      const partial = path.join(parts, file);
      if ((await fs.stat(partial).catch(() => null))?.size > 0) return partial;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`No partial file appeared in ${output}`);
}

before(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "visuales-sidecar-"));
  server = await startTestServer();
  slowServer = http.createServer((req, res) => {
    if (req.url.endsWith("/")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        `<pre><a href="episode.bin">episode.bin</a> 08-Sep-2026 12:00 1048576\n${
          req.url.endsWith("/Extras/") ? "" : '<a href="Extras/">Extras/</a> 08-Sep-2026 12:00 -\n'
        }</pre>`
      );
      return;
    }
    const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
    const start = match ? Number(match[1]) : 0;
    const end = match?.[2] ? Number(match[2]) : FILE_BODY.length - 1;
    if (start >= FILE_BODY.length) {
      res.writeHead(416, { "content-range": `bytes */${FILE_BODY.length}` });
      res.end();
      return;
    }
    res.writeHead(match ? 206 : 200, {
      "content-length": end - start + 1,
      "accept-ranges": "bytes",
      etag: '"slow-fixture"',
      ...(match ? { "content-range": `bytes ${start}-${end}/${FILE_BODY.length}` } : {}),
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    if (end === start) {
      res.end(FILE_BODY.subarray(start, end + 1));
      return;
    }
    let offset = start;
    const timer = setInterval(() => {
      const next = Math.min(offset + 32768, end + 1);
      res.write(FILE_BODY.subarray(offset, next));
      offset = next;
      if (offset > end) {
        clearInterval(timer);
        sleeps.delete(timer);
        res.end();
      }
    }, 80);
    sleeps.add(timer);
    res.on("close", () => {
      clearInterval(timer);
      sleeps.delete(timer);
    });
  });
  await new Promise((resolve) => slowServer.listen(0, "127.0.0.1", resolve));
  slowUrl = `http://127.0.0.1:${slowServer.address().port}`;
  rpc = await startRpc();
});

after(async () => {
  await rpc?.close();
  for (const timer of sleeps) clearInterval(timer);
  slowServer?.closeAllConnections();
  await new Promise((resolve) => slowServer.close(resolve));
  await server?.close();
  await fs.rm(home, { recursive: true, force: true });
});

describe("packaged Node sidecar", () => {
  it("reviews without starting and uses the reviewed settings even if defaults change", async () => {
    const initial = await rpc.request("settings.get");
    const output = path.join(home, "reviewed-output");
    const urls = [server.url("normal", "reviewed.bin")];
    try {
      await rpc.request("settings.save", {
        settings: { ...initial.settings, output, connections: 2, exclude: ["*.jpg"] },
      });
      const before = await rpc.request("tasks.list");
      const review = await rpc.request("download.review", { urls });
      assert.equal(review.includedFiles, 1);
      assert.equal(review.knownBytes, FILE_BODY.length);
      assert.equal(review.output, output);
      assert.equal((await rpc.request("tasks.list")).length, before.length);
      await assert.rejects(fs.stat(output), { code: "ENOENT" });
      await rpc.request("settings.save", {
        settings: { ...initial.settings, output: path.join(home, "changed-output"), connections: 4 },
      });
      const task = await rpc.request("download.start", { reviewId: review.reviewId, queue: false });
      assert.equal(task.output, output);
      assert.equal(task.options.connections, 2);
      assert.deepEqual(task.options.exclude, ["*.jpg"]);
      await waitForTask(task.id, "completed");
      assert.deepEqual(await fs.readFile(path.join(output, "reviewed.bin")), FILE_BODY);
      await assert.rejects(rpc.request("download.start", { reviewId: review.reviewId }), /expired/);
    } finally {
      await rpc.request("settings.save", { settings: initial.settings });
    }
  });

  it("retries failed files on the same task through a packaged worker", async () => {
    const initial = await rpc.request("settings.get");
    const originalOutput = path.join(home, "rpc-file-retry");
    const url = server.url("normal", "retry.bin");
    try {
      const task = await rpc.request("download.start", { urls: [url], output: originalOutput });
      await waitForTask(task.id, "completed");
      // Simulate a recorded failure after the worker has exited; preserve the original task ID.
      await new Promise((resolve) => setTimeout(resolve, 100));
      const storePath = path.join(home, ".visuales-cli-cache/download/tasks.json");
      const store = JSON.parse(await fs.readFile(storePath, "utf8"));
      const saved = store.tasks.find((entry) => entry.id === task.id);
      saved.status = "failed";
      saved.lastError = "Fixture failure";
      await fs.writeFile(storePath, JSON.stringify(store));
      const detailsPath = path.join(
        home,
        ".visuales-cli-cache/download/file-details",
        `${createHash("sha256").update(task.id).digest("hex")}.json`
      );
      const details = JSON.parse(await fs.readFile(detailsPath, "utf8"));
      details.files[0].status = "failed";
      details.files[0].error = "Fixture failure";
      await fs.writeFile(detailsPath, JSON.stringify(details));
      const retried = await rpc.request("tasks.retry", { id: task.id, paths: ["retry.bin"] });
      assert.equal(retried.id, task.id);
      assert.equal(retried.output, originalOutput);
      const finished = await waitForTask(task.id, "completed");
      assert.equal(finished.overallProgress.downloadedBytes, FILE_BODY.length);
      const final = await rpc.request("tasks.files", { id: task.id });
      assert.equal(final.files[0].status, "completed");
      assert.equal(final.files[0].error, undefined);
      await assert.rejects(rpc.request("tasks.retry", { id: task.id }), /already complete/);
    } finally {
      await rpc.request("settings.save", { settings: initial.settings });
    }
  });

  it("serves cached directory listings and file previews through the packaged RPC adapter", async () => {
    const tasksBefore = await rpc.request("tasks.list");
    const root = path.join(home, ".visuales-cli-cache");
    await fs.mkdir(path.join(root, "previews"), { recursive: true });
    const url = "https://visuales.uclv.cu/RpcFixtures/readme.txt";
    await fs.writeFile(
      path.join(root, "discovery.json"),
      JSON.stringify({
        "https://visuales.uclv.cu/RpcFixtures/": {
          files: [{ url, size: 42, exact: true }],
          dirs: [],
          parserVersion: 4,
        },
      })
    );
    const preview = {
      url,
      kind: "text",
      mime: "text/plain",
      content: "Cached preview",
      bytes: 14,
      fetchedAt: Date.now(),
      cached: false,
    };
    const name = createHash("sha256").update(url).digest("hex") + ".json";
    await fs.writeFile(path.join(root, "previews", name), JSON.stringify(preview));
    const entries = await rpc.request("library.list", { url: "https://visuales.uclv.cu/RpcFixtures/" });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].encodedUrl, url);
    assert.deepEqual(await rpc.request("library.preview", { url }), { ...preview, cached: true });
    assert.deepEqual(await rpc.request("library.preview.cached", { url }), { ...preview, cached: true });
    assert.equal(await rpc.request("library.preview.status", { url }), "idle");
    assert.equal(await rpc.request("library.local", { url }), null);
    assert.deepEqual(await rpc.request("library.resource", { url }), {
      url,
      name: new URL(url).pathname.split("/").at(-1),
      kind: "preview",
    });
    await assert.rejects(rpc.request("library.resource", { url: "https://evil.test/test.png" }), /Only Visuales/);
    await assert.rejects(
      rpc.request("library.resource", { url: "https://visuales.uclv.cu/video.mkv" }),
      /not available/
    );
    await assert.rejects(rpc.request("library.preview", { url: "file:///etc/passwd" }), /Only Visuales/);
    await assert.rejects(rpc.request("library.list", { url: "https://example.com/" }), /Only Visuales/);
    const registry = JSON.parse(await fs.readFile(path.join(root, "index.json"), "utf8"));
    assert.ok(registry.entries.some((entry) => entry.id === "previews"));
    assert.deepEqual(await rpc.request("tasks.list"), tasksBefore, "browsing never creates a transfer");
  });

  it("uses saved connection counts for real parallel downloads in a packaged worker", async () => {
    const initial = await rpc.request("settings.get");
    const body = Buffer.concat(Array.from({ length: 16 }, () => FILE_BODY));
    let active = 0,
      peak = 0;
    const fixture = http.createServer((req, res) => {
      const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
      const start = match ? Number(match[1]) : 0;
      const end = match?.[2] ? Number(match[2]) : body.length - 1;
      res.writeHead(match ? 206 : 200, {
        "content-length": end - start + 1,
        etag: '"parallel-sidecar"',
        ...(match ? { "content-range": `bytes ${start}-${end}/${body.length}` } : {}),
      });
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      if (start === end) {
        res.end(body.subarray(start, end + 1));
        return;
      }
      active++;
      peak = Math.max(peak, active);
      let offset = start;
      const timer = setInterval(() => {
        const next = Math.min(offset + 65536, end + 1);
        res.write(body.subarray(offset, next));
        offset = next;
        if (offset > end) {
          clearInterval(timer);
          res.end();
        }
      }, 3);
      res.once("close", () => {
        active--;
        clearInterval(timer);
      });
    });
    await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));
    let task;
    try {
      await rpc.request("settings.save", { settings: { ...initial.settings, connections: 4 } });
      const output = path.join(home, "parallel worker");
      task = await rpc.request("download.start", {
        urls: [`http://127.0.0.1:${fixture.address().port}/large.bin`],
        output,
      });
      await waitForTask(task.id, "completed");
      assert.equal(peak, 4);
      assert.deepEqual(await fs.readFile(path.join(output, "large.bin")), body);
    } finally {
      if (task) await rpc.request("tasks.cancel", { id: task.id });
      await rpc.request("settings.save", { settings: initial.settings });
      fixture.closeAllConnections();
      await new Promise((resolve) => fixture.close(resolve));
    }
  });
  it("persists desktop defaults and snapshots new tasks without changing queued or resumed tasks", async () => {
    const initial = await rpc.request("settings.get");
    const changed = {
      ...initial.settings,
      output: path.join(home, "Saved destination"),
      concurrent: 2,
      connections: 4,
      maxRetries: 4,
      exclude: ["*.{jpg,nfo}", "Extras/**"],
    };
    const ids = [];
    let other;
    try {
      await rpc.request("settings.save", { settings: changed });
      other = await startRpc();
      assert.deepEqual(
        (await other.request("settings.get")).settings,
        changed,
        "another sidecar reads persisted defaults"
      );
      const running = await rpc.request("download.start", { urls: [`${slowUrl}/settings-running.bin`] });
      ids.push(running.id);
      const queued = await rpc.request("download.start", { urls: [`${slowUrl}/Settings%20Folder/`], queue: true });
      ids.push(queued.id);
      assert.equal(running.output, changed.output);
      assert.equal(queued.output, path.join(changed.output, "Settings Folder"));
      assert.equal(queued.status, "queued");
      for (const task of [running, queued]) {
        assert.equal(task.options.concurrent, 2);
        assert.equal(task.options.maxRetries, 4);
        assert.equal(task.options.connections, 4);
        assert.deepEqual(task.options.exclude, changed.exclude);
      }
      const later = {
        ...changed,
        output: path.join(home, "Later default"),
        concurrent: 7,
        connections: 8,
        maxRetries: 0,
        exclude: ["*.txt"],
      };
      await rpc.request("settings.save", { settings: later });
      for (const id of ids) {
        const task = (await rpc.request("tasks.list")).find((entry) => entry.id === id);
        assert.equal(task.options.concurrent, 2);
        assert.equal(task.options.maxRetries, 4);
        assert.equal(task.options.connections, 4);
        assert.deepEqual(task.options.exclude, changed.exclude);
      }
      await rpc.request("tasks.cancel", { id: queued.id });
      const resumed = await rpc.request("tasks.resume", { id: queued.id, queue: true });
      assert.equal(resumed.output, queued.output);
      assert.equal(resumed.options.concurrent, 2);
      assert.equal(resumed.options.maxRetries, 4);
      assert.equal(resumed.options.connections, 4);
      assert.deepEqual(resumed.options.exclude, changed.exclude);
      const explicit = await rpc.request("download.start", {
        urls: [server.url("normal", "settings-explicit.bin")],
        output: path.join(home, "Explicit"),
      });
      ids.push(explicit.id);
      assert.equal(explicit.output, path.join(home, "Explicit"));
      assert.equal(explicit.options.concurrent, 7);
      assert.equal(explicit.options.maxRetries, 0);
      assert.equal(explicit.options.connections, 8);
      assert.deepEqual(explicit.options.exclude, later.exclude);
      await assert.rejects(rpc.request("settings.save", { settings: { ...later, concurrent: 0 } }), /concurrent/);
      assert.deepEqual((await rpc.request("settings.get")).settings, later);
    } finally {
      for (const id of ids) await rpc.request("tasks.cancel", { id });
      await other?.close();
      await rpc.request("settings.save", { settings: initial.settings });
    }
  });
  it("reorders shared CLI and desktop workers and starts only the chosen next transfer", async () => {
    const cli = (...args) =>
      promisify(execFile)(process.execPath, [path.resolve("dist/cli.js"), ...args], {
        env: { ...process.env, HOME: home, USERPROFILE: home },
        timeout: 20000,
      });
    const blocker = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    const exited = once(blocker, "exit");
    const taskFile = path.join(home, ".visuales-cli-cache", "download", "tasks.json");
    // A live blocker keeps the queue parked while independent clients reorder it.
    const store = JSON.parse(await fs.readFile(taskFile, "utf8").catch(() => '{"version":1,"tasks":[]}'));
    const blockerId = "queue-test-blocker";
    store.tasks.push({
      id: blockerId,
      url: "http://example.test/queue-blocker",
      output: home,
      options: {
        output: home,
        timeout: "Infinity",
        resume: true,
        concurrent: 5,
        connections: 3,
        maxRetries: 3,
        exclude: [],
        compact: false,
      },
      status: "running",
      pid: blocker.pid,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      overallProgress: undefined,
      lastProgress: undefined,
    });
    await fs.mkdir(path.dirname(taskFile), { recursive: true });
    await fs.writeFile(taskFile, JSON.stringify(store));
    const ids = [blockerId];
    try {
      const a = await rpc.request("download.start", {
        urls: [`${slowUrl}/queue-a.bin`],
        output: path.join(home, "queue-a"),
        queue: true,
      });
      ids.push(a.id);
      const cliUrl = `${slowUrl}/queue-cli.bin`;
      await cli("download", cliUrl, "--output", path.join(home, "queue-cli"), "--queue", "--detach");
      const b = (await rpc.request("tasks.list")).find((task) => task.url === cliUrl);
      assert.equal(b.status, "queued");
      ids.push(b.id);
      const c = await rpc.request("download.start", {
        urls: [`${slowUrl}/queue-c.bin`],
        output: path.join(home, "queue-c"),
        queue: true,
      });
      ids.push(c.id);
      await cli("tasks", "next", b.id);
      let queue = await rpc.request("tasks.move", { id: c.id, position: "up" });
      assert.deepEqual(
        queue.map((task) => task.id),
        [b.id, c.id, a.id]
      );
      queue = await rpc.request("tasks.move", { id: a.id, position: "next" });
      assert.deepEqual(
        queue.map((task) => task.id),
        [a.id, b.id, c.id]
      );
      await cli("tasks", "next", b.id);
      await assert.rejects(rpc.request("tasks.move", { id: a.id, position: 0 }), /position/);
      await rpc.request("tasks.cancel", { id: blockerId });
      await exited;
      await waitForTask(b.id, "running");
      const snapshot = await rpc.request("tasks.list");
      assert.equal(snapshot.find((t) => t.id === a.id).status, "queued");
      assert.equal(snapshot.find((t) => t.id === c.id).status, "queued");
      await waitForTask(b.id, "completed");
      const cliFiles = await rpc.request("tasks.files", { id: b.id });
      assert.equal(cliFiles.files[0].path, "queue-cli.bin");
      assert.equal(cliFiles.files[0].status, "completed", "CLI runs record the same per-file history");
      await waitForTask(a.id, "running");
      assert.equal((await rpc.request("tasks.list")).find((t) => t.id === c.id).status, "queued");
    } finally {
      for (const id of ids) await rpc.request("tasks.cancel", { id });
      blocker.kill();
      await exited;
    }
  });
  it("waits for pending starts before taking the updater's idle snapshot", async () => {
    const starting = rpc.request("download.start", {
      urls: [`${slowUrl}/update-barrier.bin`],
      output: path.join(home, "update barrier"),
    });
    const snapshot = rpc.request("tasks.prepareUpdate");
    const task = await starting;
    try {
      const tasks = await snapshot;
      assert.equal(tasks.find((entry) => entry.id === task.id)?.status, "running");
    } finally {
      await rpc.request("tasks.cancel", { id: task.id });
    }
  });
  it("applies saved exclusions to real immediate and queued folder downloads", async () => {
    const initial = await rpc.request("settings.get");
    const body = Buffer.from("local exclusion fixture\n");
    const requestedFiles = [];
    const fixture = http.createServer((req, res) => {
      if (req.url.endsWith("/")) {
        const names = req.url.endsWith("/Extras/")
          ? ["notes.txt", "poster.jpg", "cover.jpg"]
          : ["keep.txt", "cover.jpg", "poster.jpg", "release.nfo", "Extras/"];
        res.writeHead(200, { "content-type": "text/html" });
        res.end(
          `<pre>${names.map((name) => `<a href="${name}">${name}</a> 08-Sep-2026 12:00 ${name.endsWith("/") ? "-" : body.length}`).join("\n")}</pre>`
        );
      } else {
        requestedFiles.push(req.url);
        res.writeHead(200, { "content-length": body.length });
        res.end(req.method === "HEAD" ? undefined : body);
      }
    });
    await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${fixture.address().port}/Pack/`;
    const ids = [];
    try {
      for (const queue of [false, true]) {
        await rpc.request("settings.save", {
          settings: {
            ...initial.settings,
            exclude: ["*.{jpg,nfo}", "!poster.jpg", "*.jpg", "!poster.jpg", "Extras/*", "!Extras/poster.jpg"],
          },
        });
        let blocker;
        if (queue) {
          blocker = await rpc.request("download.start", {
            urls: [`${slowUrl}/exclusions-blocker.bin`],
            output: path.join(home, "exclusion blocker"),
          });
          ids.push(blocker.id);
        }
        const task = await rpc.request("download.start", {
          urls: [base],
          output: path.join(home, `excluded-${queue}`),
          queue,
        });
        ids.push(task.id);
        if (queue) {
          assert.equal(task.status, "queued");
          await rpc.request("settings.save", { settings: { ...initial.settings, exclude: [] } });
          await rpc.request("tasks.cancel", { id: blocker.id });
        }
        await waitForTask(task.id, "completed");
        assert.deepEqual(await fs.readFile(path.join(task.output, "keep.txt")), body);
        for (const file of ["poster.jpg", "Extras/poster.jpg"])
          assert.deepEqual(await fs.readFile(path.join(task.output, file)), body);
        for (const file of ["cover.jpg", "release.nfo", "Extras/notes.txt", "Extras/cover.jpg"])
          await assert.rejects(fs.access(path.join(task.output, file)));
      }
      assert.ok(requestedFiles.length > 0);
      assert.ok(
        requestedFiles.every((url) => url.endsWith("/keep.txt") || url.endsWith("/poster.jpg")),
        "excluded files are not requested"
      );
      // Explicit file selection has the same precedence over exclusions as the CLI.
      await rpc.request("settings.save", { settings: { ...initial.settings, exclude: ["*.jpg"] } });
      const explicit = await rpc.request("download.start", {
        urls: [base + "cover.jpg"],
        output: path.join(home, "explicit excluded file"),
      });
      ids.push(explicit.id);
      await waitForTask(explicit.id, "completed");
      assert.deepEqual(await fs.readFile(path.join(explicit.output, "cover.jpg")), body);
    } finally {
      for (const id of ids) await rpc.request("tasks.cancel", { id });
      await rpc.request("settings.save", { settings: initial.settings });
      fixture.closeAllConnections();
      await new Promise((resolve) => fixture.close(resolve));
    }
  });
  it("serializes quit snapshots and distinguishes this instance's workers from external transfers", async () => {
    const other = await startRpc();
    let running, queued;
    try {
      const starting = rpc.request("download.start", {
        urls: [`${slowUrl}/quit-warning.bin`],
        output: path.join(home, "quit warning"),
      });
      const snapshot = rpc.request("tasks.prepareQuit");
      running = await starting;
      const own = await snapshot;
      assert.equal(own.ownedRunning, 1);
      assert.ok(own.running >= 1);
      const external = await other.request("tasks.prepareQuit");
      assert.equal(external.ownedRunning, 0);
      assert.equal(external.running, own.running);
      queued = await rpc.request("download.start", {
        urls: [`${slowUrl}/quit-queued.bin`],
        output: path.join(home, "quit queued"),
        queue: true,
      });
      const both = await rpc.request("tasks.prepareQuit");
      assert.equal(both.ownedRunning, 1);
      assert.equal(both.ownedQueued, 1);
      // A snapshot is read-only: declining quit does not stop or change workers.
      assert.equal((await waitForTask(running.id, "running")).pid, running.pid);
      assert.equal((await waitForTask(queued.id, "queued")).pid, queued.pid);
    } finally {
      if (queued) await rpc.request("tasks.cancel", { id: queued.id });
      if (running) await rpc.request("tasks.cancel", { id: running.id });
      await other.close();
    }
  });
  it("keeps a single selected folder below the desktop destination, immediately or queued", async () => {
    for (const queue of [false, true]) {
      const output = path.join(home, queue ? "single queued" : "single immediate");
      const folder = path.join(output, "Season One (2026)");
      const task = await rpc.request("download.start", {
        urls: [`${slowUrl}/Season%20One%20(2026)/`],
        output,
        queue,
      });
      assert.equal(task.output, folder);
      assert.equal(task.options.output, folder);
      await waitForTask(task.id, "completed");
      assert.deepEqual(await fs.readFile(path.join(folder, "episode.bin")), FILE_BODY);
      assert.deepEqual(await fs.readFile(path.join(folder, "Extras", "episode.bin")), FILE_BODY);
      const details = await rpc.request("tasks.files", { id: task.id });
      assert.deepEqual(details.files.map((file) => file.path).sort(), ["Extras/episode.bin", "episode.bin"]);
      assert.ok(
        details.files.every((file) => file.status === "completed" && file.downloadedBytes === FILE_BODY.length)
      );
      await assert.rejects(fs.access(path.join(output, "episode.bin")));
    }
  });

  it("keeps multiple selected folders as siblings below the desktop destination", async () => {
    const output = path.join(home, "multiple folders");
    const task = await rpc.request("download.start", {
      urls: [`${slowUrl}/First/`, `${slowUrl}/Second/`],
      output,
    });
    assert.equal(task.output, output);
    await waitForTask(task.id, "completed");
    for (const folder of ["First", "Second"]) {
      assert.deepEqual(await fs.readFile(path.join(output, folder, "episode.bin")), FILE_BODY);
    }
    const details = await rpc.request("tasks.files", { id: task.id });
    assert.deepEqual(details.files.map((file) => file.path).sort(), [
      "First/Extras/episode.bin",
      "First/episode.bin",
      "Second/Extras/episode.bin",
      "Second/episode.bin",
    ]);
    await assert.rejects(fs.access(path.join(output, "episode.bin")));
  });

  it("resumes a desktop folder without adding the folder name a second time", async () => {
    const output = path.join(home, "resumed folder");
    const folder = path.join(output, "Season");
    const task = await rpc.request("download.start", { urls: [`${slowUrl}/Season/`], output });
    await waitForPartial(folder);
    await rpc.request("tasks.cancel", { id: task.id });
    await waitForTask(task.id, "interrupted");
    const resumed = await rpc.request("tasks.resume", { id: task.id });
    assert.equal(resumed.id, task.id);
    assert.equal(resumed.output, folder);
    await waitForTask(task.id, "completed");
    assert.deepEqual(await fs.readFile(path.join(folder, "episode.bin")), FILE_BODY);
    await assert.rejects(fs.access(path.join(folder, "Season")));
  });

  it("CLI and desktop resumes reuse recorded completions without contacting each file again", async () => {
    const output = path.join(home, "verified resume");
    const url = `${slowUrl}/VerifiedResume/`;
    const cliOptions = { env: { ...process.env, HOME: home, USERPROFILE: home }, timeout: 30000 };
    await promisify(execFile)(
      process.execPath,
      ["dist/cli.js", "download", url, "--output", output, "--compact"],
      cliOptions
    );
    const task = (await rpc.request("tasks.list")).find((entry) => entry.url === url && entry.output === output);
    assert.equal(task.status, "completed");
    const interruptRecord = async () => {
      const file = path.join(home, ".visuales-cli-cache", "download", "tasks.json");
      const store = JSON.parse(await fs.readFile(file, "utf8"));
      Object.assign(
        store.tasks.find((entry) => entry.id === task.id),
        {
          status: "interrupted",
          pid: undefined,
          completedAt: undefined,
          lastProgress: undefined,
          interruptedAt: Date.now() + 1,
        }
      );
      await fs.writeFile(file, JSON.stringify(store));
    };
    const requests = [];
    const observe = (req) => {
      if (req.url.startsWith("/VerifiedResume/") && !req.url.endsWith("/")) requests.push(req.url);
    };
    slowServer.on("request", observe);
    try {
      await interruptRecord();
      await promisify(execFile)(process.execPath, ["dist/cli.js", "tasks", "resume", task.id], cliOptions);
      assert.deepEqual(requests, [], "the CLI makes no requests for verified, unchanged files");
      await interruptRecord();
      await rpc.request("tasks.resume", { id: task.id });
      const completed = await waitForTask(task.id, "completed");
      assert.deepEqual(requests, [], "the packaged desktop worker shares the same fast resume path");
      assert.equal(completed.overallProgress.completedFiles, 2);
      assert.equal(completed.overallProgress.downloadedBytes, 2 * FILE_BODY.length);
      const details = await rpc.request("tasks.files", { id: task.id });
      assert.ok(details.files.every((file) => file.status === "completed"));
    } finally {
      slowServer.off("request", observe);
    }
  });

  it("preserves an existing CLI folder destination when resumed from desktop", async () => {
    const output = path.join(home, "legacy exact destination");
    const url = `${slowUrl}/Legacy/`;
    const cli = spawn(process.execPath, [path.resolve("dist/cli.js"), "download", url, "--output", output], {
      env: { ...process.env, HOME: home, USERPROFILE: home },
      stdio: "ignore",
    });
    const closed = once(cli, "close");
    try {
      await waitForPartial(output);
      const task = (await rpc.request("tasks.list")).find((entry) => entry.url === url && entry.output === output);
      assert.ok(task);
      await rpc.request("tasks.cancel", { id: task.id });
      await closed;
      await waitForTask(task.id, "interrupted");
      const resumed = await rpc.request("tasks.resume", { id: task.id });
      assert.equal(resumed.output, output);
      assert.equal(resumed.id, task.id);
      await waitForTask(task.id, "completed");
      assert.deepEqual(await fs.readFile(path.join(output, "episode.bin")), FILE_BODY);
      await assert.rejects(fs.access(path.join(output, "Legacy")));
    } finally {
      cli.kill();
      await closed;
    }
  });

  it("negotiates the protocol and survives invalid requests", async () => {
    assert.equal((await rpc.request("hello")).protocolVersion, 1);
    await assert.rejects(rpc.request("missing"), /Unknown method/);
    await assert.rejects(rpc.request("download.start", { urls: ["file:///etc/hosts"], output: home }), /HTTP/);
    assert.ok(Array.isArray(await rpc.request("tasks.list")));
    const snapshot = await rpc.request("tasks.snapshot");
    assert.ok(Array.isArray(snapshot.tasks));
    assert.equal(snapshot.summary.running, snapshot.tasks.filter((task) => task.status === "running").length);
    assert.equal(snapshot.summary.queued, snapshot.tasks.filter((task) => task.status === "queued").length);
  });

  it("uses the CLI search cache and stable aliases", async () => {
    const cache = path.join(home, ".visuales-cli-cache");
    await fs.mkdir(cache, { recursive: true });
    await fs.writeFile(
      path.join(cache, "list.json"),
      JSON.stringify({
        timestamp: Date.now(),
        html: '<a href="https://visuales.uclv.cu/Series/Example/">Example</a><a href="https://visuales.uclv.cu/Music/Other/">Other</a>',
      })
    );
    const result = await rpc.request("search", { terms: ["example"] });
    const library = await rpc.request("search", { terms: [] });
    assert.equal(library.results.length, 2, "an empty query returns even entries that did not match");
    assert.equal(library.totalResults, library.results.length);
    assert.ok(library.results.every((entry) => entry.downloadId));
    const scoped = await rpc.request("search", { terms: [], root: "https://visuales.uclv.cu/RpcFixtures/" });
    assert.deepEqual(
      scoped.results.map((entry) => entry.text),
      ["readme.txt"]
    );
    assert.equal(
      (await rpc.request("search", { terms: ["Other"], root: "https://visuales.uclv.cu/RpcFixtures/" })).totalResults,
      0
    );
    assert.equal(
      (await rpc.request("search", { terms: ["readme"], root: "https://visuales.uclv.cu/RpcFixtures/" })).totalResults,
      1
    );
    await assert.rejects(rpc.request("search", { terms: [], root: "https://evil.test/" }), /Only Visuales/);
    await assert.rejects(rpc.request("search", { terms: [], root: 3 }), /Search root/);
    await assert.rejects(rpc.request("search", { terms: [""] }), /nonempty string/);
    await assert.rejects(rpc.request("search", { terms: "" }), /array/);
    await assert.rejects(rpc.request("download.start", { urls: [] }), /nonempty array/);
    assert.equal(result.totalResults, 1);
    assert.ok(result.results[0].downloadId);
    const aliases = JSON.parse(await fs.readFile(path.join(cache, "search-aliases.json"), "utf8"));
    assert.equal(aliases.entries[result.results[0].downloadId], result.results[0].encodedUrl);
  });

  it("repairs a truncated response using the existing Node verification engine", async () => {
    const output = path.join(home, "repair output");
    const task = await rpc.request("download.start", { urls: [server.url("truncate", "repair.bin")], output });
    await waitForTask(task.id, "completed");
    assert.deepEqual(await fs.readFile(path.join(output, "repair.bin")), FILE_BODY);
    assert.ok(
      server.requests.some(
        (request) => request.file === "repair.bin" && request.range?.startsWith(`bytes=${server.truncatedSize}-`)
      )
    );
    const cli = spawn(process.execPath, [path.resolve("dist/cli.js"), "tasks", "--all"], {
      env: { ...process.env, HOME: home, USERPROFILE: home },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let display = "";
    cli.stdout.on("data", (chunk) => {
      display += chunk;
    });
    cli.stderr.on("data", (chunk) => {
      display += chunk;
    });
    const [code] = await once(cli, "close");
    assert.equal(code, 0, display);
    assert.match(display, new RegExp(task.id));
    assert.match(display, /completed/);
  });

  it("CLI and desktop report unverifiable downloads as failed and retain only partial output", async () => {
    for (const desktop of [false, true]) {
      const output = path.join(home, desktop ? "unverified desktop" : "unverified cli");
      const url = server.url("unverifiable", "short.bin");
      let task;
      if (desktop) {
        task = await rpc.request("download.start", { urls: [url], output });
      } else {
        await assert.rejects(
          promisify(execFile)(
            process.execPath,
            [
              path.resolve("dist/cli.js"),
              "download",
              url,
              "--output",
              output,
              "--connections",
              "1",
              "--max-retries",
              "0",
            ],
            {
              env: { ...process.env, HOME: home, USERPROFILE: home },
            }
          ),
          (error) => {
            assert.notEqual(error.code, 0);
            assert.match(error.stdout + error.stderr, /Could not verify download completion/);
            return true;
          }
        );
        task = (await rpc.request("tasks.list")).find((candidate) => candidate.output === output);
      }
      const failed = await waitForTask(task.id, "failed");
      assert.notEqual(failed.status, "completed");
      const details = await rpc.request("tasks.files", { id: task.id });
      assert.equal(details.files[0].status, "failed");
      assert.equal(details.files[0].verified, false);
      assert.match(details.files[0].error, /Could not verify download completion/);
      await assert.rejects(fs.stat(path.join(output, "short.bin")), { code: "ENOENT" });
      assert.equal((await fs.stat(path.join(output, ".visuales-parts", "short.bin"))).size, server.truncatedSize);
    }
  });

  it("CLI and desktop persist reconciled failure bytes before publishing terminal task status", async (t) => {
    const fixture = http.createServer((req, res) => {
      if (req.url.endsWith("/")) {
        res.end(
          '<pre><a href="good.bin">good.bin</a> 16-Sep-2026 09:00 10\n<a href="broken.bin">broken.bin</a> 16-Sep-2026 09:00 1000</pre>'
        );
        return;
      }
      if (req.url.endsWith("good.bin")) {
        res.writeHead(200, { "content-length": 10 });
        res.end(req.method === "HEAD" ? undefined : Buffer.alloc(10, 65));
        return;
      }
      if (req.method === "HEAD") {
        res.writeHead(200, { "content-length": 1000 });
        res.end();
        return;
      }
      const probe = /^bytes=(\d+)-\1$/.exec(req.headers.range ?? "");
      if (probe) {
        res.writeHead(206, {
          "content-length": 1,
          "content-range": `bytes ${probe[1]}-${probe[1]}/1000`,
          etag: '"reset"',
        });
        res.end("x");
        return;
      }
      // Reject the old prefix, then fail after either zero or 100 new bytes.
      res.writeHead(200, { "content-length": 1000 });
      res.flushHeaders();
      if (req.url.startsWith("/single/")) res.write(Buffer.alloc(100, 66));
      const timer = setTimeout(() => res.destroy(), 30);
      res.once("close", () => clearTimeout(timer));
    });
    await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));
    t.after(async () => {
      fixture.closeAllConnections();
      await new Promise((resolve) => fixture.close(resolve));
    });
    const initial = await rpc.request("settings.get");
    try {
      await rpc.request("settings.save", {
        settings: { ...initial.settings, concurrent: 1, connections: 1, maxRetries: 0, exclude: [] },
      });
      for (const desktop of [false, true]) {
        for (const folder of [false, true]) {
          const base = path.join(home, `failure-checkpoint-${desktop}-${folder}`);
          const output = desktop && folder ? path.join(base, "folder") : base;
          const url = `http://127.0.0.1:${fixture.address().port}/${folder ? "folder/" : "single/broken.bin"}`;
          const partial = path.join(output, ".visuales-parts", "broken.bin");
          await fs.mkdir(path.dirname(partial), { recursive: true });
          await fs.writeFile(partial, Buffer.alloc(400, 65));
          let task;
          if (desktop) task = await rpc.request("download.start", { urls: [url], output: base });
          else {
            await assert.rejects(
              promisify(execFile)(
                process.execPath,
                [
                  path.resolve("dist/cli.js"),
                  "download",
                  url,
                  "--output",
                  output,
                  "--concurrent",
                  "1",
                  "--connections",
                  "1",
                  "--max-retries",
                  "0",
                ],
                { env: { ...process.env, HOME: home, USERPROFILE: home }, timeout: 30000 }
              )
            );
            task = (await rpc.request("tasks.list")).find((entry) => entry.output === output);
          }
          const failed = await waitForTask(task.id, "failed");
          const details = (await rpc.request("tasks.files", { id: task.id })).files;
          const expectedBytes = folder ? 0 : 100;
          assert.equal((await fs.stat(partial)).size, expectedBytes);
          const broken = details.find((file) => file.path === "broken.bin");
          assert.equal(broken.downloadedBytes, expectedBytes);
          assert.equal(broken.status, "failed");
          assert.equal(broken.verified, false);
          await assert.rejects(fs.stat(path.join(output, "broken.bin")), { code: "ENOENT" });
          assert.equal(failed.lastProgress.fileName, "broken.bin");
          assert.equal(failed.lastProgress.downloadedSize, expectedBytes);
          assert.equal(failed.lastProgress.speed, "0 B/s");
          if (folder) {
            assert.equal(
              failed.overallProgress.downloadedBytes,
              10,
              "retain the successful sibling, not the old prefix"
            );
            assert.equal(failed.overallProgress.completedFiles, 1);
            assert.equal(failed.overallProgress.totalFiles, 2);
            assert.equal(failed.overallProgress.speedBytes, 0);
            assert.deepEqual(failed.overallProgress.activeFiles, []);
          }
        }
      }
    } finally {
      await rpc.request("settings.save", { settings: initial.settings });
    }
  });

  it("preserves concurrent task updates and reports failures", async () => {
    const jobs = await Promise.all(
      ["first", "second", "third"].map((name) =>
        rpc.request("download.start", {
          urls: [server.url("normal", `${name}.bin`)],
          output: path.join(home, name),
        })
      )
    );
    for (const job of jobs) await waitForTask(job.id, "completed");
    const failed = await rpc.request("download.start", {
      urls: [server.url("unavailable", "blocked.bin")],
      output: path.join(home, "blocked"),
    });
    const result = await waitForTask(failed.id, "failed");
    assert.ok(result.lastError);
    const details = await rpc.request("tasks.files", { id: failed.id });
    assert.equal(details.files[0].status, "failed");
    assert.ok(details.files[0].error);
    await assert.rejects(rpc.request("tasks.files", { id: "../../missing-task" }), /not found/);
    await assert.rejects(fs.access(path.join(home, "blocked", "blocked.bin")));
  });

  it("notifies once per desktop run, without history, CLI transfers, interruptions, or disabled events", async () => {
    const client = await startRpc();
    const original = (await client.request("settings.get")).settings;
    const drain = () => client.request("notifications.take");
    async function waitForNotice() {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const notices = await drain();
        if (notices.length) return notices;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.fail("Expected a terminal notification event");
    }
    async function settled(id, status) {
      await waitForTask(id, status, client);
      // The terminal event is flushed before the worker exits; let close cleanup finish.
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    try {
      assert.deepEqual(await drain(), [], "new sidecar must not replay shared history");
      await client.request("settings.save", {
        settings: { ...original, notifyCompleted: true, notifyFailed: true, maxRetries: 0 },
      });
      const task = await client.request("download.start", {
        urls: [server.url("normal", "notification.bin")],
        output: path.join(home, "notification-complete"),
      });
      const [notice] = await waitForNotice();
      assert.equal(notice.taskId, task.id);
      assert.equal(notice.status, "completed");
      assert.equal(notice.name, "notification.bin");
      assert.ok(Date.now() - notice.at < 10000);
      await settled(task.id, "completed");
      await client.request("tasks.snapshot");
      assert.deepEqual(await drain(), [], "polls and worker close do not repeat notifications");
      const observer = await startRpc();
      try {
        assert.deepEqual(await observer.request("notifications.take"), [], "another desktop session stays quiet");
      } finally {
        await observer.close();
      }

      const failed = await client.request("download.start", {
        urls: [server.url("unavailable", "notification-blocked.bin")],
        output: path.join(home, "notification-failed"),
      });
      assert.equal((await waitForNotice())[0].status, "failed");
      await settled(failed.id, "failed");
      await client.request("tasks.resume", { id: failed.id });
      assert.equal((await waitForNotice())[0].taskId, failed.id, "a resumed run can notify again");
      await settled(failed.id, "failed");
      assert.deepEqual(await drain(), []);

      const canceled = await client.request("download.start", {
        urls: [`${slowUrl}/notification-cancel.bin`],
        output: path.join(home, "notification-cancel"),
      });
      await client.request("tasks.cancel", { id: canceled.id });
      await settled(canceled.id, "interrupted");
      assert.deepEqual(await drain(), [], "manual interruptions never notify");

      const cli = spawn(
        process.execPath,
        [
          path.resolve("dist/cli.js"),
          "download",
          server.url("normal", "notification-cli.bin"),
          "--output",
          path.join(home, "notification-cli"),
        ],
        {
          env: { ...process.env, HOME: home, USERPROFILE: home },
          stdio: "ignore",
        }
      );
      assert.equal((await once(cli, "close"))[0], 0);
      await client.request("tasks.snapshot");
      assert.deepEqual(await drain(), [], "CLI completion never creates a desktop event");

      for (const [notifyCompleted, notifyFailed] of [
        [false, true],
        [true, false],
        [false, false],
      ]) {
        await client.request("settings.save", {
          settings: { ...original, maxRetries: 0, notifyCompleted, notifyFailed },
        });
        const complete = await client.request("download.start", {
          urls: [server.url("normal", "muted.bin")],
          output: path.join(home, `notification-muted-${notifyCompleted}-${notifyFailed}`),
        });
        await settled(complete.id, "completed");
        assert.equal((await drain()).length, Number(notifyCompleted));
        await client.request("tasks.resume", { id: failed.id });
        await settled(failed.id, "failed");
        assert.equal((await drain()).length, Number(notifyFailed));
      }
      await client.request("settings.save", { settings: original });
      assert.deepEqual(await drain(), [], "reenabling preferences does not replay muted events");
    } finally {
      await client.request("settings.save", { settings: original });
      await client.close();
    }
  });

  it("cancels and resumes a partial download without restarting from zero", async () => {
    const output = path.join(home, "resumable");
    const task = await rpc.request("download.start", { urls: [`${slowUrl}/resume.bin`], output });
    const partial = path.join(output, ".visuales-parts", "resume.bin.part");
    // Wait for bytes on disk rather than assuming a worker startup time.
    const deadline = Date.now() + 15000;
    let partFile;
    while (Date.now() < deadline) {
      const files = await fs.readdir(path.dirname(partial)).catch(() => []);
      partFile = files[0] && path.join(path.dirname(partial), files[0]);
      if (partFile && (await fs.stat(partFile)).size > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(partFile);
    await rpc.request("tasks.cancel", { id: task.id });
    await waitForTask(task.id, "interrupted");
    const size = (await fs.stat(partFile)).size;
    assert.ok(size > 0 && size < FILE_BODY.length);
    await rpc.request("tasks.resume", { id: task.id });
    await waitForTask(task.id, "completed");
    assert.deepEqual(await fs.readFile(path.join(output, "resume.bin")), FILE_BODY);
    await rpc.request("tasks.delete", { id: task.id });
    assert.ok(!(await rpc.request("tasks.list")).some((entry) => entry.id === task.id));
    assert.deepEqual(await fs.readFile(path.join(output, "resume.bin")), FILE_BODY);
  });

  it("queues behind an active transfer and starts after it completes", async () => {
    const first = await rpc.request("download.start", {
      urls: [`${slowUrl}/queue-first.bin`],
      output: path.join(home, "queue-first"),
    });
    const second = await rpc.request("download.start", {
      urls: [server.url("normal", "queue-second.bin")],
      output: path.join(home, "queue-second"),
      queue: true,
    });
    assert.equal(second.status, "queued");
    assert.equal((await rpc.request("tasks.list")).find((entry) => entry.id === second.id).status, "queued");
    await waitForTask(first.id, "completed");
    await waitForTask(second.id, "completed");
  });

  it("stops owned workers on disconnect and leaves tasks resumable", async () => {
    const other = await startRpc();
    const task = await other.request("download.start", {
      urls: [`${slowUrl}/closing.bin`],
      output: path.join(home, "closing"),
    });
    await other.close();
    const interrupted = await waitForTask(task.id, "interrupted");
    assert.notEqual(interrupted.status, "completed");
    assert.throws(() => process.kill(task.pid, 0));
  });
  it("quitting an instance stops its running and queued workers but lets a real CLI transfer finish", async () => {
    const owner = await startRpc();
    const output = path.join(home, "quit cli survives");
    const cliUrl = `${slowUrl}/cli-survives.bin`;
    const cli = spawn(process.execPath, [path.resolve("dist/cli.js"), "download", cliUrl, "--output", output], {
      env: { ...process.env, HOME: home, USERPROFILE: home },
      stdio: "ignore",
    });
    const closed = once(cli, "close");
    let ownerClosed = false;
    try {
      await waitForPartial(output);
      const running = await owner.request("download.start", {
        urls: [`${slowUrl}/owned-closing.bin`],
        output: path.join(home, "owned closing"),
      });
      const queued = await owner.request("download.start", {
        urls: [`${slowUrl}/queued-closing.bin`],
        output: path.join(home, "queued closing"),
        queue: true,
      });
      await waitForPartial(running.output);
      const summary = await owner.request("tasks.prepareQuit");
      assert.equal(summary.ownedRunning, 1);
      assert.equal(summary.ownedQueued, 1);
      assert.ok(summary.running > summary.ownedRunning, "CLI is counted but not owned");
      await owner.close();
      ownerClosed = true;
      await waitForTask(running.id, "interrupted");
      await waitForTask(queued.id, "interrupted");
      const [exitCode] = await closed;
      assert.equal(exitCode, 0);
      assert.deepEqual(await fs.readFile(path.join(output, "cli-survives.bin")), FILE_BODY);
      const history = await rpc.request("tasks.list");
      const completed = history.find((task) => task.url === cliUrl);
      assert.equal(completed.status, "completed");
      assert.equal(completed.lastProgress.url, cliUrl, "CLI persists canonical file identity alongside progress");
    } finally {
      if (!ownerClosed) await owner.close();
      cli.kill();
      await closed;
    }
  });
});
