import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
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
  it("serves cached directory listings and file previews through the packaged RPC adapter", async () => {
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
    await assert.rejects(rpc.request("library.preview", { url: "file:///etc/passwd" }), /Only Visuales/);
    await assert.rejects(rpc.request("library.list", { url: "https://example.com/" }), /Only Visuales/);
    const registry = JSON.parse(await fs.readFile(path.join(root, "index.json"), "utf8"));
    assert.ok(registry.entries.some((entry) => entry.id === "previews"));
    assert.deepEqual(await rpc.request("tasks.list"), [], "browsing never creates a transfer");
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
    await assert.rejects(fs.access(path.join(home, "blocked", "blocked.bin")));
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
