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
import { readFileIndex, publishIndexedDirectory } from "../packages/core/dist/search-file-index.js";
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

async function editCheckpoint(edit) {
  const file = path.join(home, ".visuales-cli-cache/file-index/scan.json");
  const state = JSON.parse(await fs.readFile(file, "utf8"));
  edit(state);
  await fs.writeFile(file, JSON.stringify(state));
}

test("overdue retries cannot be starved by the first repeatedly failing folder", async () => {
  const first = `${base}/First/`;
  const second = `${base}/Second/`;
  await runSearchIndexer({ ...defaults(), seeds: async () => [first, second], listing: async (url) => listing(url) });
  await editCheckpoint((state) => {
    state.errors = Object.fromEntries(
      [first, second].map((url) => [url, { message: "Library request failed (503)", status: 503, retryAt: 0 }])
    );
    state.forceSince = Date.now() + 1;
  });
  const calls = [];
  const options = {
    ...defaults(),
    listing: async (url) => {
      calls.push(url);
      if (url === first) throw new LibraryRequestError("Library request failed (503)", 503);
      return listing(url);
    },
  };
  await runSearchIndexer(options);
  await editCheckpoint((state) => {
    state.retryAt = 0;
    state.errors[first].retryAt = Date.now() - 1;
  });
  await runSearchIndexer(options);
  assert.deepEqual(calls.slice(0, 2), [first, second]);
  assert.equal((await getSearchIndexStatus()).failed, 1);
});

test("persistent folder failures exhaust a durable budget without removing cached files", async () => {
  const url = `${base}/Persistent/`;
  await publishIndexedDirectory(url, listing(url));
  await controlSearchIndex("refresh");
  let requests = 0;
  const options = {
    ...defaults(),
    seeds: async () => [url],
    listing: async () => {
      requests++;
      throw new LibraryRequestError("Library request failed (503)", 503);
    },
  };
  for (let attempt = 0; attempt < 5; attempt++) {
    await runSearchIndexer(options);
    await editCheckpoint((state) => {
      state.retryAt = 0;
      for (const error of Object.values(state.errors)) error.retryAt = 0;
    });
  }
  assert.equal(requests, 3, "restarting the scanner must not reset a folder's attempt budget");
  const status = await getSearchIndexStatus();
  assert.equal(status.phase, "partial");
  assert.equal(status.failed, 1);
  assert.equal(status.deferred, 1);
  assert.equal(status.skipped, 0, "a 503 is not proof of removal");
  assert.equal(status.files, 1);
  assert.equal(status.retryAt, undefined);
  await controlSearchIndex("resume");
  await runSearchIndexer({ ...defaults(), listing: async (url) => listing(url) });
  const recovered = await getSearchIndexStatus();
  assert.equal(recovered.phase, "complete");
  assert.equal(recovered.completed, 1);
  assert.equal(recovered.deferred, 0);
});

test("daily discovery resets an exhausted budget and rechecks skipped folders", async () => {
  const url = `${base}/ReturnsTomorrow/`;
  await runSearchIndexer({
    ...defaults(),
    seeds: async () => [url],
    listing: async () => {
      throw new LibraryRequestError("Library request failed (503)", 503);
    },
  });
  await editCheckpoint((state) => {
    state.startedAt = Date.now() - 86400001;
    state.retryAt = 0;
    Object.assign(state.errors[url], { attempts: 3, deferred: true });
  });
  let seeded = false;
  const calls = [];
  await runSearchIndexer({
    ...defaults(),
    seeds: async () => {
      seeded = true;
      return [url];
    },
    listing: async (url) => {
      calls.push(url);
      return listing(url);
    },
  });
  assert.equal(seeded, true);
  assert.deepEqual(calls, [url]);
  assert.equal((await getSearchIndexStatus()).phase, "complete");
});

