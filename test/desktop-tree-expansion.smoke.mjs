/* global window */
import assert from "node:assert/strict";

export async function testTreeExpansion({ page, screenshots }) {
  const url = new URL(page.url());
  url.search = "?library=scroll";
  await page.goto(url.href);
  await page.getByRole("treeitem", { name: "Peliculas", exact: true }).click();
  await page.getByRole("treeitem", { name: "Extranjeras", exact: true }).click();
  const year = page.getByRole("treeitem", { name: "2013", exact: true });
  const list = page.locator(".results-list");
  await year.waitFor();
  await year.evaluate((row) => {
    const list = row.closest(".results-list");
    list.scrollTop += row.getBoundingClientRect().top - list.getBoundingClientRect().top - 180;
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await year.boundingBox();
    const scrollBefore = await list.evaluate((element) => element.scrollTop);
    if (attempt === 0) {
      await page.evaluate(() => {
        window.testBridge.holdListing = true;
        delete window.testBridge.releaseListing;
      });
    }
    await year.click();
    await page.waitForTimeout(200);
    assert.ok(
      Math.abs((await year.boundingBox()).y - before.y) < 2,
      "expanding across virtualization keeps the clicked row in place"
    );
    assert.ok(Math.abs((await list.evaluate((element) => element.scrollTop)) - scrollBefore) < 2);
    if (attempt === 0) {
      await page.waitForFunction(() => Boolean(window.testBridge.releaseListing));
      await page.evaluate(() => {
        window.testBridge.holdListing = false;
        window.testBridge.releaseListing();
      });
      await page.getByRole("button", { name: "Refresh 2013", exact: true }).waitFor();
      await page.waitForTimeout(200);
      assert.ok(
        Math.abs((await year.boundingBox()).y - before.y) < 2,
        "live listing completion preserves the viewport"
      );
      assert.equal(
        await page.getByRole("treeitem", { name: "Movie 000 (2013)", exact: true }).count(),
        1,
        "live listing and index do not create duplicate rows"
      );
      assert.ok((await page.getByRole("treeitem").count()) < 100, "expanded branch stays virtualized");
      await page.screenshot({ path: `${screenshots}/tree-expanded-scroll-position.png` });
    }
    await year.click();
    await page.waitForTimeout(200);
    assert.ok(
      Math.abs((await year.boundingBox()).y - before.y) < 2,
      "collapsing back to regular rows preserves the viewport"
    );
  }
}
