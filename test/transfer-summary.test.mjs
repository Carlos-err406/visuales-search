import assert from "node:assert/strict";
import { test } from "node:test";
import {
  summarizeTransfer,
  summarizeTransfers,
  transferByteProgress,
} from "../packages/core/dist/download/transfer-summary.js";

const now = 100000;
const task = (id, status = "running", progress = {}) => ({
  id,
  status,
  createdAt: 1,
  url: `https://example.test/${id}/`,
  overallProgress: {
    updatedAt: now,
    speedBytes: 1024,
    totalFiles: 12,
    completedFiles: 3,
    totalBytes: 1000,
    downloadedBytes: 250,
    ...progress,
  },
});

test("historical tray records retain byte progress but never show active speed", () => {
  for (const status of ["interrupted", "failed", "completed"]) {
    const summary = summarizeTransfer(task(status, status), now);
    assert.equal(summary.status, status);
    assert.equal(summary.progress, status === "completed" ? 100 : 25);
    assert.equal(summary.speedBytes, null);
  }
});

test("tray summary includes CLI and desktop work with stable ordering and byte progress", () => {
  const input = [
    task("z"),
    task("a"),
    task("queued", "queued"),
    task("done", "completed"),
    task("failed", "failed"),
    task("canceled", "interrupted"),
  ];
  const result = summarizeTransfers(input, now);
  assert.equal(result.running, 2);
  assert.equal(result.queued, 1);
  assert.equal(result.speedBytes, 2048);
  assert.deepEqual(
    result.transfers.map((entry) => entry.id),
    ["a", "queued", "z"]
  );
  assert.equal(result.transfers[0].progress, 25);
  assert.equal(result.transfers[1].progress, null);
  assert.equal(input[0].id, "z", "does not reorder task store");
});

test("tray never substitutes file counts or one file's progress for unknown folder bytes", () => {
  const input = task("unknown", "running", { completedFiles: 6, totalFiles: 7, totalBytes: 0 });
  input.lastProgress = { progress: 100, totalSize: 100 };
  assert.equal(summarizeTransfers([input], now).transfers[0].progress, null);
  for (const progress of [
    { totalBytes: Infinity },
    { totalBytes: -1 },
    { downloadedBytes: NaN },
    { downloadedBytes: -1 },
  ]) {
    assert.equal(summarizeTransfers([task("bad", "running", progress)], now).transfers[0].progress, null);
  }
  assert.equal(
    summarizeTransfers([task("verifying", "running", { downloadedBytes: 1000 })], now).transfers[0].progress,
    99.9
  );
});

test("six small files completed and one large file at nine percent do not show nearly complete", () => {
  const input = task("movie", "running", { completedFiles: 6, totalFiles: 7, downloadedBytes: 90, totalBytes: 1000 });
  const result = summarizeTransfers([input], now).transfers[0];
  assert.equal(result.progress, 9);
  assert.equal(result.progress, transferByteProgress(input));
  assert.equal(result.completedFiles, 6);
  assert.equal(result.totalFiles, 7);
  assert.equal(result.downloadedBytes, 90);
  assert.equal(result.totalBytes, 1000);
});

test("tray byte labels preserve downloaded bytes and leave unknown totals unknown", () => {
  for (const totalBytes of [0, undefined, NaN, Infinity, -1]) {
    const result = summarizeTransfers(
      [task("unknown", "running", { downloadedBytes: 181.7 * 1024 ** 2, totalBytes })],
      now
    ).transfers[0];
    assert.equal(result.totalBytes, null);
    assert.equal(result.downloadedBytes, 181.7 * 1024 ** 2);
  }
  assert.equal(
    summarizeTransfers([task("invalid", "running", { downloadedBytes: NaN })], now).transfers[0].downloadedBytes,
    null
  );
});

test("tray hides stale, missing, future-dated and invalid speeds including aggregate speed", () => {
  for (const progress of [
    { updatedAt: now - 10001 },
    { updatedAt: now + 1 },
    { updatedAt: NaN },
    { speedBytes: NaN },
    { speedBytes: Infinity },
    { speedBytes: -1 },
  ]) {
    const summary = summarizeTransfers([task("good"), task("bad", "running", progress)], now);
    assert.equal(summary.speedBytes, null);
    assert.equal(summary.transfers.find((entry) => entry.id === "bad").speedBytes, null);
  }
  assert.equal(
    summarizeTransfers([{ id: "legacy", status: "running", url: "bad", createdAt: 1 }], now).speedBytes,
    null
  );
  assert.equal(summarizeTransfers([task("stopped", "running", { speedBytes: 0 })], now).speedBytes, 0);
  assert.deepEqual(summarizeTransfers([], now), { running: 0, queued: 0, speedBytes: null, transfers: [] });
});
