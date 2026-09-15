/* global window, document */
import assert from "node:assert/strict";

export async function testRetryAndReview({ page, screenshots }) {
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
  await inspector.getByRole("button", { name: "Retry one.srt", exact: true }).click();
  await inspector.getByRole("button", { name: "Retry one.srt", exact: true }).waitFor({ state: "detached" });
  const retry = await page.evaluate(() =>
    window.testBridge.calls.filter((call) => call.command === "retry_download_files").at(-1)
  );
  assert.deepEqual(retry.args.paths, ["one.srt"]);
  await page.evaluate(() => {
    window.testBridge.fail = "retry_download_files";
  });
  await inspector.getByRole("button", { name: "Retry failed", exact: true }).click();
  await inspector.getByRole("alert").filter({ hasText: "Test failure" }).waitFor();
  await page.evaluate(() => {
    window.testBridge.fail = "";
  });
  await inspector.getByRole("button", { name: "Retry failed", exact: true }).click();
  await inspector.getByRole("button", { name: "Retry failed", exact: true }).waitFor({ state: "detached" });
  const all = await page.evaluate(() =>
    window.testBridge.calls.filter((call) => call.command === "retry_download_files").at(-1)
  );
  assert.equal(all.args.paths, undefined);
}
