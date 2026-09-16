/* global window, document */
import assert from "node:assert/strict";

export async function testInterruptAll({ page, screenshots }) {
  await page.goto(process.env.DESKTOP_URL || "http://127.0.0.1:1420/");
  await page.getByRole("tab", { name: /Downloads/ }).click();
  await page.getByRole("searchbox", { name: "Filter downloads" }).fill("The Universe");
  const trigger = page.getByRole("button", { name: "Interrupt all downloads", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Interrupt all downloads?" });
  await dialog.getByText("3 active transfers", { exact: true }).waitFor();
  assert.match(await dialog.textContent(), /CLI downloads.*hidden by filters/);
  await dialog.getByRole("button", { name: "Keep downloading" }).click();
  assert.equal(
    await page.evaluate(() => window.testBridge.calls.filter((call) => call.command === "cancel_all_downloads").length),
    0
  );
  await trigger.click();
  for (const width of [1240, 390]) {
    await page.setViewportSize({ width, height: 820 });
    await page.screenshot({ path: `${screenshots}/interrupt-all-${width}.png` });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  }
  await page.evaluate(() => {
    window.testBridge.fail = "cancel_all_downloads";
  });
  await dialog.getByRole("button", { name: "Interrupt all", exact: true }).click();
  await dialog.getByRole("alert").filter({ hasText: "Test failure" }).waitFor();
  await page.evaluate(() => {
    window.testBridge.fail = "";
    window.testBridge.holdCancelAll = true;
  });
  await dialog.getByRole("button", { name: "Interrupt all", exact: true }).click();
  await page.waitForFunction(() => Boolean(window.testBridge.finishCancelAll));
  assert.equal(await dialog.getByRole("button", { name: "Interrupting", exact: true }).isDisabled(), true);
  await page.keyboard.press("Escape");
  assert.equal(await dialog.isVisible(), true, "cannot dismiss in-flight cancellation");
  await page.evaluate(() => window.testBridge.finishCancelAll());
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await trigger.isDisabled(), true, "no active tasks remain, including filtered-out ones");
  assert.deepEqual(await page.evaluate(() => window.testBridge.tasks.map((task) => task.status)), [
    "interrupted",
    "interrupted",
    "failed",
    "interrupted",
    "completed",
    "interrupted",
  ]);
  await page.setViewportSize({ width: 1240, height: 820 });
}
