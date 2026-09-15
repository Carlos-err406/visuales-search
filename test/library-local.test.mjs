import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const home = await fs.mkdtemp(path.join(os.tmpdir(), "visuales-local-"));
process.env.HOME = home;
process.env.USERPROFILE = home;
const { downloadedLibraryFile } = await import("../packages/core/dist/library-local.js");
const { startDownloadTask, completeDownloadTask } = await import("../packages/core/dist/download/tasks.js");
const { recordDownloadFiles, reportDownloadFile } = await import("../packages/core/dist/download/file-details.js");
const base = "https://visuales.uclv.cu/Movies/";
after(() => fs.rm(home, { recursive: true, force: true }));

test("local reveal requires completed, existing recorded files inside the task destination", async () => {
  const output = path.join(home, "Downloads");
  await fs.mkdir(output);
  const options = {
    output,
    resume: true,
    concurrent: 1,
    connections: 1,
    maxRetries: 0,
    timeout: 10,
    compact: true,
    exclude: [],
  };
  const task = await startDownloadTask([base], options);
  await fs.writeFile(path.join(output, "poster.jpg"), "image");
  await fs.writeFile(path.join(home, "outside.txt"), "private");
  await recordDownloadFiles(task.id, output, async () => {
    reportDownloadFile(base + "poster.jpg", output, "poster.jpg", { status: "completed", verified: true });
    reportDownloadFile(base + "waiting.txt", output, "poster.jpg", { status: "waiting" });
    reportDownloadFile(base + "unverified.txt", output, "poster.jpg", { status: "completed", verified: false });
    reportDownloadFile(base + "missing.txt", output, "missing.txt", { status: "completed" });
    reportDownloadFile(base + "escaped.txt", home, "outside.txt", { status: "completed" });
  });
  await completeDownloadTask(task.id);
  assert.equal(await downloadedLibraryFile(base + "poster.jpg"), await fs.realpath(path.join(output, "poster.jpg")));
  for (const file of ["waiting.txt", "unverified.txt", "missing.txt", "escaped.txt", "unknown.txt"])
    assert.equal(await downloadedLibraryFile(base + file), null);
  await fs.rm(path.join(output, "poster.jpg"));
  assert.equal(await downloadedLibraryFile(base + "poster.jpg"), null);
  await assert.rejects(downloadedLibraryFile("file:///etc/passwd"));
});
