/* global window, document */
import assert from "node:assert/strict";

export async function testLibraryIndex({ page, screenshots, checkLayout }) {
  const url = new URL(page.url());
  url.search = "?library=large";
  await page.setViewportSize({ width: 1240, height: 820 });
  await page.goto(url.href);
  const library = page.getByRole("treeitem", { name: "Library", exact: true });
  await library.waitFor();
  assert.equal(await page.getByRole("treeitem").count(), 1, "the complete library begins collapsed");
  assert.equal(await library.getAttribute("aria-expanded"), "false");
  const initialCalls = await page.evaluate(() => window.testBridge.calls);
  assert.equal(
    initialCalls.filter((call) => call.command === "search_content").length,
    1,
    "initial index request is deduplicated"
  );
  assert.deepEqual(initialCalls.find((call) => call.command === "search_content").args.terms, []);
  assert.equal(
    initialCalls.filter((call) => call.command === "list_library_directory").length,
    0,
    "rendering the index does not scan directories"
  );
  await checkLayout("whole-library-collapsed");
  await library.click();
  const albums = page.getByRole("treeitem", { name: "Albums", exact: true });
  await albums.waitFor();
  await albums.click();
  await page.getByRole("treeitem", { name: "Album 0000", exact: true }).waitFor();
  assert.ok((await page.getByRole("treeitem").count()) < 100, "large branches only mount the viewport rows");
  await albums.focus();
  await page.keyboard.press("End");
  const last = page.getByRole("treeitem", { name: "Album 2999", exact: true });
  await last.waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Album 2999");
  await page.keyboard.press("Space");
  assert.equal(
    await page.getByRole("checkbox", { name: "Select Album 2999", exact: true }).getAttribute("aria-checked"),
    "true"
  );
  await page.waitForFunction(() => {
    const row = document.querySelector('[role="treeitem"][aria-label="Album 2999"]')?.getBoundingClientRect();
    const viewport = document.querySelector(".results-list")?.getBoundingClientRect();
    return row && viewport && row.bottom <= viewport.bottom + 1;
  });
  await page.screenshot({ path: `${screenshots}/whole-library-scrolled.png` });
  await page.keyboard.press("Home");
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Library");
  await page.getByRole("tab", { name: /Downloads/ }).click();
  await page.getByRole("tab", { name: "Search", exact: true }).click();
  await page.getByRole("treeitem", { name: "Album 0000", exact: true }).waitFor();
  assert.equal(
    await page.getByRole("checkbox", { name: "Select Library", exact: true }).getAttribute("aria-checked"),
    "mixed"
  );
  // Filtering still uses the shared engine, and clearing discards that selection.
  const search = page.getByRole("searchbox", { name: "Search library" });
  await search.fill("planet");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.locator(".result-row").first().waitFor();
  await page.waitForFunction(() => document.querySelector(".results-toolbar")?.textContent.includes("45 results"));
  await page.locator(".result-row [role=checkbox]").first().check();
  await page.evaluate(() => {
    window.testBridge.fail = "search_content";
  });
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await library.waitFor();
  assert.equal(await search.inputValue(), "");
  assert.equal(await page.locator(".selection-bar").count(), 0);
  assert.equal(await page.getByRole("treeitem").count(), 1);
  assert.equal(await page.getByRole("alert").count(), 0, "clearing uses the in-memory index offline");
  assert.equal(
    await page.evaluate(
      () =>
        window.testBridge.calls.filter((call) => call.command === "search_content" && !call.args.terms.length).length
    ),
    1
  );
  // Backspace/native clearing and whitespace-only values also restore browsing.
  await search.fill("unsubmitted text");
  await search.fill("   ");
  await library.waitFor();
  assert.equal(await page.getByRole("treeitem").count(), 1);
  await page.evaluate(() => {
    window.testBridge.fail = "";
    window.testBridge.holdSearch = true;
  });
  await search.fill("delayed");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.waitForFunction(() => Boolean(window.testBridge.releaseSearch));
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await library.waitFor();
  await page.evaluate(() => {
    window.testBridge.holdSearch = false;
    window.testBridge.releaseSearch();
  });
  await page.waitForTimeout(200);
  assert.equal(
    await page.getByRole("treeitem").count(),
    1,
    "stale search response cannot replace cleared-query library"
  );
  assert.equal(await library.getAttribute("aria-expanded"), "false");
  assert.equal(
    await page.evaluate(() => window.testBridge.calls.filter((call) => call.command === "start_download").length),
    0
  );
  await page.setViewportSize({ width: 390, height: 820 });
  await checkLayout("whole-library-mobile");
  // A failed first load can be retried, and a truly empty index is explicit.
  url.search = "?library=error";
  await page.goto(url.href);
  await page.getByText("Library unavailable", { exact: true }).waitFor();
  await page.getByRole("alert").filter({ hasText: "Test failure: search_content" }).waitFor();
  await page.evaluate(() => {
    window.testBridge.fail = "";
  });
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await library.waitFor();
  assert.equal(await page.getByRole("alert").count(), 0);
  url.search = "?library=empty";
  await page.goto(url.href);
  await page.getByText("Library is empty", { exact: true }).waitFor();
  assert.equal(await page.getByRole("treeitem").count(), 0);
}
