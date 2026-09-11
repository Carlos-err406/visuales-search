/* global window, document */
import assert from "node:assert/strict";

export async function testSearchStatuses({ page, screenshots, checkLayout }) {
  await page.setViewportSize({ width: 1240, height: 820 });
  await page.goto(process.env.DESKTOP_URL || "http://127.0.0.1:1420");
  await page.evaluate(() => {
    const base = "https://visuales.uclv.cu";
    window.testBridge.results = ["/Movies/Example/", "/Movies/Example/notes.txt", "/Movies/Other/"].map((path) => ({
      encodedUrl: base + path,
      url: base + path,
      text: path.split("/").filter(Boolean).at(-1),
      directory: "/Movies",
      isDirectoryLink: path.endsWith("/"),
      size: path.endsWith("/") ? undefined : 72,
    }));
    window.testBridge.tasks = [
      {
        id: "status-fixture",
        url: base + "/Movies/Example/",
        status: "running",
        output: "/Downloads/Example",
        options: { exclude: [] },
        updatedAt: Date.now(),
        overallProgress: {
          updatedAt: Date.now(),
          totalFiles: 2,
          completedFiles: 0,
          totalBytes: 100,
          downloadedBytes: 25,
          speedBytes: 20,
          activeFiles: [{ url: base + "/Movies/Example/notes.txt", fileName: "notes.txt", progress: 25 }],
        },
      },
    ];
  });
  await page.getByRole("searchbox", { name: "Search library" }).fill("Example");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.clock.fastForward(2200);
  const row = (name) => page.getByRole("treeitem", { name, exact: true });
  await row("notes.txt").getByText("Downloading 25%", { exact: true }).waitFor();
  assert.equal(await row("Movies").locator(".tree-download-status").count(), 0);
  assert.equal(await row("Other").locator(".tree-download-status").count(), 0);
  await row("notes.txt").getByRole("checkbox").click();
  const selected = await row("notes.txt").getByRole("checkbox").getAttribute("aria-checked");
  await row("Example").evaluate((element) => {
    window.statusRow = element;
  });
  const scroll = await page.locator(".search-tree").evaluate((element) => element.parentElement.scrollTop);
  await page.evaluate(() => {
    window.testBridge.tasks[0].status = "completed";
    window.testBridge.tasks[0].updatedAt = Date.now();
  });
  await page.clock.fastForward(2200);
  await row("Example").getByText("Completed", { exact: true }).waitFor();
  assert.equal(await row("Movies").locator(".tree-download-status").count(), 0);
  assert.equal(await row("notes.txt").locator(".tree-download-status").count(), 0);
  assert.equal(await row("notes.txt").getByRole("checkbox").getAttribute("aria-checked"), selected);
  assert.equal(await row("Example").getAttribute("aria-expanded"), "true");
  assert.equal(
    await row("Example").evaluate((element) => element === window.statusRow),
    true,
    "polling does not remount rows"
  );
  assert.equal(await page.locator(".search-tree").evaluate((element) => element.parentElement.scrollTop), scroll);
  for (const width of [1240, 760, 390]) {
    await page.setViewportSize({ width, height: 820 });
    await checkLayout(`search-status-${width}`);
    const overlap = await row("notes.txt").evaluate((element) => {
      const content = element.querySelector(".tree-content").getBoundingClientRect();
      const meta = element.querySelector(".tree-metadata").getBoundingClientRect();
      return content.right > meta.left;
    });
    assert.equal(overlap, false, "metadata does not overlap filenames");
    await page.screenshot({ path: `${screenshots}/search-status-${width}.png` });
  }
  await page.evaluate(() => {
    window.testBridge.fail = "list_download_tasks";
  });
  await page.clock.fastForward(2200);
  await page.waitForFunction(() => document.querySelectorAll(".tree-download-status").length === 0);
  await page.evaluate(() => {
    window.testBridge.fail = "";
  });
  await page.clock.fastForward(2200);
  await row("Example").getByText("Completed", { exact: true }).waitFor();

  // The empty-search library consumes the same status index.
  await page.setViewportSize({ width: 1240, height: 820 });
  await page.evaluate(() => {
    window.testBridge.tasks = [
      {
        id: "library-status",
        url: "https://visuales.uclv.cu/Library/Albums/Album%200000/",
        status: "queued",
        output: "/Downloads",
        options: { exclude: [] },
        updatedAt: Date.now(),
      },
    ];
  });
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await page.clock.fastForward(2200);
  await row("Library").waitFor();
  assert.equal(await row("Library").locator(".tree-download-status").count(), 0);
  await row("Library").click();
  await row("Albums").click();
  await row("Album 0000").getByText("Queued", { exact: true }).waitFor();
  assert.equal(await row("Albums").locator(".tree-download-status").count(), 0);
}
