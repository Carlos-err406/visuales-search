/* global document, window */
import assert from "node:assert/strict";

export async function testSettingsHelp({ page, screenshots, checkLayout }) {
  await page.setViewportSize({ width: 1240, height: 820 });
  await page.goto(process.env.DESKTOP_URL || "http://127.0.0.1:1420");
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  const connections = page.getByRole("button", { name: "About connections per file", exact: true });
  const ignore = page.getByRole("button", { name: "About ignore rules", exact: true });
  const help = page.getByRole("dialog");

  await connections.hover();
  await page.waitForTimeout(650);
  assert.equal(await page.getByRole("tooltip").count(), 0, "help buttons no longer open hover tooltips");
  assert.equal(await help.count(), 0);
  await connections.click();
  await page.getByRole("dialog", { name: "About connections per file" }).waitFor();
  assert.equal(await connections.getAttribute("aria-expanded"), "true");
  await page.mouse.move(10, 10);
  await page.waitForTimeout(650);
  assert.equal(await help.isVisible(), true, "help stays open when the pointer leaves");
  await page.keyboard.press("Escape");
  await help.waitFor({ state: "hidden" });
  assert.equal(await connections.evaluate((button) => button === document.activeElement), true);

  for (const key of ["Enter", "Space"]) {
    await connections.focus();
    await page.keyboard.press(key);
    await help.waitFor();
    await help.getByRole("button", { name: "Close help", exact: true }).click();
    await help.waitFor({ state: "hidden" });
  }
  await connections.click();
  await help.waitFor();
  await connections.click();
  await help.waitFor({ state: "hidden" });
  await connections.click();
  await ignore.click();
  await page.getByRole("dialog", { name: "About ignore rules" }).waitFor();
  assert.equal(await help.count(), 1, "switching info buttons replaces the previous help");
  assert.match(await help.textContent(), /!poster.jpg/);
  await page.getByRole("textbox", { name: "Ignore rules", exact: true }).click();
  await help.waitFor({ state: "hidden" });
  assert.equal(await page.getByRole("button", { name: "Save changes", exact: true }).count(), 0);

  for (const theme of ["Light", "Dark"]) {
    await page.getByRole("combobox", { name: "Theme", exact: true }).click();
    await page.getByRole("option", { name: theme, exact: true }).click();
    for (const width of [1240, 390]) {
      await page.setViewportSize({ width, height: 820 });
      await ignore.click();
      await help.waitFor();
      await checkLayout(`settings-help-${theme}-${width}`);
      const bounds = await help.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
      assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 820);
      assert.equal(await help.evaluate((element) => window.getComputedStyle(element).borderRadius), "1px");
      await page.screenshot({ path: `${screenshots}/settings-help-${theme}-${width}.png` });
      await page.keyboard.press("Escape");
      await help.waitFor({ state: "hidden" });
    }
    await page.setViewportSize({ width: 1240, height: 820 });
  }

  if (!process.env.BROWSER || process.env.BROWSER === "chromium") {
    const cdp = await page.context().newCDPSession(page);
    try {
      await page.setViewportSize({ width: 390, height: 820 });
      await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
      await ignore.scrollIntoViewIfNeeded();
      const bounds = await ignore.boundingBox();
      const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await page.getByRole("dialog", { name: "About ignore rules" }).waitFor();
      await help.getByRole("button", { name: "Close help", exact: true }).click();
      await help.waitFor({ state: "hidden" });
    } finally {
      await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
      await cdp.detach();
    }
  }
}
