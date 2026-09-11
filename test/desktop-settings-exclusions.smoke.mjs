/* global window */
import assert from "node:assert/strict";

export async function testSettingsExclusions({ page, screenshots, checkLayout }) {
  await page.setViewportSize({ width: 1240, height: 820 });
  await page.goto(process.env.DESKTOP_URL || "http://127.0.0.1:1420");
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Ignore rules", exact: true });
  const save = page.getByRole("button", { name: "Save changes", exact: true });
  const discard = page.getByRole("button", { name: "Discard", exact: true });
  await editor.waitFor();
  assert.equal(await editor.inputValue(), "");
  assert.equal(await save.count(), 0);
  await editor.fill("*.jpg\n!poster.jpg\n*.jpg\n!poster.jpg\n# Cover artwork");
  assert.equal(await save.isEnabled(), true);
  await page.getByRole("tab", { name: /Downloads/ }).click();
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  assert.equal(
    await editor.inputValue(),
    "*.jpg\n!poster.jpg\n*.jpg\n!poster.jpg\n# Cover artwork",
    "unsaved rules survive tab changes"
  );
  await editor.fill("x".repeat(513));
  assert.equal(await save.isDisabled(), true);
  await page.getByText("Each exclusion pattern must be at most 512 characters.", { exact: true }).waitFor();
  await editor.fill("*.jpg\n!poster.jpg\n*.jpg\n!poster.jpg\n# Cover artwork");
  await page.evaluate(() => {
    window.testBridge.fail = "save_desktop_settings";
  });
  await save.click();
  await page.getByRole("alert").filter({ hasText: "Test failure: save_desktop_settings" }).waitFor();
  assert.equal(await editor.inputValue(), "*.jpg\n!poster.jpg\n*.jpg\n!poster.jpg\n# Cover artwork");
  await page.evaluate(() => {
    window.testBridge.fail = "";
  });
  await save.click();
  await page.getByText("Saved", { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.testBridge.settings.exclude), [
    "*.jpg",
    "!poster.jpg",
    "*.jpg",
    "!poster.jpg",
    "# Cover artwork",
  ]);
  await page.reload();
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  await editor.waitFor();
  assert.equal(await editor.inputValue(), "*.jpg\n!poster.jpg\n*.jpg\n!poster.jpg\n# Cover artwork");
  await editor.fill("");
  await discard.click();
  assert.equal(await editor.inputValue(), "*.jpg\n!poster.jpg\n*.jpg\n!poster.jpg\n# Cover artwork");
  assert.equal(await save.count(), 0);

  for (const theme of ["Light", "Dark"]) {
    await page.getByRole("combobox", { name: "Theme", exact: true }).click();
    await page.getByRole("option", { name: theme, exact: true }).click();
    for (const width of [1240, 760, 390]) {
      await page.setViewportSize({ width, height: 820 });
      await editor.scrollIntoViewIfNeeded();
      await checkLayout(`settings-exclusions-${theme}-${width}`);
      assert.equal(await editor.evaluate((element) => window.getComputedStyle(element).borderRadius), "1px");
      if (width === 390) {
        const bounds = await editor.boundingBox();
        assert.ok(bounds.width >= 340, "narrow windows give exclusion patterns a full-width editor");
      }
      await page.screenshot({ path: `${screenshots}/settings-exclusions-${theme}-${width}.png` });
    }
    await page.setViewportSize({ width: 1240, height: 820 });
  }
  await page.getByRole("button", { name: "Restore defaults", exact: true }).click();
  assert.equal(await editor.inputValue(), "");
  assert.deepEqual(
    await page.evaluate(() => window.testBridge.settings.exclude),
    ["*.jpg", "!poster.jpg", "*.jpg", "!poster.jpg", "# Cover artwork"],
    "restore waits for Save"
  );
  await discard.click();
  assert.equal(await editor.inputValue(), "*.jpg\n!poster.jpg\n*.jpg\n!poster.jpg\n# Cover artwork");
  await page.getByRole("button", { name: "Restore defaults", exact: true }).click();
  await save.click();
  await page.getByText("Saved", { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.testBridge.settings.exclude), []);
}
