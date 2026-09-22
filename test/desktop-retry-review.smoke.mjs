/* global window, document */
import assert from "node:assert/strict";

export async function testRetryAndReview({ page, screenshots }) {
  const savedGroups = await page.evaluate(() => window.localStorage.getItem("visuales.download-groups"));
  await page.setViewportSize({ width: 1240, height: 820 });
  await page.goto(process.env.DESKTOP_URL || "http://127.0.0.1:1420/");
  await page.evaluate(() => {
    window.testBridge.review = {
      output: "/Users/carlos/Downloads/Visuales/Planet Earth",
      reviewId: "review-fixture",
      includedFiles: 3,
      ignoredFiles: 1,
      ignoredDirectories: 1,
      knownBytes: 1800000000,
      availableBytes: 900000000,
      unknownFiles: 1,
      estimated: true,
      spaceWarning: true,
      entries: [
        {
          url: "https://test/one",
          path: "Season 1/01 - Islands.mkv",
          kind: "file",
          bytes: 900000000,
          ignored: false,
          estimated: true,
        },
        {
          url: "https://test/two",
          path: "Season 1/02 - Mountains.mkv",
          kind: "file",
          bytes: 900000000,
          ignored: false,
          estimated: false,
        },
        { url: "https://test/three", path: "notes.txt", kind: "file", bytes: null, ignored: false },
        { url: "https://test/four", path: "poster.jpg", kind: "file", bytes: 86000, ignored: true },
        { url: "https://test/five", path: "Extras/", kind: "directory", bytes: null, ignored: true },
      ],
    };
  });
  await page.locator(".result-row").first().waitFor();
  await page.locator(".result-row").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Review Download", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Review download" });
  await dialog.getByText("Season 1/01 - Islands.mkv", { exact: true }).waitFor();
  await dialog.getByRole("alert").filter({ hasText: "exceeds available space" }).waitFor();
  assert.equal(
    await page.evaluate(() => window.testBridge.calls.filter((call) => call.command === "start_download").length),
    0
  );
  await dialog.getByRole("tab", { name: "Ignored 2" }).click();
  await dialog.getByText("poster.jpg", { exact: true }).waitFor();
  await dialog.getByText("Entire subtree", { exact: true }).waitFor();
  await dialog.getByRole("tab", { name: "Included 3" }).click();
  for (const [width, theme] of [
    [1240, "light"],
    [900, "dark"],
    [390, "dark"],
  ]) {
    await page.setViewportSize({ width, height: 820 });
    await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark");
    assert.ok(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth), "review fits its viewport");
    const tabs = await dialog.getByRole("tablist").boundingBox();
    const files = await dialog.locator(".review-files").boundingBox();
    const bounds = await dialog.boundingBox();
    assert.ok(files.y >= tabs.y + tabs.height - 1, "review files stay below the tabs");
    assert.ok(files.width >= bounds.width - 4, "file names use the full dialog width");
    await page.screenshot({ path: `${screenshots}/download-review-${width}-${theme}.png` });
  }
  await page.setViewportSize({ width: 1240, height: 820 });
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  await page
    .locator(".result-row")
    .first()
    .click({ modifiers: ["Meta"] });
  await page.getByRole("button", { name: "Review download", exact: true }).click();
  await dialog.getByText("Season 1/01 - Islands.mkv", { exact: true }).waitFor();
  await page.evaluate(() => {
    window.testBridge.fail = "start_download";
  });
  await dialog.getByRole("button", { name: "Download", exact: true }).click();
  await dialog.getByRole("alert").filter({ hasText: "Test failure" }).waitFor();
  assert.ok(await dialog.isVisible());
  await page.evaluate(() => {
    window.testBridge.fail = "";
  });
  await dialog.getByRole("button", { name: "Queue", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  const start = await page.evaluate(() =>
    window.testBridge.calls.filter((call) => call.command === "start_download").at(-1)
  );
  assert.equal(start.args.reviewId, "review-fixture");
  assert.equal(start.args.queue, true);
  assert.equal(await page.locator(".selection-bar").count(), 0);

  await page.evaluate(() => {
    window.testBridge.fileDetails["task-2"] = {
      version: 1,
      updatedAt: Date.now(),
      files: ["one.srt", "two.srt"].map((path) => ({
        path,
        url: `https://test/${path}`,
        status: "failed",
        totalBytes: 12000,
        downloadedBytes: 0,
        error: "Connection lost",
        attempts: 6,
        maxRetries: 5,
      })),
    };
  });
  await page.getByRole("tab", { name: /Downloads/ }).click();
  await page
    .getByRole("button", {
      name: "Details for A very long documentary title with additional release details",
      exact: true,
    })
    .click();
  const inspector = page.getByRole("complementary", { name: "Transfer details" });
  await inspector.getByText("5 of 5 retries used").first().waitFor();
  await inspector.getByRole("button", { name: "Error files (2)" }).click();
  assert.ok(await inspector.getByRole("button", { name: "Retry all failed files", exact: true }).isVisible());
  await inspector.getByRole("button", { name: "Error files (2)" }).click();
  await page.screenshot({ path: `${screenshots}/retry-all-files.png` });
  await inspector.getByRole("button", { name: "Retry one.srt", exact: true }).click();
  await inspector.getByRole("button", { name: "Retry one.srt", exact: true }).waitFor({ state: "detached" });
  const retry = await page.evaluate(() =>
    window.testBridge.calls.filter((call) => call.command === "retry_download_files").at(-1)
  );
  assert.deepEqual(retry.args.paths, ["one.srt"]);
  await page.evaluate(() => {
    window.testBridge.fail = "retry_download_files";
  });
  await inspector.getByRole("button", { name: "Retry all failed files", exact: true }).click();
  await inspector.getByRole("alert").filter({ hasText: "Test failure" }).waitFor();
  await page.evaluate(() => {
    window.testBridge.fail = "";
  });
  await inspector.getByRole("button", { name: "Retry all failed files", exact: true }).click();
  await inspector.getByRole("button", { name: "Retry all failed files", exact: true }).waitFor({ state: "detached" });
  const all = await page.evaluate(() =>
    window.testBridge.calls.filter((call) => call.command === "retry_download_files").at(-1)
  );
  assert.equal(all.args.paths, undefined);

  await page.goto(process.env.DESKTOP_URL || "http://127.0.0.1:1420/");
  await page.evaluate(() => {
    const failed = window.testBridge.tasks.find((task) => task.id === "task-2");
    window.testBridge.tasks.push({
      ...failed,
      id: "another-failure",
      url: "https://test/Another/",
      output: "/tmp/Another",
    });
    window.testBridge.failRetryId = "task-2";
    window.testBridge.holdRetryAll = true;
  });
  await page.getByRole("tab", { name: /Downloads/ }).click();
  await page.getByRole("button", { name: "Refresh downloads", exact: true }).click();
  const group = page.getByRole("button", { name: "Error downloads (2)", exact: true });
  await group.waitFor();
  if ((await group.getAttribute("aria-expanded")) === "true") await group.click();
  const retryAll = page.getByRole("button", { name: "Retry all failed downloads", exact: true });
  assert.ok(await retryAll.isVisible(), "bulk retry stays available in a collapsed group");
  for (const width of [1240, 900, 390]) {
    await page.setViewportSize({ width, height: 820 });
    const button = await retryAll.boundingBox();
    const toggle = await group.boundingBox();
    assert.ok(button.x >= toggle.x + toggle.width - 1, "retry and collapse controls do not overlap");
    assert.ok(button.x + button.width <= width, "retry stays within the viewport");
    await page.screenshot({ path: `${screenshots}/retry-all-downloads-${width}.png` });
  }
  await page.setViewportSize({ width: 1240, height: 820 });
  await retryAll.click();
  await page.waitForFunction(() => !!window.testBridge.finishRetryAll);
  assert.equal(await retryAll.isDisabled(), true);
  await retryAll.evaluate((button) => {
    button.click();
    button.click();
  });
  await page.evaluate(() => {
    window.testBridge.holdRetryAll = false;
    window.testBridge.finishRetryAll();
  });
  await page.getByRole("alert").filter({ hasText: "Test retry failure" }).waitFor();
  await page.waitForFunction(
    () => window.testBridge.tasks.find((task) => task.id === "another-failure").status === "queued"
  );
  const retries = await page.evaluate(() =>
    window.testBridge.calls.filter((call) => call.command === "retry_failed_download_task")
  );
  assert.deepEqual(retries.map((call) => call.args.id).sort(), ["another-failure", "task-2"]);
  assert.equal(
    await page.evaluate(() => window.testBridge.tasks.find((task) => task.id === "task-3").status),
    "interrupted"
  );
  assert.equal(await page.getByRole("button", { name: "Error downloads (1)" }).getAttribute("aria-expanded"), "true");
  await page.evaluate(() => {
    window.testBridge.failRetryId = "";
  });
  await retryAll.click();
  await retryAll.waitFor({ state: "detached" });

  // A group action follows the visible search scope; hidden failures stay untouched.
  await page.evaluate(() => {
    for (const id of ["task-2", "another-failure"])
      window.testBridge.tasks.find((task) => task.id === id).status = "failed";
    window.testBridge.calls = [];
  });
  await page.getByRole("button", { name: "Refresh downloads", exact: true }).click();
  await page.getByRole("searchbox", { name: "Filter downloads", exact: true }).fill("documentary");
  await retryAll.click();
  await retryAll.waitFor({ state: "detached" });
  assert.deepEqual(
    await page.evaluate(() =>
      window.testBridge.calls
        .filter((call) => call.command === "retry_failed_download_task")
        .map((call) => call.args.id)
    ),
    ["task-2"]
  );
  assert.equal(
    await page.evaluate(() => window.testBridge.tasks.find((task) => task.id === "another-failure").status),
    "failed"
  );
  await page.evaluate((saved) => {
    if (saved === null) window.localStorage.removeItem("visuales.download-groups");
    else window.localStorage.setItem("visuales.download-groups", saved);
  }, savedGroups);
}
