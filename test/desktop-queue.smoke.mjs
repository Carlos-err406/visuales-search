/* global window, document, Element */
import assert from "node:assert/strict";

export async function testQueueManagement({ page, screenshots, checkLayout }) {
  await page.setViewportSize({ width: 1240, height: 820 });
  await page.goto(process.env.DESKTOP_URL || "http://127.0.0.1:1420/");
  await page.evaluate(() => {
    const base = window.testBridge.tasks[1];
    window.testBridge.tasks = [
      window.testBridge.tasks[0],
      ...["Alpha", "Beta", "Gamma"].map((name, index) => ({
        ...base,
        id: name,
        url: `https://example.test/${name}/`,
        queueOrder: index,
      })),
    ];
  });
  await page.getByRole("tab", { name: /Downloads/ }).click();
  await page.getByRole("button", { name: "Refresh downloads", exact: true }).click();
  await page.getByRole("button", { name: "Downloading downloads (1)", exact: true }).click();
  const rows = page.locator("#panel-downloads .transfer-row");
  await page.getByText("Queue 3 of 3", { exact: true }).waitFor();
  assert.equal(await rows.count(), 3);
  assert.equal(await page.getByRole("button", { name: "Start next: Alpha", exact: true }).isEnabled(), false);
  await page.evaluate(() => {
    window.testBridge.moveDelay = 700;
  });
  await page.getByRole("button", { name: "Start next: Gamma", exact: true }).click();
  assert.equal(
    await page.getByRole("button", { name: "Move up: Gamma", exact: true }).isEnabled(),
    false,
    "pending move disables repeated actions"
  );
  await page.waitForFunction(
    () => document.querySelector("#panel-downloads .transfer-row .file-title")?.textContent === "Gamma"
  );
  assert.equal(await rows.first().locator(".queue-position").textContent(), "Queue 1 of 3");
  await page.evaluate(() => {
    window.testBridge.moveDelay = 0;
  });
  await page.waitForFunction(
    () => document.querySelector('[aria-label="Move down: Gamma"]')?.getAttribute("aria-disabled") !== "true"
  );
  await page.getByRole("button", { name: "Move down: Gamma", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () => document.querySelector("#panel-downloads .transfer-row .file-title")?.textContent === "Alpha"
  );
  await page.getByRole("button", { name: "Move up: Beta", exact: true }).click();
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("#panel-downloads .transfer-row .file-title")]
        .map((el) => el.textContent)
        .join() === "Alpha,Beta,Gamma"
  );
  await page.getByRole("searchbox", { name: "Filter downloads" }).fill("Beta");
  assert.equal(await rows.count(), 1);
  assert.equal(
    await rows.first().locator(".queue-position").textContent(),
    "Queue 2 of 3",
    "positions stay global while filtered"
  );
  await page.getByRole("button", { name: "Start next: Beta", exact: true }).click();
  await page.getByText("Queue 1 of 3", { exact: true }).waitFor();
  await page.getByRole("searchbox", { name: "Filter downloads" }).fill("");
  await page.evaluate(() => {
    window.testBridge.fail = "move_queued_download";
  });
  await page.getByRole("button", { name: "Start next: Gamma", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Test failure: move_queued_download" }).waitFor();
  assert.equal(await rows.first().locator(".file-title").textContent(), "Beta", "failed move does not reorder locally");
  await page.evaluate(() => {
    window.testBridge.fail = "";
  });
  await page.getByRole("button", { name: "Start next: Gamma", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector("#panel-downloads .transfer-row .file-title")?.textContent === "Gamma"
  );
  for (const width of [1240, 760, 390]) {
    await page.setViewportSize({ width, height: 820 });
    await checkLayout();
    await page.screenshot({ path: `${screenshots}/queue-${width}.png` });
  }
  await page.setViewportSize({ width: 1240, height: 820 });
  assert.equal(await page.locator("#panel-downloads [data-reordering]").count(), 0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(() => {
    window.queueMotions = [];
    window.originalAnimate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      const animation = window.originalAnimate.apply(this, args);
      if (this.matches(".transfer-row")) {
        animation.pause();
        animation.currentTime = 0;
        window.queueMotions.push({ element: this, animation });
      }
      return animation;
    };
  });
  await page.getByRole("button", { name: "Start next: Alpha", exact: true }).click();
  await page.waitForFunction(() => window.queueMotions.length === 3);
  const motion = await page.evaluate(() =>
    window.queueMotions.map(({ element, animation }) => ({
      id: element.dataset.transferId,
      duration: animation.effect.getTiming().duration,
      frames: animation.effect.getKeyframes(),
    }))
  );
  assert.ok(motion.every((item) => item.duration === 240 && item.frames[0].transform !== "translateY(0px)"));
  await page.evaluate(() => {
    for (const { animation } of window.queueMotions) animation.currentTime = 100;
    window.queueMidpoints = Object.fromEntries(
      window.queueMotions.map(({ element }) => [element.dataset.transferId, element.getBoundingClientRect().top])
    );
  });
  await page.screenshot({ path: `${screenshots}/queue-reordering.png` });
  await page.getByRole("button", { name: "Move down: Alpha", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.queueMotions.length > 3);
  const jump = await page.evaluate(() =>
    Math.max(
      ...window.queueMotions
        .slice(3)
        .map(({ element }) =>
          Math.abs(element.getBoundingClientRect().top - window.queueMidpoints[element.dataset.transferId])
        )
    )
  );
  assert.ok(jump < 1, `rapid reorder continues from the current position (${jump}px jump)`);
  await page.evaluate(() => {
    for (const { animation } of window.queueMotions) if (animation.playState === "paused") animation.play();
  });
  await page.waitForFunction(() => document.querySelectorAll("[data-reordering]").length === 0);
  const count = await page.evaluate(() => window.queueMotions.length);
  await page.getByRole("button", { name: "Refresh downloads", exact: true }).click();
  assert.equal(
    await page.evaluate(() => window.queueMotions.length),
    count,
    "routine polling does not replay the slide"
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Start next: Beta", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector("#panel-downloads .transfer-row .file-title")?.textContent === "Beta"
  );
  assert.equal(await page.evaluate(() => window.queueMotions.length), count, "reduced motion reorders instantly");
  await page.evaluate(() => {
    Element.prototype.animate = window.originalAnimate;
  });
}
