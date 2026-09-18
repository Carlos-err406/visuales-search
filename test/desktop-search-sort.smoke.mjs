/* global window, document, localStorage */
import assert from "node:assert/strict";

export async function testSearchSort({ page, screenshots }) {
  await page.getByRole("treeitem").first().waitFor();
  await page.waitForFunction(() => document.querySelector(".results-list")?.getAttribute("aria-busy") === "false");
  await page.evaluate(() => {
    const base = "https://visuales.uclv.cu/Sort/";
    const entry = (suffix, modifiedLocal) => ({
      text: suffix.replace(/\/$/, "").split("/").at(-1),
      url: base + suffix,
      encodedUrl: base + suffix,
      directory: "",
      isDirectoryLink: suffix.endsWith("/"),
      size: suffix.endsWith("/") ? undefined : 4096,
      modifiedLocal,
      modifiedCheckedAt: 100,
    });
    const entries = [
      { ...entry("", "2026-09-18T10:00"), text: "Sort", isDirectoryLink: true },
      entry("Zulu/", "2026-09-18T10:00"),
      entry("Alpha/", "2026-09-17T10:00"),
      entry("Unknown/"),
      entry("Alpha/child.txt", "2026-09-18T10:00"),
      entry("a.txt", "2026-09-17T10:00"),
      entry("b.txt", "2026-09-18T10:00"),
      entry("unknown.txt"),
    ];
    window.testBridge.results = entries;
    window.testBridge.libraryResults = entries;
    window.testBridge.directoryEntries[base] = entries.filter(
      (item) => item.encodedUrl !== base && !item.encodedUrl.slice(base.length).replace(/\/$/, "").includes("/")
    );
    localStorage.removeItem("visuales.search-sort");
    window.dispatchEvent(new window.StorageEvent("storage", { key: "visuales.search-sort" }));
  });
  const search = page.getByRole("searchbox", { name: "Search library", exact: true });
  await search.fill("Sort fixture");
  await search.press("Enter");
  const alpha = page.getByRole("treeitem", { name: "Alpha", exact: true });
  await alpha.waitFor();
  assert.equal(await alpha.locator("time.tree-modified").textContent(), "2026-09-17");
  assert.equal(await alpha.locator("time").getAttribute("datetime"), "2026-09-17");
  assert.equal(await alpha.locator("time").getAttribute("aria-label"), "Modified 2026-09-17");
  assert.equal(
    await page.getByRole("treeitem", { name: "Unknown", exact: true }).locator(".tree-modified").textContent(),
    "--"
  );
  assert.equal(await alpha.locator("[title]").count(), 0, "date display does not add native row tooltips");
  await alpha.click();
  assert.equal(await alpha.getAttribute("aria-expanded"), "false");
  await alpha.click({ modifiers: ["Meta"] });
  const callCount = await page.evaluate(
    () =>
      window.testBridge.calls.filter((call) => ["list_library_directory", "search_content"].includes(call.command))
        .length
  );
  const sort = page.getByRole("combobox", { name: "Sort search results" });
  async function choose(label) {
    await sort.click();
    await page.getByRole("option", { name: label, exact: true }).click();
    await page.getByRole("listbox").waitFor({ state: "hidden" });
  }
  const names = () =>
    page
      .locator('.search-tree [role="treeitem"][aria-level="2"]')
      .evaluateAll((rows) => rows.map((row) => row.getAttribute("aria-label")));
  await choose("Modified: newest first");
  assert.deepEqual(await names(), ["Zulu", "Alpha", "Unknown", "b.txt", "a.txt", "unknown.txt"]);
  assert.equal(await alpha.getAttribute("aria-expanded"), "false");
  assert.equal(await alpha.getAttribute("aria-selected"), "true");
  await sort.click();
  await page.getByRole("listbox").waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await alpha.getAttribute("aria-selected"), "true", "closing the sort menu does not deselect rows");
  await choose("Modified: oldest first");
  assert.deepEqual(await names(), ["Alpha", "Zulu", "Unknown", "a.txt", "b.txt", "unknown.txt"]);
  await choose("Name Z-A");
  assert.equal(
    await alpha.locator("time.tree-modified").textContent(),
    "2026-09-17",
    "dates remain visible with name sorting"
  );
  assert.deepEqual(await names(), ["Zulu", "Unknown", "Alpha", "unknown.txt", "b.txt", "a.txt"]);
  assert.equal(
    await page.evaluate(
      () =>
        window.testBridge.calls.filter((call) => ["list_library_directory", "search_content"].includes(call.command))
          .length
    ),
    callCount,
    "sort changes do not fetch data"
  );
  await choose("Modified: newest first");
  await page.evaluate(() => window.testBridge.emit("search-index-changed"));
  await page.waitForFunction(
    () =>
      !document.querySelector('[aria-label="Search results"]')?.getAttribute("aria-busy") ||
      document.querySelector('[aria-label="Search results"]')?.getAttribute("aria-busy") === "false"
  );
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await page.getByRole("treeitem", { name: "Sort", exact: true }).click();
  assert.deepEqual(await names(), ["Zulu", "Alpha", "Unknown", "b.txt", "a.txt", "unknown.txt"]);
  await search.focus();
  await page.evaluate(() => {
    const file = window.testBridge.libraryResults.find((entry) => entry.text === "a.txt");
    file.modifiedLocal = "2026-09-19T10:00";
    file.modifiedCheckedAt = 200;
    window.testBridge.fileIndex = {
      phase: "complete",
      files: 4,
      completed: 1,
      total: 1,
      failed: 0,
      skipped: 0,
      running: false,
      revision: "date:1",
      libraryRevision: "unchanged-listado",
    };
    window.testBridge.emit("file-index-changed");
  });
  await page.waitForFunction(() => {
    const rows = [...document.querySelectorAll('.search-tree [role="treeitem"][aria-level="2"]')];
    return rows[3]?.getAttribute("aria-label") === "a.txt";
  });
  assert.deepEqual(await names(), ["Zulu", "Alpha", "Unknown", "a.txt", "b.txt", "unknown.txt"]);
  assert.equal(
    await page.getByRole("treeitem", { name: "a.txt", exact: true }).locator("time").textContent(),
    "2026-09-19",
    "live metadata updates the displayed date"
  );
  const dateColumns = await page
    .locator(".search-tree .tree-modified")
    .evaluateAll((cells) => cells.map((cell) => cell.getBoundingClientRect().right));
  assert.ok(
    dateColumns.every((right) => Math.abs(right - dateColumns[0]) < 1),
    "date column is aligned across files and folders"
  );
  await page.screenshot({ path: `${screenshots}/search-date-sort.png` });
  await sort.click();
  await page.getByRole("listbox").waitFor();
  await page.screenshot({ path: `${screenshots}/search-date-sort-menu.png`, animations: "disabled" });
  await page.keyboard.press("Escape");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: `${screenshots}/search-date-sort-dark.png` });
  await page.emulateMedia({ colorScheme: "light" });
  for (const width of [820, 390]) {
    await page.setViewportSize({ width, height: 780 });
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      `sort fits ${width}px viewport`
    );
    assert.equal(await alpha.locator("time.tree-modified").textContent(), "2026-09-17");
    assert.equal(await alpha.locator(".tree-actions button").count(), 2, "only queue and download actions remain");
    assert.equal(
      await page.getByRole("treeitem", { name: "a.txt", exact: true }).locator(".tree-size").isVisible(),
      width > 600,
      "date labels preserve file sizes where they previously fit"
    );
    const dateLayout = await alpha.evaluate((row) => {
      const content = row.querySelector(".tree-content").getBoundingClientRect();
      const metadata = row.querySelector(".tree-metadata").getBoundingClientRect();
      const date = row.querySelector(".tree-modified");
      const actions = row.querySelector(".tree-actions").getBoundingClientRect();
      const firstButton = row.querySelector(".tree-actions button").getBoundingClientRect();
      return {
        height: row.getBoundingClientRect().height,
        overlap: content.right > metadata.left || metadata.right > Math.min(actions.left, firstButton.left),
        clipped: date.scrollWidth > date.clientWidth,
      };
    });
    assert.equal(dateLayout.overlap, false, "date metadata does not overlap name or actions");
    assert.equal(dateLayout.clipped, false, "displayed date fits its column");
    assert.equal(dateLayout.height, 44, "date labels preserve virtualized row height");
    await page.screenshot({ path: `${screenshots}/search-date-sort-${width}.png` });
  }
  await page.setViewportSize({ width: 1240, height: 820 });
  await page.reload();
  await sort.waitFor();
  assert.match(await sort.textContent(), /Modified: newest first/);
  await page.evaluate(() => {
    localStorage.setItem("visuales.search-sort", "invalid");
    window.dispatchEvent(new window.StorageEvent("storage", { key: "visuales.search-sort" }));
  });
  await page.waitForFunction(() => document.querySelector(".search-sort")?.textContent.includes("Name A-Z"));
  await choose("Name A-Z");
  await testLegacyDateBackfill({ page, screenshots, choose });
}

