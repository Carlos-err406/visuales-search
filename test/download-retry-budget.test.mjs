import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const home = await fs.mkdtemp(path.join(os.tmpdir(), "visuales-retry-budget-"));
process.env.HOME = process.env.USERPROFILE = home;
const { downloadFile, stopProgress } = await import("../packages/core/dist/download/downloader.js");
const { recordDownloadFiles, readDownloadFileDetails } = await import("../packages/core/dist/download/file-details.js");
const { downloadDefaults } = await import("../packages/core/dist/download/defaults.js");
after(async () => {
  await stopProgress();
  await fs.rm(home, { recursive: true, force: true });
});

async function exercise(t, name, response, retries = 5) {
  const output = await fs.mkdtemp(path.join(home, "output-"));
  let attempts = 0;
  const delays = [];
  const timeout = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", (callback, ms, ...args) => {
    if ([5000, 8000, 11000, 14000, 17000].includes(ms)) {
      delays.push(ms);
      return timeout(callback, 0, ...args);
    }
    return timeout(callback, ms, ...args);
  });
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    if (init.method === "HEAD") return new Response(null, { headers: { "content-length": "10" } });
    return response(++attempts, init);
  });
  let error;
  await recordDownloadFiles(name, output, async () => {
    try {
      await downloadFile("https://fixture.invalid/file.bin", {
        ...downloadDefaults,
        output,
        connections: 1,
        maxRetries: retries,
      });
    } catch (caught) {
      error = caught;
    }
  });
  const file = (await readDownloadFileDetails(name)).files[0];
  return { attempts, delays, error, file, output };
}

for (const [name, response] of [
  [
    "timeout",
    () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    },
  ],
  [
    "connect-timeout",
    () => {
      throw new TypeError("fetch failed", {
        cause: Object.assign(new Error("Connect timeout"), { code: "UND_ERR_CONNECT_TIMEOUT" }),
      });
    },
  ],
  ["503", () => new Response(null, { status: 503 })],
  ["408", () => new Response(null, { status: 408 })],
  ["429", () => new Response(null, { status: 429 })],
  ["unavailable", () => new Response("<html>Unavailable</html>", { headers: { "content-type": "text/html" } })],
]) {
  test(`uses all five retries for ${name} before recording a failed file`, async (t) => {
    const result = await exercise(t, name, response);
    assert.equal(result.attempts, 6, "one initial attempt plus five retries");
    assert.deepEqual(result.delays, [5000, 8000, 11000, 14000, 17000]);
    assert.ok(result.error);
    assert.equal(result.file.status, "failed");
    assert.equal(result.file.attempts, 6);
    assert.equal(result.file.maxRetries, 5);
    await assert.rejects(fs.stat(path.join(result.output, "file.bin")), { code: "ENOENT" });
  });
}

test("stops retrying as soon as a file succeeds", async (t) => {
  const result = await exercise(t, "recovers", (attempt) =>
    attempt < 3
      ? new Response(null, { status: 503 })
      : new Response("0123456789", { headers: { "content-length": "10" } })
  );
  assert.equal(result.attempts, 3);
  assert.equal(result.error, undefined);
  assert.equal(result.file.status, "completed");
  assert.equal(result.file.attempts, 3);
  assert.equal(result.file.maxRetries, 5);
});

test("permanent HTTP errors do not waste the retry budget", async (t) => {
  const result = await exercise(t, "missing", () => new Response(null, { status: 404 }));
  assert.equal(result.attempts, 1);
  assert.deepEqual(result.delays, []);
  assert.equal(result.file.status, "failed");
  assert.equal(result.file.attempts, 1);
});

test("zero retries still performs the initial attempt", async (t) => {
  const result = await exercise(t, "no-retries", () => new Response(null, { status: 503 }), 0);
  assert.equal(result.attempts, 1);
  assert.deepEqual(result.delays, []);
  assert.equal(result.file.maxRetries, 0);
});

test("attempt telemetry does not invalidate records for the CLI's unbounded retry setting", async (t) => {
  const result = await exercise(
    t,
    "unbounded",
    () => new Response("0123456789", { headers: { "content-length": "10" } }),
    Infinity
  );
  assert.equal(result.error, undefined);
  assert.equal(result.file.status, "completed");
  assert.equal(result.file.attempts, 1);
  assert.equal(result.file.maxRetries, undefined);
});

test("transient verification failures use the file budget and never promote unverified bytes", async (t) => {
  const result = await exercise(t, "verification", (_attempt, init) =>
    init.headers?.Range ? new Response(null, { status: 503 }) : new Response("01234")
  );
  assert.equal(result.file.status, "failed");
  assert.equal(result.file.attempts, 6);
  assert.equal(result.file.maxRetries, 5);
  assert.match(result.error.message, /503/);
  assert.equal(result.delays.length, 5);
  await assert.rejects(fs.stat(path.join(result.output, "file.bin")), { code: "ENOENT" });
  assert.equal(await fs.readFile(path.join(result.output, ".visuales-parts/file.bin"), "utf8"), "01234");
});
