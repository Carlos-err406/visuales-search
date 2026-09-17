/* global window, document */
import assert from "node:assert/strict";

export async function testFileIndex({ page, screenshots }) {
  await page.setViewportSize({ width: 1240, height: 820 });
  await page.goto(process.env.DESKTOP_URL || "http://127.0.0.1:1420/");
  await page.getByRole("treeitem", { name: "Library", exact: true }).waitFor();
  await page.evaluate(() => {
    window.testBridge.fileIndex = {
      phase: "indexing",
      files: 397,
      completed: 30,
      total: 29955,
      failed: 0,
      skipped: 0,
      running: true,
      revision: "test:1",
      current: "https://visuales.uclv.cu/Cursos/DevOps%20Interview%20Preparation%20Course/4%20-%20Docker/",
    };
    window.testBridge.results = [];
    window.testBridge.emit("file-index-changed");
  });
  const input = page.getByRole("searchbox", { name: "Search library", exact: true });
  await input.fill("stuart fails");
  await input.press("Enter");
  const status = page.getByRole("button", { name: /^File indexing:/ });
  await status.waitFor();
  await page.waitForFunction(
    () =>
      document.querySelector(".results-list")?.getAttribute("aria-busy") === "false" &&
      !document.querySelector('[role="treeitem"]')
  );
  assert.equal(await page.getByRole("treeitem").count(), 0);
  await page.evaluate(() => {
    const url = "https://visuales.uclv.cu/Recientes/Stuart.Fails.S01E01.mkv";
    window.testBridge.results = [
      { text: "Stuart.Fails.S01E01.mkv", url, encodedUrl: url, directory: "/Recientes/", isDirectoryLink: false },
    ];
    window.testBridge.fileIndex.revision = "test:2";
    window.testBridge.emit("file-index-changed");
  });
  const file = page.getByRole("treeitem", { name: "Stuart.Fails.S01E01.mkv", exact: true });
  await file.waitFor();
  await file.click({ modifiers: ["Meta"] });
  assert.equal(await file.getAttribute("aria-selected"), "true");
  await page.evaluate(() => {
    const url = "https://visuales.uclv.cu/Recientes/Stuart.Fails.S01E02.mkv";
    window.testBridge.results.push({
      text: "Stuart.Fails.S01E02.mkv",
      url,
      encodedUrl: url,
      directory: "/Recientes/",
      isDirectoryLink: false,
    });
    window.testBridge.fileIndex.revision = "test:3";
    window.testBridge.emit("file-index-changed");
  });
  const more = page.getByRole("button", { name: "New results", exact: true });
  await more.waitFor();
  assert.equal(await page.getByRole("treeitem", { name: "Stuart.Fails.S01E02.mkv", exact: true }).count(), 0);
  assert.equal(await file.getAttribute("aria-selected"), "true");
  await more.click();
  await page.getByRole("treeitem", { name: "Stuart.Fails.S01E02.mkv", exact: true }).waitFor();
  assert.equal(await file.getAttribute("aria-selected"), "true");
  await page.evaluate(() => {
    window.testBridge.results.shift();
    window.testBridge.fileIndex.revision = "test:4";
    window.testBridge.emit("file-index-changed");
  });
  await more.click();
  await file.waitFor({ state: "detached" });
  assert.equal(await page.locator('[role="treeitem"][aria-selected="true"]').count(), 0);
  await status.click();
  const section = page.getByRole("region", { name: "Search", exact: true });
  assert.equal(
    await section.locator(".index-current").textContent(),
    "/Cursos/DevOps Interview Preparation Course/4 - Docker/"
  );
  await section.getByRole("button", { name: "Pause indexing", exact: true }).click();
  await section.getByRole("button", { name: "Resume indexing", exact: true }).waitFor();
  await section.getByRole("button", { name: "Refresh file index", exact: true }).click();
  assert.equal(
    await section.getByRole("button", { name: "Resume indexing", exact: true }).count(),
    1,
    "refresh does not unpause"
  );
  await section.getByRole("button", { name: "Resume indexing", exact: true }).click();
  await section.getByRole("button", { name: "Pause indexing", exact: true }).waitFor();
  assert.equal(await page.locator(".settings-footer").count(), 0, "index controls do not dirty preferences");
  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme });
    for (const width of [1240, 390]) {
      await page.setViewportSize({ width, height: 820 });
      await section.scrollIntoViewIfNeeded();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      await page.screenshot({ path: `${screenshots}/file-index-${colorScheme}-${width}.png` });
    }
  }
  await page.setViewportSize({ width: 1240, height: 820 });
  await page.emulateMedia({ colorScheme: "light" });
  const scrolling = new URL(process.env.DESKTOP_URL || "http://127.0.0.1:1420/");
  scrolling.search = "?library=scroll";
  await page.goto(scrolling.href);
  await page.getByRole("treeitem", { name: "Peliculas", exact: true }).click();
  await page.getByRole("treeitem", { name: "Extranjeras", exact: true }).click();
  const year = page.getByRole("treeitem", { name: "2013", exact: true });
  await year.evaluate((row) => {
    const list = row.closest(".results-list");
    list.scrollTop += row.getBoundingClientRect().top - list.getBoundingClientRect().top - 180;
  });
  await year.click();
  await page.getByRole("button", { name: "Refresh 2013", exact: true }).waitFor();
  await page.waitForTimeout(200);
  const before = await year.boundingBox();
  await page.evaluate(() => {
    const url = "https://visuales.uclv.cu/AFirst/";
    window.testBridge.libraryResults.unshift({
      text: "AFirst",
      url,
      encodedUrl: url,
      directory: "/AFirst",
      isDirectoryLink: true,
    });
    window.testBridge.fileIndex = {
      phase: "complete",
      files: 100000,
      completed: 30000,
      total: 30000,
      failed: 0,
      skipped: 0,
      running: true,
      revision: "scroll:1",
      libraryRevision: "list:2",
    };
    window.testBridge.emit("file-index-changed");
  });
  await more.click();
  await page.waitForTimeout(200);
  assert.ok(
    Math.abs((await year.boundingBox()).y - before.y) < 2,
    "new results preserve a deep virtualized scroll anchor"
  );
  assert.equal(await year.getAttribute("aria-expanded"), "true");
  await page.goto(process.env.DESKTOP_URL || "http://127.0.0.1:1420/");
}