for (const action of ["resume", "refresh"]) {
  test(`${action} does not override the server's Retry-After deadline`, async () => {
    const retryAt = Date.now() + 60000;
    await runSearchIndexer({
      ...defaults(),
      seeds: async () => [`${base}/Throttled/`],
      listing: async () => {
        throw new LibraryRequestError("Library request failed (503)", 503, retryAt);
      },
    });
    const status = await controlSearchIndex(action);
    assert.equal(status.retryAt, retryAt);
    let requests = 0;
    await runSearchIndexer({
      ...defaults(),
      signal: AbortSignal.timeout(100),
      seeds: async () => {
        requests++;
        return [];
      },
      listing: async (url) => {
        requests++;
        return listing(url);
      },
    });
    assert.equal(requests, 0, "even a fresh pass must honor the server cooldown");
  });
}

test("finished passes report exceptions without pretending all folders were indexed", () => {
  const status = {
    phase: "offline",
    files: 490727,
    completed: 29643,
    total: 30057,
    failed: 1,
    skipped: 413,
    running: true,
    revision: "fixture",
  };
  assert.equal(searchIndexLabel(status), "Scan finished with exceptions");
  assert.equal(searchIndexLabel({ ...status, phase: "partial", deferred: 1 }), "Scan finished with exceptions");
  assert.equal(searchIndexLabel({ ...status, completed: 29000 }), "File indexing - retrying later");
});

test("continuous indexing settles after its final deferred error instead of retrying forever", async () => {
  const url = `${base}/Last/`;
  await runSearchIndexer({
    ...defaults(),
    seeds: async () => [url],
    listing: async () => {
      throw new LibraryRequestError("Library request failed (503)", 503);
    },
  });
  await editCheckpoint((state) => {
    state.retryAt = 0;
    Object.assign(state.errors[url], { retryAt: 0, attempts: 2 });
  });
  let requests = 0;
  const now = Date.now;
  let offset = 0;
  Date.now = () => now() + offset;
  try {
    await runSearchIndexer({
      ...defaults(),
      continuous: true,
      signal: AbortSignal.timeout(1500),
      listing: async () => {
        requests++;
        throw new LibraryRequestError("Library request failed (503)", 503);
      },
      onChange: () => {
        offset += 300001;
      },
    });
  } finally {
    Date.now = now;
  }
  assert.equal(requests, 1);
  const status = await getSearchIndexStatus();
  assert.equal(status.phase, "partial");
  assert.equal(status.deferred, 1);
  assert.equal(status.retryAt, undefined);
});

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

for (const statusCode of [403, 404, 410]) {
  test(`a folder ${statusCode} does not stop unrelated indexing or claim the server is offline`, async () => {
    const calls = [];
    const states = [];
    await runSearchIndexer({
      ...defaults(),
      signal: AbortSignal.timeout(1500),
      seeds: async () => [`${base}/Unavailable/`, `${base}/Available/`],
      listing: async (url) => {
        calls.push(url);
        if (url.endsWith("/Unavailable/"))
          throw new LibraryRequestError(`Library request failed (${statusCode})`, statusCode);
        return listing(url);
      },
      onChange: () => states.push(getSearchIndexStatus()),
    });
    assert.deepEqual(calls, [`${base}/Unavailable/`, `${base}/Available/`]);
    const status = await getSearchIndexStatus();
    assert.equal(status.completed, 1);
    assert.equal(status.failed, 0);
    assert.equal(status.skipped, 1);
    assert.equal(status.phase, "partial");
    assert.equal(status.retryAt, undefined);
    assert.ok((await Promise.all(states)).every((state) => state.phase !== "offline"));
  });
}

