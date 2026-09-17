import { beforeEach, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  runSearchIndexer,
  getSearchIndexStatus,
  controlSearchIndex,
  indexSeedUrls,
} from "../packages/core/dist/search-indexer.js";
import { readFileIndex } from "../packages/core/dist/search-file-index.js";
import { startDownloadTask, listDownloadTasks } from "../packages/core/dist/download/tasks.js";
import { fetchInteractiveLibraryResource, LibraryRequestError } from "../packages/core/dist/library-listing.js";
import { searchIndexLabel } from "../packages/core/dist/search-index-types.js";

const base = "https://visuales.uclv.cu";
let home;
beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "visuales-indexer-"));
  process.env.HOME = process.env.USERPROFILE = home;
});
afterEach(async () => {
  await fs.rm(home, { recursive: true, force: true });
});
const defaults = () => ({
  signal: new AbortController().signal,
  interval: 0,
  busy: async () => false,
  policy: async () => ({ allowed: () => true, delay: 0 }),
});
const listing = (url) => ({ files: [{ url: `${url}film.mkv`, size: 42 }], dirs: [] });

test("seeds retain listado order, append ancestors/root and do not favor Recientes", () => {
  assert.deepEqual(
    indexSeedUrls([`${base}/Movies/2026/`, `${base}/Recientes/`, `${base}/Movies/2026/`, "https://evil.test/"]),
    [`${base}/Movies/2026/`, `${base}/Recientes/`, `${base}/Movies/`, `${base}/`]
  );
});

test("indexes in FIFO order, appends discovered folders, reuses fresh snapshots and refreshes explicitly", async () => {
  const calls = [];
  const options = {
    ...defaults(),
    seeds: async () => [`${base}/Movies/`, `${base}/Recientes/`],
    listing: async (url) => {
      calls.push(url);
      return { ...listing(url), dirs: url.endsWith("/Movies/") ? [`${base}/Movies/Extra/`] : [] };
    },
  };
  await runSearchIndexer(options);
  assert.deepEqual(calls, [`${base}/Movies/`, `${base}/Recientes/`, `${base}/Movies/Extra/`]);
  let status = await getSearchIndexStatus();
  assert.equal(status.phase, "complete");
  assert.equal(status.files, 3);
  assert.equal(status.completed, 3);
  await runSearchIndexer(options);
  assert.equal(calls.length, 3, "restart does not refetch completed folders");
  await controlSearchIndex("refresh");
  await runSearchIndexer(options);
  assert.equal(calls.length, 6);
  status = await getSearchIndexStatus();
  assert.equal(status.failed, 0);
});

test("pause cancels a slow fetch, survives restart, and resume does not discard existing records", async () => {
  let started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const run = runSearchIndexer({
    ...defaults(),
    seeds: async () => [`${base}/Slow/`],
    listing: async (_url, signal) => {
      started();
      return new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
      );
    },
  });
  await ready;
  await controlSearchIndex("pause");
  await run;
  assert.equal((await getSearchIndexStatus()).phase, "paused");
  await runSearchIndexer({
    ...defaults(),
    listing: async () => {
      throw new Error("must stay paused");
    },
  });
  await controlSearchIndex("resume");
  await runSearchIndexer({ ...defaults(), listing: async (url) => listing(url) });
  assert.equal((await getSearchIndexStatus()).files, 1);
});

test("a second scanner cannot fetch while the owner is active, and failure retains prior results", async () => {
  let finish, started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const first = runSearchIndexer({
    ...defaults(),
    seeds: async () => [`${base}/A/`],
    listing: async (url) => {
      started();
      return new Promise((resolve) => {
        finish = () => resolve(listing(url));
      });
    },
  });
  await ready;
  await runSearchIndexer({
    ...defaults(),
    seeds: async () => {
      throw new Error("duplicate scanner");
    },
  });
  finish();
  await first;
  await controlSearchIndex("refresh");
  await runSearchIndexer({
    ...defaults(),
    seeds: async () => [`${base}/A/`],
    listing: async () => {
      throw new Error("offline");
    },
  });
  const status = await getSearchIndexStatus();
  assert.equal(status.failed, 1);
  assert.equal(status.files, 1);
  assert.equal((await readFileIndex()).directories.get(`${base}/A/`).entries.length, 1);
});

test("crawl exclusions count as skipped, not complete coverage", async () => {
  await runSearchIndexer({
    ...defaults(),
    seeds: async () => [`${base}/No/`],
    policy: async () => ({ allowed: () => false, delay: 0 }),
    listing: async () => {
      throw new Error("disallowed fetch");
    },
  });
  const status = await getSearchIndexStatus();
  assert.equal(status.phase, "partial");
  assert.equal(status.skipped, 1);
  assert.equal(status.files, 0);
});

