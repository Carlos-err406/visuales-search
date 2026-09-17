/* global window, document */
import assert from "node:assert/strict";

export async function testTransferInspector({ page, screenshots }) {
  await page.setViewportSize({ width: 1240, height: 820 });
  await page.evaluate(() => {
    window.localStorage.removeItem("visuales.download-groups");
    window.localStorage.removeItem("visuales.transfer-file-groups");
  });
  await page.goto(process.env.DESKTOP_URL || "http://127.0.0.1:1420/");
  await page.evaluate(() => {
    const files = [
      { path: "01 - Islands.mkv", status: "completed", downloadedBytes: 300000000, totalBytes: 300000000 },
      {
        path: "02 - Mountains.mkv",
        status: "downloading",
        downloadedBytes: 75000000,
        totalBytes: 900000000,
        speedBytes: 245760,
        progressUpdatedAt: Date.now(),
        connections: { active: 3, chunksCompleted: 12, chunksTotal: 48 },
      },
      { path: "03 - Jungles.mkv", status: "waiting", downloadedBytes: 0, totalBytes: 800000000 },
      { path: "poster.jpg", status: "completed", downloadedBytes: 86000, totalBytes: 86000 },
      { path: "notes.txt", status: "completed", downloadedBytes: 3000, totalBytes: null, verified: false },
      {
        path: "subtitles/en.srt",
        status: "failed",
        downloadedBytes: 0,
        totalBytes: 12000,
        error: "Connection timed out. Partial file kept.",
      },
    ].map((file) => ({ ...file, url: `https://example.test/${file.path}` }));
    window.testBridge.fileDetails["task-0"] = { version: 1, updatedAt: Date.now(), files };
    window.testBridge.fileDetails["task-2"] = {
      version: 1,
      updatedAt: Date.now(),
      files: [{ ...files[1], status: "downloading" }],
    };
  });
  await page.getByRole("tab", { name: /Downloads/ }).click();
  const open = page.getByRole("button", { name: "Details for Planet Earth II", exact: true });
  await open.click();
  const inspector = page.getByRole("complementary", { name: "Transfer details" });
  await inspector.getByText("02 - Mountains.mkv", { exact: true }).waitFor();
  await inspector.getByText("240.0 KB/s", { exact: true }).waitFor();
  assert.equal(await inspector.getByText("3 connections", { exact: true }).count(), 1);
  assert.equal(await inspector.getByText("12/48 chunks", { exact: true }).count(), 1);
  await page.evaluate(() => {
    window.testBridge.fileDetails["task-0"].files[1].progressUpdatedAt = Date.now() - 60000;
  });
  await inspector.getByText("3 connections", { exact: true }).waitFor({ state: "detached" });
  assert.equal(await inspector.locator(".inspector-file-telemetry").count(), 0, "stale file telemetry is hidden");
  await page.evaluate(() => {
    const overall = window.testBridge.tasks[0].overallProgress;
    overall.updatedAt = Date.now();
    overall.activeFiles = [{ url: "https://example.test/02 - Mountains.mkv", speed: "123 KB/s" }];
  });
  await inspector.getByText("123 KB/s", { exact: true }).waitFor();
  assert.equal(
    await inspector.getByText("3 connections", { exact: true }).count(),
    0,
    "legacy fallback does not invent connections"
  );
  await page.evaluate(() => {
    window.testBridge.tasks[0].overallProgress.activeFiles = [];
    window.testBridge.fileDetails["task-0"].files[1].progressUpdatedAt = Date.now();
  });
  await inspector.getByText("3 connections", { exact: true }).waitFor();
  assert.equal(await page.locator('[role="dialog"], .preview-backdrop').count(), 0, "no modal or scrim");
  assert.equal(
    await inspector
      .getByRole("button", { name: "Close transfer details" })
      .evaluate((el) => document.activeElement === el),
    true
  );
  assert.equal(await inspector.getByText("Unverified", { exact: true }).count(), 1);
  assert.deepEqual(
    await inspector
      .locator(".inspector-file-group .group-toggle")
      .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))),
    ["Downloading files (1)", "Pending files (1)", "Needs attention files (2)", "Finished files (2)"]
  );
  assert.ok(await inspector.getByRole("button", { name: "Retry all failed files", exact: true }).isDisabled());
  const finished = inspector.getByRole("button", { name: "Finished files (2)", exact: true });
  assert.equal(
    await finished.getAttribute("aria-expanded"),
    "false",
    "finished files start collapsed during a transfer"
  );
  assert.equal(await inspector.getByText("01 - Islands.mkv", { exact: true }).count(), 0);
  await finished.click();
  await inspector.getByText("01 - Islands.mkv", { exact: true }).waitFor();
  await finished.click();
  await inspector.locator(".inspector-files").evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.evaluate(() => {
    window.testBridge.originalFiles = structuredClone(window.testBridge.fileDetails["task-0"].files);
    const files = window.testBridge.fileDetails["task-0"].files;
    files[1].status = "completed";
    files[2].status = "downloading";
  });
  await inspector.getByRole("button", { name: "Finished files (3)", exact: true }).waitFor();
  assert.equal(
    await inspector.locator(".inspector-file-telemetry").count(),
    0,
    "completed files no longer show live metrics"
  );
  assert.equal(
    await inspector.getByRole("button", { name: "Finished files (3)", exact: true }).getAttribute("aria-expanded"),
    "false",
    "polling preserves collapsed groups"
  );
  assert.equal(
    await inspector.locator(".inspector-file").first().locator(".inspector-file-name span").textContent(),
    "03 - Jungles.mkv",
    "newly active files move to the first group"
  );
  assert.equal(
    await inspector.getByRole("button", { name: "Pending files (1)", exact: true }).count(),
    0,
    "empty groups disappear"
  );
  await page.evaluate(() => {
    window.testBridge.fileDetails["task-0"].files = window.testBridge.originalFiles;
  });
  await inspector.getByRole("button", { name: "Pending files (1)", exact: true }).waitFor();
  await inspector.getByRole("button", { name: "Open download folder", exact: true }).click();
  await page.waitForFunction(() => window.testBridge.calls.some((call) => call.command === "open_output_folder"));
  assert.equal(await inspector.isVisible(), true);

  const checkLayout = async (name) => {
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true,
      "no page overflow"
    );
    assert.equal(await inspector.evaluate((el) => el.scrollWidth <= el.clientWidth), true, "no inspector overflow");
    await page.screenshot({ path: `${screenshots}/${name}.png` });
  };
  await checkLayout("transfer-inspector-light");
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await checkLayout("transfer-inspector-dark");
  const separator = inspector.getByRole("separator");
  await separator.focus();
  const width = (await inspector.boundingBox()).width;
  await page.keyboard.press("ArrowLeft");
  assert.ok((await inspector.boundingBox()).width > width);
  const resized = await separator.getAttribute("aria-valuenow");
  await page.mouse.move(0, 0);
  await page.keyboard.press("Escape");
  await inspector.waitFor({ state: "detached" });
  assert.equal(await open.evaluate((el) => document.activeElement === el), true, "Escape restores row focus");
  await open.click();
  assert.equal(await inspector.getByRole("separator").getAttribute("aria-valuenow"), resized);

  // Switching is possible while the sheet remains open; late responses cannot overwrite the new task.
  await page.evaluate(() => {
    window.testBridge.detailsDelay = 900;
  });
  await page
    .getByRole("button", {
      name: "Details for A very long documentary title with additional release details",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Details for Blue Planet", exact: true }).click();
  await inspector.getByText("Files will appear when this transfer starts.").waitFor();
  assert.equal(await inspector.getByText("02 - Mountains.mkv", { exact: true }).count(), 0);
  await page.evaluate(() => {
    window.testBridge.detailsDelay = 0;
  });
  await page.getByRole("button", { name: "Details for The Universe", exact: true }).click();
  await inspector.getByText("Per-file details were not recorded for this transfer.").waitFor();
  await page.getByRole("searchbox", { name: "Filter downloads" }).fill("Planet Earth");
  await open.click();
  await inspector.getByText("02 - Mountains.mkv", { exact: true }).waitFor();
  await page.setViewportSize({ width: 900, height: 640 });
  await checkLayout("transfer-inspector-small-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  await checkLayout("transfer-inspector-mobile");
  await page.setViewportSize({ width: 1240, height: 820 });
  await inspector.getByRole("button", { name: "Close transfer details" }).click();
  await page.evaluate(() => {
    window.testBridge.fail = "get_download_files";
  });
  await open.click();
  await inspector.getByRole("alert").waitFor();
  await page.evaluate(() => {
    window.testBridge.fail = "";
  });
  await inspector.getByRole("button", { name: "Retry", exact: true }).click();
  await inspector.getByText("02 - Mountains.mkv", { exact: true }).waitFor();
  await inspector.getByRole("button", { name: "Interrupt transfer", exact: true }).click();
  await page.waitForFunction(() =>
    window.testBridge.calls.some((call) => call.command === "cancel_download_task" && call.args.id === "task-0")
  );
  await inspector.getByRole("button", { name: "Close transfer details" }).click();
  await page.getByRole("searchbox", { name: "Filter downloads" }).fill("");
  await page.evaluate(() => {
    const base = window.testBridge.tasks[4];
    window.testBridge.tasks = Array.from({ length: 40 }, (_, index) => ({
      ...base,
      id: `archive-${index}`,
      url: `https://example.test/Archive%20${index}/`,
      status: "completed",
      createdAt: index,
      updatedAt: index,
    }));
    window.testBridge.fileDetails["archive-12"] = {
      version: 1,
      updatedAt: Date.now(),
      files: Array.from({ length: 2000 }, (_, index) => ({
        path: `Season ${index}/episode.mkv`,
        url: `https://example.test/${index}`,
        status: "completed",
        totalBytes: 1000,
        downloadedBytes: 1000,
      })),
    };
  });
  await page.getByRole("button", { name: "Refresh downloads", exact: true }).click();
  const archive = page.getByRole("button", { name: "Details for Archive 12", exact: true });
  await archive.scrollIntoViewIfNeeded();
  const rowTop = () => archive.evaluate((el) => el.closest("tr").getBoundingClientRect().top);
  const before = await rowTop();
  await archive.click();
  const archiveFinished = inspector.getByRole("button", { name: "Finished files (2000)", exact: true });
  await archiveFinished.waitFor();
  assert.equal(await archiveFinished.getAttribute("aria-expanded"), "false", "group choices carry across transfers");
  await archiveFinished.click();
  await inspector.getByText("Season 0/episode.mkv", { exact: true }).waitFor();
  assert.ok(Math.abs((await rowTop()) - before) < 2, "opening details anchors the selected row");
  assert.ok((await inspector.locator(".inspector-file").count()) < 30, "large file histories stay virtualized");
  await inspector.locator(".inspector-files").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await inspector.getByText("Season 1999/episode.mkv", { exact: true }).waitFor();
  const handle = inspector.getByRole("separator");
  const rect = await handle.boundingBox();
  const beforeDrag = (await inspector.boundingBox()).width;
  await page.mouse.move(rect.x + rect.width / 2, rect.y + 30);
  await page.mouse.down();
  await page.mouse.move(rect.x - 40, rect.y + 30, { steps: 4 });
  await page.mouse.up();
  assert.ok((await inspector.boundingBox()).width > beforeDrag, "dragging resizes the sheet");
  await inspector.getByRole("button", { name: "Close transfer details" }).click();
}