test("missing branches defer descendants, retain cached files, and retry descendants when the parent returns", async () => {
  const missing = `${base}/Missing/`;
  const child = `${missing}Child/`;
  await publishIndexedDirectory(child, listing(child));
  const calls = [];
  await runSearchIndexer({
    ...defaults(),
    signal: AbortSignal.timeout(1500),
    seeds: async () => [missing, child, `${base}/MissingSibling/`],
    listing: async (url) => {
      calls.push(url);
      if (url === missing) throw new LibraryRequestError("Library request failed (404)", 404);
      return listing(url);
    },
  });
  assert.deepEqual(calls, [missing, `${base}/MissingSibling/`]);
  const status = await getSearchIndexStatus();
  assert.equal(status.total, 3);
  assert.equal(status.failed, 0);
  assert.equal(status.skipped, 2);
  assert.equal(status.completed, 1);
  assert.equal(status.files, 2, "a 404 never erases cached search results");
  await controlSearchIndex("resume");
  await runSearchIndexer({ ...defaults(), listing: async (url) => listing(url) });
  const recovered = await getSearchIndexStatus();
  assert.equal(recovered.phase, "complete");
  assert.equal(recovered.total, 3, "recovery must not duplicate queue entries");
  assert.equal(recovered.completed, 3);
  assert.equal(recovered.failed, 0);
  assert.equal(recovered.skipped, 0);
});

test("legacy missing-branch failures resume without the old global backoff or child requests", async () => {
  await readFileIndex();
  const directory = path.join(home, ".visuales-cli-cache", "file-index");
  const meta = JSON.parse(await fs.readFile(path.join(directory, "meta.json"), "utf8"));
  const root = `${base}/Gone/`;
  const child = `${root}Child/`;
  const grandchild = `${child}Nested/`;
  await fs.writeFile(
    path.join(directory, "scan.json"),
    JSON.stringify({
      generation: meta.generation,
      run: "legacy",
      paused: false,
      phase: "offline",
      queue: [root, child, grandchild, `${base}/Available/`],
      cursor: 2,
      errors: Object.fromEntries(
        [root, child].map((url) => [url, { message: "Library request failed (404)", retryAt: Date.now() + 86400000 }])
      ),
      skipped: [],
      startedAt: Date.now(),
      forceSince: 0,
      error: "Library request failed (404)",
      retryAt: Date.now() + 300000,
    })
  );
  const calls = [];
  await runSearchIndexer({
    ...defaults(),
    signal: AbortSignal.timeout(1500),
    listing: async (url) => {
      calls.push(url);
      return listing(url);
    },
  });
  assert.deepEqual(calls, [`${base}/Available/`]);
  const status = await getSearchIndexStatus();
  assert.equal(status.failed, 0);
  assert.equal(status.skipped, 3);
  assert.equal(status.completed, 1);
  assert.equal(status.phase, "partial");
});

test("a missing branch skips hundreds of consecutive descendants in one checkpoint", async (t) => {
  const root = `${base}/Missing/`;
  const children = Array.from({ length: 411 }, (_, i) => `${root}Folder${i}/`);
  const calls = [];
  let changes = 0;
  const started = performance.now();
  await runSearchIndexer({
    ...defaults(),
    signal: AbortSignal.timeout(3000),
    seeds: async () => [root, ...children, `${base}/Available/`],
    listing: async (url) => {
      calls.push(url);
      if (url === root) throw new LibraryRequestError("Library request failed (404)", 404);
      return listing(url);
    },
    onChange: () => changes++,
  });
  assert.deepEqual(calls, [root, `${base}/Available/`]);
  assert.ok(changes < 10, "skipped descendants must not rewrite the entire queue for each folder");
  const status = await getSearchIndexStatus();
  assert.equal(status.failed, 0);
  assert.equal(status.skipped, 412);
  assert.equal(status.completed, 1);
  t.diagnostic(
    `412-folder missing branch: ${calls.length} requests including healthy sibling, ${(performance.now() - started).toFixed(1)} ms`
  );
});

test("missing descendants separated by healthy folders are still deferred, but 403 does not prune a subtree", async () => {
  const calls = [];
  const gone = `${base}/Gone/`;
  const denied = `${base}/Denied/`;
  await runSearchIndexer({
    ...defaults(),
    seeds: async () => [gone, `${base}/Healthy/`, `${gone}Nested/`, denied, `${denied}Accessible/`],
    listing: async (url) => {
      calls.push(url);
      if (url === gone) throw new LibraryRequestError("Not found", 410);
      if (url === denied) throw new LibraryRequestError("Forbidden", 403);
      return listing(url);
    },
  });
  assert.deepEqual(calls, [gone, `${base}/Healthy/`, denied, `${denied}Accessible/`]);
  const status = await getSearchIndexStatus();
  assert.equal(status.completed, 2);
  assert.equal(status.failed, 0);
  assert.equal(status.skipped, 3);
});

