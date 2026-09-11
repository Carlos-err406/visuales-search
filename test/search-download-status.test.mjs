import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSearchDownloadStatusIndex } from "../packages/core/dist/search-download-status.js";

const base = "https://visuales.uclv.cu";
const task = (url, status = "completed", extra = {}) => ({
  id: "fixture",
  url: base + url,
  status,
  output: "/Downloads",
  updatedAt: 100,
  options: { exclude: [] },
  ...extra,
});
const lookup = (tasks, path, directory = path.endsWith("/")) =>
  createSearchDownloadStatusIndex(tasks, 1000)(base + path, directory);

describe("Search transfer status", () => {
  it("shows each exact state and leaves unrelated rows empty", () => {
    for (const status of ["running", "queued", "completed", "failed", "interrupted"]) {
      const value = lookup([task("/Films/One/", status)], "/Films/One/");
      assert.equal(value.status, status);
      assert.equal(value.label.toLowerCase(), status);
      assert.equal(lookup([task("/Films/One/", status)], "/Films/Two/"), undefined);
    }
  });
  it("shows completion only on exact targets, not their parents or contents", () => {
    assert.equal(lookup([task("/Films/One/")], "/Films/"), undefined);
    assert.equal(lookup([task("/Films/One/file.txt", "failed")], "/Films/One/"), undefined);
    assert.equal(lookup([task("/Films/One/")], "/Films/One/file.txt"), undefined);
    assert.equal(lookup([task("/Films/One/file.txt")], "/Films/One/file.txt").label, "Completed");
    assert.equal(
      lookup([task("/Films/One/file.txt"), task("/Films/One/", "completed", { updatedAt: 200 })], "/Films/One/file.txt")
        .label,
      "Completed",
      "newer folder history does not hide an exact completed file"
    );
  });
  it("never adds ancestor labels for any child transfer state", () => {
    for (const status of ["running", "queued", "completed", "failed", "interrupted"]) {
      const child = task("/Films/One/file.txt", status);
      assert.equal(lookup([child], "/Films/One/"), undefined);
      assert.equal(lookup([child], "/Films/"), undefined);
      assert.equal(lookup([child], "/Films/One/file.txt").status, status);
    }
  });
  it("handles batch URLs, encodings, path boundaries and different origins", () => {
    const batch = task("/Films/One/", "queued", { urls: [base + "/Films/One/", base + "/Films/Two (2026)/"] });
    assert.equal(lookup([batch], "/Films/Two%20%282026%29/").status, "queued");
    assert.equal(lookup([batch], "/Films/OneMore/"), undefined);
    assert.equal(createSearchDownloadStatusIndex([batch])("https://other.test/Films/One/", true), undefined);
    assert.equal(lookup([task("/Films/a%2Fb/")], "/Films/a/b/"), undefined);
    assert.equal(
      createSearchDownloadStatusIndex([task("/x"), task("/x", "failed", { url: "invalid" })])("invalid", false),
      undefined
    );
  });
  it("prefers active transfers, then the latest recorded attempt, including multiple destinations", () => {
    const done = task("/Films/One/", "completed", { updatedAt: 300 });
    const running = task("/Films/One/file.txt", "running", { updatedAt: 100, output: "/Other" });
    assert.equal(lookup([done, running], "/Films/One/").label, "Completed");
    assert.equal(lookup([done, task("/Films/One/", "failed", { updatedAt: 400 })], "/Films/One/").status, "failed");
    assert.equal(lookup([task("/Films/One/", "queued"), running], "/Films/One/").status, "queued");
    assert.equal(lookup([done, task("/Films/One/", "running", { updatedAt: 100 })], "/Films/One/").status, "running");
  });
  it("respects exclusions and does not present filtered folders as fully completed", () => {
    const filtered = task("/Films/One/", "completed", { options: { exclude: ["*.txt"] } });
    assert.equal(lookup([filtered], "/Films/One/").label, "Completed subset");
    assert.equal(lookup([filtered], "/Films/One/a.txt"), undefined);
    assert.equal(lookup([filtered], "/Films/One/a.png"), undefined);
  });
  it("uses fresh exact file URLs for progress, never basenames or stale progress", () => {
    const running = task("/Films/One/", "running", {
      overallProgress: {
        updatedAt: 999,
        activeFiles: [{ url: base + "/Films/One/a.txt", fileName: "a.txt", progress: 25 }],
      },
    });
    assert.equal(lookup([running], "/Films/One/a.txt").label, "Downloading 25%");
    assert.equal(lookup([running], "/Films/One/Other/a.txt").label, "Folder transfer running");
    assert.equal(
      createSearchDownloadStatusIndex([running], 20000)(base + "/Films/One/a.txt", false).label,
      "Folder transfer running"
    );
    running.startedAt = 1000;
    assert.equal(lookup([running], "/Films/One/a.txt").label, "Folder transfer running");
    delete running.startedAt;
    delete running.overallProgress.activeFiles[0].url;
    assert.equal(lookup([running], "/Films/One/a.txt").label, "Folder transfer running");
    running.status = "completed";
    assert.equal(lookup([running], "/Films/One/a.txt"), undefined);
  });
  it("retains exact single-file progress when it also matches a task target", () => {
    const file = task("/a.txt", "running", { lastProgress: { url: base + "/a.txt", progress: 100, updatedAt: 999 } });
    assert.equal(lookup([file], "/a.txt").label, "Downloading 99%");
  });
});
