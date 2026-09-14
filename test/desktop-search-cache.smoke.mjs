/* global window */
import assert from "node:assert/strict";
import { resolve } from "node:path";

export async function testSearchCache({ page }) {
  await page.evaluate(
    async (moduleUrl) => {
      const { mountSearchBrowser } = await import(moduleUrl);
      const entries = Array.from({ length: 30000 }, (_, index) => ({
        text: `Album ${index}`,
        encodedUrl: `https://visuales.uclv.cu/Cache-test/${index}/`,
        url: `https://visuales.uclv.cu/Cache-test/${index}/`,
        directory: "",
        isDirectoryLink: true,
      }));
      window.cacheProbe = { harness: mountSearchBrowser(entries) };
    },
    `/@fs/${resolve("test/fixtures/search-browser-harness.mjs")}`
  );
  try {
    await page.waitForFunction(() => Boolean(window.cacheProbe.harness.snapshot()));
    await page.evaluate(() => {
      const probe = window.cacheProbe;
      const browser = probe.harness.snapshot();
      probe.tree = browser.tree;
      probe.entries = browser.entries;
      window.testBridge.holdListing = true;
      delete window.testBridge.releaseListing;
      browser.showContents(browser.tree[0]);
    });
    await page.waitForFunction(() => Boolean(window.testBridge.releaseListing));
    assert.deepEqual(
      await page.evaluate(() => {
        const { harness, tree, entries } = window.cacheProbe;
        const browser = harness.snapshot();
        return {
          sameTree: browser.tree === tree,
          sameEntries: browser.entries === entries,
          open: browser.isOpen(tree[0]),
          loading: browser.listings[tree[0].url]?.loading,
        };
      }),
      { sameTree: true, sameEntries: true, open: true, loading: true },
      "opening a folder must not rebuild the full index just to display loading state"
    );
    await page.evaluate(() => {
      window.testBridge.holdListing = false;
      window.testBridge.releaseListing();
    });
    await page.waitForFunction(() => {
      const browser = window.cacheProbe.harness.snapshot();
      return Boolean(browser.contents[browser.tree[0].url]);
    });
    const listingCount = await page.evaluate(() => {
      const probe = window.cacheProbe;
      const browser = probe.harness.snapshot();
      probe.tree = browser.tree;
      probe.entries = browser.entries;
      browser.toggle(browser.tree[0]);
      return window.testBridge.calls.filter((call) => call.command === "list_library_directory").length;
    });
    await page.waitForFunction(() => {
      const browser = window.cacheProbe.harness.snapshot();
      return !browser.isOpen(browser.tree[0]);
    });
    await page.evaluate(() => {
      const browser = window.cacheProbe.harness.snapshot();
      browser.toggle(browser.tree[0]);
    });
    await page.waitForFunction(() => {
      const browser = window.cacheProbe.harness.snapshot();
      return browser.isOpen(browser.tree[0]);
    });
    assert.equal(
      await page.evaluate(
        () => window.testBridge.calls.filter((call) => call.command === "list_library_directory").length
      ),
      listingCount,
      "reopening cached contents must not request them again"
    );
    await page.evaluate(() => {
      window.testBridge.fail = "list_library_directory";
      const browser = window.cacheProbe.harness.snapshot();
      browser.showContents(browser.tree[0], true);
    });
    await page.waitForFunction(() => {
      const browser = window.cacheProbe.harness.snapshot();
      return Boolean(browser.listings[browser.tree[0].url]?.error);
    });
    assert.ok(
      await page.evaluate(() => {
        const { harness, tree, entries } = window.cacheProbe;
        const browser = harness.snapshot();
        return browser.tree === tree && browser.entries === entries && !browser.listings[tree[0].url].loading;
      }),
      "cached toggles and failed refreshes keep the existing tree and entries"
    );
  } finally {
    await page.evaluate(() => {
      window.testBridge.fail = "";
      window.testBridge.holdListing = false;
      window.cacheProbe.harness.dispose();
      delete window.cacheProbe;
    });
  }
}