test("an unavailable parent can recover across a restart without resetting completed coverage", async () => {
  const root = `${base}/Gone/`;
  const child = `${root}Child/`;
  const controller = new AbortController();
  const remaining = `${base}/Remaining/`;
  const initial = {
    ...defaults(),
    seeds: async () => [root, child, remaining],
    listing: async (url) => {
      if (url === root) throw new LibraryRequestError("Not found", 404);
      controller.abort();
      return listing(url);
    },
  };
  await runSearchIndexer({ ...initial, signal: controller.signal });
  assert.equal((await getSearchIndexStatus()).skipped, 2);
  await controlSearchIndex("resume");
  const calls = [];
  await runSearchIndexer({
    ...defaults(),
    listing: async (url) => {
      calls.push(url);
      return { ...listing(url), dirs: url === root ? [child, `${root}NewChild/`] : [] };
    },
  });
  assert.deepEqual(calls, [remaining, root, child, `${root}NewChild/`]);
  const status = await getSearchIndexStatus();
  assert.equal(status.phase, "complete");
  assert.equal(status.completed, 4);
  assert.equal(status.total, 4);
});

test("slow listing responses already satisfy request pacing without an extra sleep", async () => {
  const original = Date.now;
  let elapsed = 0;
  Date.now = () => original() + elapsed;
  const calls = [];
  try {
    await runSearchIndexer({
      ...defaults(),
      signal: AbortSignal.timeout(1500),
      interval: 2000,
      seeds: async () => [`${base}/SlowA/`, `${base}/SlowB/`],
      listing: async (url) => {
        calls.push(url);
        elapsed += 3000;
        return listing(url);
      },
    });
    assert.deepEqual(calls, [`${base}/SlowA/`, `${base}/SlowB/`]);
    assert.equal((await getSearchIndexStatus()).phase, "complete");
  } finally {
    Date.now = original;
  }
});

test("fast missing responses still respect crawl delay and cancellation during pacing", async () => {
  const calls = [];
  await runSearchIndexer({
    ...defaults(),
    signal: AbortSignal.timeout(1500),
    policy: async () => ({ allowed: () => true, delay: 4000 }),
    seeds: async () => [`${base}/MissingA/`, `${base}/MissingB/`],
    listing: async (url) => {
      calls.push(url);
      throw new LibraryRequestError("Not found", 404);
    },
  });
  assert.deepEqual(calls, [`${base}/MissingA/`]);
  assert.equal((await getSearchIndexStatus()).failed, 0);
  assert.equal((await getSearchIndexStatus()).skipped, 1, "canceling a pacing wait is not another skipped folder");
});

test("a completed partial pass can refresh its seeds the next day despite unavailable folders", async () => {
  await runSearchIndexer({
    ...defaults(),
    seeds: async () => [`${base}/Gone/`],
    listing: async () => {
      throw new LibraryRequestError("Not found", 404);
    },
  });
  const file = path.join(home, ".visuales-cli-cache/file-index/scan.json");
  const checkpoint = JSON.parse(await fs.readFile(file, "utf8"));
  checkpoint.startedAt = Date.now() - 86400001;
  await fs.writeFile(file, JSON.stringify(checkpoint));
  let seeded = false;
  await runSearchIndexer({
    ...defaults(),
    seeds: async () => {
      seeded = true;
      return [`${base}/New/`];
    },
    listing: async (url) => listing(url),
  });
  assert.equal(seeded, true, "a stale missing branch must not prevent future library refreshes");
  const status = await getSearchIndexStatus();
  assert.equal(status.phase, "complete");
  assert.equal(status.failed, 0);
  assert.equal(status.completed, 1);
});