test("interactive browsing defers network work but does not turn a completed pass into waiting", async () => {
  const abort = new AbortController();
  let waiting;
  const ready = new Promise((resolve) => {
    waiting = resolve;
  });
  const run = runSearchIndexer({
    ...defaults(),
    signal: abort.signal,
    busy: async () => true,
    seeds: async () => {
      throw new Error("busy scanner must not fetch seeds");
    },
    onChange: () => waiting(),
  });
  await ready;
  assert.equal((await getSearchIndexStatus()).phase, "waiting");
  abort.abort();
  await run;
  await runSearchIndexer({ ...defaults(), seeds: async () => [`${base}/A/`], listing: async (url) => listing(url) });
  await runSearchIndexer({ ...defaults(), busy: async () => true });
  assert.equal((await getSearchIndexStatus()).phase, "complete");
});

test("production crawl continues during a running download without fetching file contents", async () => {
  await startDownloadTask(`${base}/Downloading/`, {
    output: home,
    resume: true,
    maxRetries: 3,
    timeout: Infinity,
    concurrent: 5,
    connections: 3,
    compact: false,
    exclude: [],
  });
  assert.equal((await listDownloadTasks())[0].status, "running");
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(new URL(url).pathname);
    assert.match(options.headers["User-Agent"], /VisualesIndexer/);
    const route = new URL(url).pathname;
    if (route === "/robots.txt") {
      const status = await getSearchIndexStatus();
      assert.equal(status.phase, "indexing", "initial network work must not retain a waiting/idle label");
      assert.equal(searchIndexLabel(status), "Preparing file index");
      return new Response("", { status: 404 });
    }
    if (route === "/listado.html") return new Response(`<a href="${base}/A/">A</a>`);
    if (route === "/A/")
      return new Response('<title>Index of /A</title><pre><a href="film.mkv">film.mkv</a> 2026-09-17 12:00 42</pre>');
    if (route === "/") return new Response('<title>Index of /</title><pre><a href="A/">A</a></pre>');
    throw new Error(`Unexpected payload request: ${url}`);
  };
  try {
    await runSearchIndexer({ signal: AbortSignal.timeout(3000), interval: 0 });
    assert.deepEqual(calls, ["/robots.txt", "/listado.html", "/A/", "/"]);
    assert.equal((await getSearchIndexStatus()).phase, "complete");
    assert.equal((await getSearchIndexStatus()).files, 1);
    assert.equal((await listDownloadTasks())[0].status, "running", "indexing leaves transfers alone");
  } finally {
    globalThis.fetch = original;
  }
});

test("production scheduling waits for foreground browsing and then resumes serial listing requests", async () => {
  const original = globalThis.fetch;
  let finishBrowse;
  globalThis.fetch = () => new Promise((resolve) => (finishBrowse = () => resolve(new Response("folder contents"))));
  const browse = fetchInteractiveLibraryResource(`${base}/Browsing/`, 1024);
  let waiting;
  const ready = new Promise((resolve) => (waiting = resolve));
  let seeds = 0;
  let active = 0;
  let peak = 0;
  const calls = [];
  const run = runSearchIndexer({
    ...defaults(),
    signal: AbortSignal.timeout(5000),
    busy: undefined,
    seeds: async () => {
      seeds++;
      return [`${base}/A/`, `${base}/B/`];
    },
    onChange: () => waiting(),
    listing: async (url) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      calls.push(url);
      active--;
      return listing(url);
    },
  });
  try {
    await ready;
    const status = await getSearchIndexStatus();
    assert.equal(status.phase, "waiting");
    assert.equal(searchIndexLabel(status), "Indexing - waiting for folder browsing");
    assert.equal(seeds, 0, "foreground browsing gets priority over starting the crawl");
    finishBrowse();
    await browse;
    await run;
    assert.deepEqual(calls, [`${base}/A/`, `${base}/B/`]);
    assert.equal(peak, 1, "only one background listing request can be in flight");
    assert.equal((await getSearchIndexStatus()).phase, "complete");
  } finally {
    finishBrowse();
    await browse;
    await run;
    globalThis.fetch = original;
  }
});

for (const throttled of [false, true]) {
  test(`indexing backs off after ${throttled ? "server throttling" : "a timeout"}`, async () => {
    const retryAt = Date.now() + 60000;
    let requests = 0;
    await runSearchIndexer({
      ...defaults(),
      seeds: async () => [`${base}/Slow/`],
      listing: async () => {
        requests++;
        if (throttled) throw new LibraryRequestError("Throttled", 429, retryAt);
        throw new Error("Request timed out");
      },
    });
    const status = await getSearchIndexStatus();
    assert.equal(requests, 1);
    assert.equal(status.phase, "offline");
    assert.equal(status.failed, 1);
    assert.ok(status.retryAt > Date.now());
    if (throttled) assert.ok(status.retryAt >= retryAt, "honor the server's retry delay");
  });
}
