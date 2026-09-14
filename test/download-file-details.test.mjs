import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const home = await fs.mkdtemp(path.join(os.tmpdir(), "visuales-file-details-"));
process.env.HOME = home;
process.env.USERPROFILE = home;
const { recordDownloadFiles, readDownloadFileDetails, reportDownloadFile, removeDownloadFileDetails } =
  await import("../packages/core/dist/download/file-details.js");
const { downloadUrl, stopProgress } = await import("../packages/core/dist/download/downloader.js");
const { FILE_BODY, startTestServer } = await import("./helpers/test-server.mjs");
after(async () => {
  await stopProgress();
  await fs.rm(home, { recursive: true, force: true });
});

test("records all lifecycle events, even fast files between snapshot ticks, without cross-task leakage", async () => {
  await Promise.all(
    ["one", "two"].map((id) =>
      recordDownloadFiles(id, home, async () => {
        reportDownloadFile(`https://test/${id}`, path.join(home, "nested"), `${id}.txt`, { totalBytes: 20 });
        reportDownloadFile(`https://test/${id}`, path.join(home, "nested"), `${id}.txt`, {
          status: "downloading",
          downloadedBytes: 10,
        });
        await new Promise((resolve) => setTimeout(resolve, 15));
        reportDownloadFile(`https://test/${id}`, path.join(home, "nested"), `${id}.txt`, {
          status: "completed",
          downloadedBytes: 20,
        });
      })
    )
  );
  for (const id of ["one", "two"]) {
    const details = await readDownloadFileDetails(id);
    assert.equal(details.files.length, 1);
    assert.equal(details.files[0].path, `nested/${id}.txt`);
    assert.equal(details.files[0].status, "completed");
    assert.equal(details.files[0].downloadedBytes, 20);
  }
});

test("flushes failure, publishes live snapshots, resets a resumed run and removes history", async () => {
  await assert.rejects(
    recordDownloadFiles("failure", home, async () => {
      reportDownloadFile("https://test/a", home, "a.txt", { status: "waiting" });
      await new Promise((resolve) => setTimeout(resolve, 1150));
      assert.equal((await readDownloadFileDetails("failure")).files[0].status, "waiting");
      reportDownloadFile("https://test/a", home, "a.txt", { status: "failed", error: "Connection lost" });
      throw new Error("Connection lost");
    }),
    /Connection lost/
  );
  assert.equal((await readDownloadFileDetails("failure")).files[0].error, "Connection lost");
  await recordDownloadFiles("failure", home, async () => {
    assert.deepEqual((await readDownloadFileDetails("failure")).files, []);
  });
  await removeDownloadFileDetails("failure");
  assert.equal(await readDownloadFileDetails("failure"), null);
  assert.equal(await readDownloadFileDetails("../../legacy-task"), null);
});

test("persists optional live telemetry and rejects invalid values without requiring it in older records", async () => {
  const now = Date.now();
  await recordDownloadFiles("telemetry", home, async () => {
    reportDownloadFile("https://test/live", home, "live.bin", {
      status: "downloading",
      speedBytes: 245760,
      progressUpdatedAt: now,
      connections: { active: 3, chunksCompleted: 12, chunksTotal: 48 },
    });
  });
  const file = (await readDownloadFileDetails("telemetry")).files[0];
  assert.equal(file.speedBytes, 245760);
  assert.equal(file.progressUpdatedAt, now);
  assert.deepEqual(file.connections, { active: 3, chunksCompleted: 12, chunksTotal: 48 });
  for (const update of [
    { speedBytes: -1 },
    { progressUpdatedAt: -1 },
    { connections: null },
    { connections: { active: -1 } },
    { connections: { active: 1.5 } },
    { connections: { active: 1, chunksCompleted: 49, chunksTotal: 48 } },
    { connections: { active: 1, chunksCompleted: 2 } },
  ]) {
    await recordDownloadFiles("invalid", home, async () => {
      reportDownloadFile("https://test/live", home, "live.bin", update);
    });
    await assert.rejects(readDownloadFileDetails("invalid"), /invalid/);
  }
});

test("the real downloader records verification and already-existing files, including a zero-progress skip", async () => {
  const server = await startTestServer();
  const options = {
    output: home,
    resume: true,
    maxRetries: 0,
    timeout: 10,
    concurrent: 1,
    connections: 1,
    compact: true,
    exclude: [],
  };
  try {
    const url = server.url("normal", "verified.bin");
    await recordDownloadFiles("actual", home, () => downloadUrl(url, options));
    let file = (await readDownloadFileDetails("actual")).files[0];
    assert.equal(file.status, "completed");
    assert.equal(file.downloadedBytes, FILE_BODY.length);
    assert.equal(file.verified, true);
    assert.equal(file.speedBytes, 0);
    assert.equal(file.connections, undefined);
    assert.ok(file.progressUpdatedAt > 0);
    let progress = 0;
    await recordDownloadFiles("actual", home, () => downloadUrl(url, options, () => progress++));
    file = (await readDownloadFileDetails("actual")).files[0];
    assert.equal(progress, 0);
    assert.equal(file.status, "completed");
    assert.equal(file.downloadedBytes, FILE_BODY.length);
    await recordDownloadFiles("unknown", home, async () => {
      reportDownloadFile("https://test/unknown", home, "unknown.bin", { status: "downloading", verified: false });
      reportDownloadFile("https://test/unknown", home, "unknown.bin", {
        status: "completed",
        downloadedBytes: 100,
        totalBytes: 100,
      });
    });
    const unverified = (await readDownloadFileDetails("unknown")).files[0];
    assert.equal(unverified.verified, false);
    assert.equal(unverified.totalBytes, null);
  } finally {
    await server.close();
  }
});