async function testLegacyDateBackfill({ page, screenshots, choose }) {
  const base = "https://visuales.uclv.cu/Peliculas/Extranjeras/2026/";
  const search = page.getByRole("searchbox", { name: "Search library", exact: true });
  await page.evaluate((base) => {
    const item = (url, modifiedLocal) => ({
      url,
      encodedUrl: url,
      text: url.split("/").filter(Boolean).at(-1),
      directory: "",
      isDirectoryLink: true,
      ...(modifiedLocal ? { modifiedLocal, modifiedCheckedAt: 200 } : {}),
    });
    const entries = [item(base + "Alpha/"), item(base + "Zulu/")];
    window.testBridge.results = entries;
    window.testBridge.libraryResults = entries;
    window.testBridge.holdDates = base;
    window.testBridge.directoryDateEntries = {
      [base]: [
        item(base + "Alpha/", "2026-09-17T10:00"),
        item(base + "Zulu/", "2026-09-18T10:00"),
        item(base + "Unrelated/", "2026-09-19T10:00"),
      ],
    };
    window.testBridge.directoryEntries[base] = entries;
  }, base);
  await search.fill("legacy date fixture");
  await search.press("Enter");
  await page.getByRole("treeitem", { name: "Alpha", exact: true }).waitFor();
  const folderNames = () =>
    page
      .locator('.search-tree [role="treeitem"][aria-level="4"]')
      .evaluateAll((rows) => rows.map((row) => row.getAttribute("aria-label")));
  assert.deepEqual(await folderNames(), ["Alpha", "Zulu"]);
  await choose("Modified: newest first");
  await page.waitForFunction(() => Boolean(window.testBridge.releaseDates));
  await page.getByRole("status").filter({ hasText: "Loading dates" }).waitFor();
  await page.screenshot({ path: `${screenshots}/search-date-backfill-loading.png` });
  await page.evaluate(() => {
    window.testBridge.holdDates = null;
    window.testBridge.releaseDates();
  });
  await page.waitForFunction(
    () =>
      document.querySelector('.search-tree [role="treeitem"][aria-level="4"]')?.getAttribute("aria-label") === "Zulu"
  );
  assert.deepEqual(await folderNames(), ["Zulu", "Alpha"]);
  assert.equal(
    await page.getByRole("treeitem", { name: "Zulu", exact: true }).locator("time").textContent(),
    "2026-09-18",
    "backfilled dates appear in the row"
  );
  assert.equal(
    await page.getByRole("treeitem", { name: "Unrelated", exact: true }).count(),
    0,
    "date metadata must not add unmatched siblings"
  );
  await page.screenshot({ path: `${screenshots}/search-date-backfill-complete.png` });
  const count = await page.evaluate(
    () =>
      window.testBridge.calls.filter((call) => call.command === "list_library_directory" && call.args.requireDates)
        .length
  );
  await choose("Modified: oldest first");
  assert.deepEqual(await folderNames(), ["Alpha", "Zulu"]);
  await choose("Modified: newest first");
  assert.deepEqual(await folderNames(), ["Zulu", "Alpha"]);
  assert.equal(
    await page.evaluate(
      () =>
        window.testBridge.calls.filter((call) => call.command === "list_library_directory" && call.args.requireDates)
          .length
    ),
    count,
    "switching directions reuses dates"
  );
  assert.equal(
    await page.evaluate(
      (base) =>
        window.testBridge.calls.some(
          (call) => call.args?.requireDates && [base + "Alpha/", base + "Zulu/"].includes(call.args.url)
        ),
      base
    ),
    false,
    "does not scan collapsed children"
  );

  await page.evaluate(() => {
    const base = "https://visuales.uclv.cu/DateFailure/";
    const item = (name, date) => ({
      text: name,
      encodedUrl: base + name,
      url: base + name,
      directory: "",
      isDirectoryLink: false,
      modifiedLocal: date,
      ...(date ? { modifiedCheckedAt: 200 } : {}),
    });
    window.testBridge.results = [item("first.txt"), item("second.txt")];
    window.testBridge.directoryDateEntries[base] = [
      item("first.txt", "2026-09-17T10:00"),
      item("second.txt", "2026-09-18T10:00"),
    ];
    window.testBridge.failDates = [base];
  });
  await search.fill("date failure fixture");
  await search.press("Enter");
  await page.getByRole("button", { name: "Retry loading dates" }).waitFor();
  await page.evaluate(() => {
    window.testBridge.failDates = [];
  });
  await page.getByRole("button", { name: "Retry loading dates" }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('.search-tree [role="treeitem"][aria-level="2"]')?.getAttribute("aria-label") ===
      "second.txt"
  );
  await page.getByRole("button", { name: "Retry loading dates" }).waitFor({ state: "hidden" });
  await choose("Name A-Z");
  await page.reload();
}
