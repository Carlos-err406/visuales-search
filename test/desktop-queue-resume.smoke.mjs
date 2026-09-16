/* global window, document */
import assert from "node:assert/strict";

export async function testQueueResume({ page, screenshots }) {
  await page.goto(process.env.DESKTOP_URL || "http://127.0.0.1:1420/");
  await page.getByRole("tab", { name: /Downloads/ }).click();
  const row = page.locator('[data-transfer-id="task-3"]');
  const queue = row.getByRole("button", { name: "Add Cosmos to queue", exact: true });
  await queue.waitFor();
  for (const id of ["task-0", "task-1", "task-4"]) {
    assert.equal(
      await page
        .locator(`[data-transfer-id="${id}"]`)
        .getByRole("button", { name: /to queue$/ })
        .count(),
      0
    );
  }
  await queue.scrollIntoViewIfNeeded();
  const queueBounds = await queue.boundingBox();
  await page.mouse.move(queueBounds.x - 10, queueBounds.y + 2);
  await page.mouse.move(queueBounds.x + 15, queueBounds.y + 2, { steps: 5 });
  await page.getByRole("tooltip").filter({ hasText: "Add to queue" }).waitFor();
  await page.mouse.move(0, 0);
  for (const width of [1240, 390]) {
    await page.setViewportSize({ width, height: 820 });
    await row.scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    const boxes = await row.locator(".task-actions button").evaluateAll((buttons) =>
      buttons.map((button) => {
        const { left, right } = button.getBoundingClientRect();
        return { left, right };
      })
    );
    assert.equal(boxes.length, 4);
    assert.ok(boxes.every((box, index) => box.right <= width && (!index || box.left >= boxes[index - 1].right)));
    await page.screenshot({ path: `${screenshots}/queue-resume-${width}.png` });
  }
  await page.setViewportSize({ width: 1240, height: 820 });
  await page.evaluate(() => {
    window.testBridge.fail = "queue_download_task";
  });
  await queue.click();
  await page.getByRole("alert").filter({ hasText: "Test failure: queue_download_task" }).waitFor();
  await page.evaluate(() => {
    window.testBridge.fail = "";
    window.testBridge.calls = [];
    window.testBridge.holdQueueResume = true;
  });
  await queue.click();
  await row.getByRole("status", { name: "Updating Cosmos" }).waitFor();
  assert.equal(await row.getByRole("button", { name: /Add Cosmos|Resume Cosmos/ }).count(), 0);
  await page.waitForFunction(() => Boolean(window.testBridge.finishQueueResume));
  await page.evaluate(() => {
    window.testBridge.holdQueueResume = false;
    window.testBridge.finishQueueResume();
  });
  await page.waitForFunction(
    () => document.querySelector('[data-transfer-id="task-3"]').dataset.transferStatus === "queued"
  );
  assert.deepEqual(
    await page.evaluate(() => window.testBridge.calls.filter((call) => call.command === "queue_download_task")),
    [{ command: "queue_download_task", args: { id: "task-3" } }]
  );
  await row.getByRole("button", { name: "Cancel Cosmos", exact: true }).click();
  await row.getByRole("button", { name: "Resume Cosmos", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('[data-transfer-id="task-3"]').dataset.transferStatus === "running"
  );

  const failed = page.locator('[data-transfer-id="task-2"]');
  await failed.getByRole("button", { name: /^Details for/ }).click();
  const inspector = page.getByRole("complementary", { name: "Transfer details" });
  await inspector.getByRole("button", { name: "Add transfer to queue", exact: true }).waitFor();
  await page.screenshot({ path: `${screenshots}/queue-resume-inspector.png` });
  await inspector.getByRole("button", { name: "Add transfer to queue", exact: true }).click();
  await inspector.locator(".status.queued").waitFor();
  assert.equal(await inspector.getByRole("button", { name: "Add transfer to queue", exact: true }).count(), 0);
  assert.ok(
    await page.evaluate(() =>
      window.testBridge.calls.some((call) => call.command === "queue_download_task" && call.args.id === "task-2")
    )
  );
  await inspector.getByRole("button", { name: "Close transfer details" }).click();
}
