/* global window, document */
import assert from "node:assert/strict";
import { settingsPage } from "./helpers/settings-navigation.mjs";

export async function testSearchRevalidation({ page, screenshots }) {
  const base = process.env.DESKTOP_URL || "http://127.0.0.1:1420/";
  await page.setViewportSize({ width: 1240, height: 820 });
  await page.goto(base);
  await page.getByRole("treeitem", { name: "Library", exact: true }).waitFor();
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  await settingsPage(page, "Settings");
  await page.getByLabel("Concurrent files", { exact: true }).fill("7");
  await settingsPage(page, "Settings");
  const cache = page.getByRole("region", { name: "Search", exact: true });
  const button = cache.getByRole("button", { name: "Revalidate cache", exact: true });
  await page.evaluate(() => {
    window.testBridge.holdRevalidation = true;
    window.testBridge.libraryResults = [
      {
        text: "Refreshed library",
        url: "https://visuales.uclv.cu/Refreshed/",
        encodedUrl: "https://visuales.uclv.cu/Refreshed/",
        directory: "",
        isDirectoryLink: true,
      },
    ];
  });
  await button.click();
  await page.waitForFunction(() => Boolean(window.testBridge.releaseRevalidation));
  assert.equal(await cache.getByRole("button", { name: "Revalidating..." }).isDisabled(), true);
  const refreshes = await page.evaluate(() =>
    window.testBridge.calls.filter((call) => call.command === "search_content" && call.args.noCache)
  );
  assert.equal(refreshes.length, 1);
  assert.deepEqual(refreshes[0].args, { terms: [], noCache: true }, "refreshes the global index only");
  await page.locator("#tab-downloads").click();
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  assert.equal(await cache.getByRole("button", { name: "Revalidating..." }).isDisabled(), true);
  await page.evaluate(() => {
    window.testBridge.holdRevalidation = false;
    window.testBridge.releaseRevalidation();
  });
  await cache.getByText("Search index updated.", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Concurrent files", { exact: true }).inputValue(), "7");
  assert.equal(await page.getByRole("button", { name: "Save changes", exact: true }).isEnabled(), true);
  assert.equal(
    await page.evaluate(
      () => window.testBridge.calls.filter((call) => call.command === "save_desktop_settings").length
    ),
    0,
    "refresh never submits a settings draft"
  );
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await page.getByRole("tab", { name: "Search", exact: true }).click();
  await page.getByRole("treeitem", { name: "Refreshed library", exact: true }).waitFor();
  assert.equal(await page.getByRole("treeitem", { name: "Library", exact: true }).count(), 0);

  // Native broadcasts also invalidate already-visible searches in other windows.
  await page.evaluate(() => {
    window.testBridge.libraryResults[0].text = "Updated elsewhere";
    window.testBridge.emit("search-index-changed");
  });
  await page.getByRole("treeitem", { name: "Updated elsewhere", exact: true }).waitFor();
  const search = page.getByRole("searchbox", { name: "Search library", exact: true });
  await search.fill("planet");
  await search.press("Enter");
  await page.getByRole("treeitem").filter({ hasText: "Planet Earth - Episode 01" }).waitFor();
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  await page.evaluate(() => {
    window.testBridge.results[0].text = "Updated planet match";
  });
  await button.click();
  await cache.getByText("Search index updated.", { exact: true }).waitFor();
  await page.getByRole("tab", { name: "Search", exact: true }).click();
  await page.getByRole("treeitem", { name: "Updated planet match", exact: true }).waitFor();
  assert.equal(await search.inputValue(), "planet", "current query survives revalidation");

  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await page.getByRole("treeitem", { name: "Updated elsewhere", exact: true }).waitFor();
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  await page.evaluate(() => {
    window.testBridge.fail = "search_content";
  });
  await button.click();
  await cache.getByRole("alert").filter({ hasText: "Test failure: search_content" }).waitFor();
  assert.equal(await button.isEnabled(), true);
  await page.getByRole("tab", { name: "Search", exact: true }).click();
  await page.getByRole("treeitem", { name: "Updated elsewhere", exact: true }).waitFor();
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  await page.evaluate(() => {
    window.testBridge.fail = "";
  });
  await button.click();
  await cache.getByText("Search index updated.", { exact: true }).waitFor();
  assert.equal(await cache.getByRole("alert").count(), 0);
  assert.equal(await page.locator(".settings-footer").count(), 0, "cache refresh does not dirty settings");
  for (const width of [1240, 390]) {
    await page.setViewportSize({ width, height: 820 });
    await button.scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    const control = await button.boundingBox();
    assert.ok(control.x >= 0 && control.x + control.width <= width);
    await page.screenshot({ path: `${screenshots}/settings-cache-${width}.png` });
  }

  const preview = await page.context().newPage();
  try {
    await preview.goto(base);
    await preview.getByRole("tab", { name: "Settings", exact: true }).click();
    await settingsPage(preview, "Settings");
    assert.equal(await preview.getByRole("button", { name: "Revalidate cache", exact: true }).isDisabled(), true);
  } finally {
    await preview.close();
  }
  await page.setViewportSize({ width: 1240, height: 820 });
}
