/* global window, document */
import assert from "node:assert/strict";

export async function testTrayPopup({ browser, screenshots }) {
  const page = await browser.newPage({
    viewport: { width: 360, height: 560 },
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.trayTest = {
      calls: [],
      fail: false,
      failAction: false,
      holdAction: false,
      summary: {
        running: 2,
        queued: 1,
        speedBytes: 4404019,
        transfers: [
          {
            id: "a",
            name: "Harry_Potter",
            status: "running",
            completedFiles: 6,
            totalFiles: 7,
            downloadedBytes: 181.7 * 1024 ** 2,
            totalBytes: 1.8 * 1024 ** 3,
            speedBytes: 2936013,
            progress: 66.67,
          },
          {
            id: "b",
            name: "Documentaries with an exceptionally long folder name",
            status: "running",
            totalFiles: 0,
            completedFiles: 0,
            speedBytes: 1468006,
            progress: null,
          },
          {
            id: "c",
            name: "Planet Earth",
            status: "queued",
            totalFiles: 0,
            completedFiles: 0,
            speedBytes: null,
            progress: null,
          },
        ],
      },
    };
    window.__TAURI_INTERNALS__ = {
      async invoke(command, args) {
        window.trayTest.calls.push({ command, args });
        if (command === "list_download_tasks") {
          if (window.trayTest.fail) throw new Error("offline");
          return window.trayTest.summary.transfers.map((task, index) => ({
            id: task.id,
            url: `https://example.test/${encodeURIComponent(task.name)}/`,
            status: task.status,
            output: `/Downloads/${task.name}`,
            createdAt: index,
            updatedAt: index,
            overallProgress: {
              completedFiles: task.completedFiles ?? 0,
              totalFiles: task.totalFiles ?? 0,
              downloadedBytes: task.downloadedBytes ?? 0,
              totalBytes: task.totalBytes ?? 0,
              speedBytes: task.speedBytes,
              updatedAt: Date.now(),
            },
          }));
        }
        if (["open_output_folder", "cancel_download_task", "resume_download_task"].includes(command)) {
          if (window.trayTest.failAction) throw new Error("Restart Visuales before resuming downloads.");
          if (window.trayTest.holdAction)
            await new Promise((resolve) => {
              window.trayTest.finishAction = resolve;
            });
          const task = window.trayTest.summary.transfers.find((task) => task.id === args.id);
          if (command === "cancel_download_task") task.status = "interrupted";
          if (command === "resume_download_task") task.status = "running";
        }
        return null;
      },
    };
  });
  try {
    await page.goto(`${process.env.DESKTOP_URL || "http://127.0.0.1:1420"}/?tray`);
    await page.waitForFunction(() => document.querySelectorAll(".tray-transfer").length === 3);
    assert.equal(await page.locator(".tray-summary").count(), 0, "no separate status toolbar");
    const headerBounds = await page.locator(".tray-header").boundingBox();
    const listBounds = await page.locator(".tray-transfers").boundingBox();
    assert.equal(listBounds.y, headerBounds.y + headerBounds.height, "transfers start immediately below header");
    assert.equal(await page.locator(".tray-footer [aria-label='Combined download speed']").count(), 1);
    await page.getByText("4.2 MB/s", { exact: true }).waitFor();
    assert.equal(await page.getByRole("progressbar").count(), 1, "unknown and queued totals have no fake progress");
    await page.getByText("9% · 6 of 7 files", { exact: true }).waitFor();
    assert.equal(Math.floor(Number(await page.getByRole("progressbar").getAttribute("aria-valuenow"))), 9);
    await page.getByText("181.7 MB / 1.8 GB", { exact: true }).waitFor();
    const fileCounts = await page.getByText("9% · 6 of 7 files", { exact: true }).boundingBox();
    const byteCounts = await page.getByText("181.7 MB / 1.8 GB", { exact: true }).boundingBox();
    const progressBounds = await page.getByRole("progressbar").boundingBox();
    assert.ok(fileCounts && byteCounts && progressBounds);
    assert.equal(fileCounts.y, byteCounts.y, "byte totals share the file-count line");
    assert.ok(byteCounts.y + byteCounts.height <= progressBounds.y, "byte totals stay above the bar");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    await page.screenshot({ path: `${screenshots}/tray-light.png` });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForFunction(() => document.documentElement.classList.contains("dark"));
    await page.screenshot({ path: `${screenshots}/tray-dark.png` });
    const interrupt = page.getByRole("button", { name: "Interrupt Harry_Potter", exact: true });
    await interrupt.hover();
    await page.getByRole("tooltip").filter({ hasText: "Interrupt download" }).waitFor();
    const originalButton = await interrupt.elementHandle();
    await page.waitForTimeout(2200);
    assert.ok(
      await interrupt.evaluate((element, original) => element === original, originalButton),
      "polling preserves the hovered button"
    );
    assert.ok(await page.getByRole("tooltip").isVisible(), "tooltip stays open through polling");
    await page.getByRole("button", { name: "Open output folder for Harry_Potter", exact: true }).hover();
    await page.getByRole("tooltip").filter({ hasText: "Open download folder" }).waitFor();
    const tooltipBounds = await page.getByRole("tooltip").boundingBox();
    assert.ok(
      tooltipBounds && tooltipBounds.x >= 0 && tooltipBounds.x + tooltipBounds.width <= 360,
      "tooltip fits the popup"
    );
    await page.screenshot({ path: `${screenshots}/tray-tooltip.png` });
    await page.getByText("Harry_Potter", { exact: true }).click();
    assert.equal(
      await page.evaluate(() => window.trayTest.calls.some((call) => call.command === "open_downloads")),
      false,
      "rows are not navigation buttons"
    );
    await page.getByRole("button", { name: "Open output folder for Harry_Potter", exact: true }).click();
    assert.ok(
      await page.evaluate(() =>
        window.trayTest.calls.some(
          (call) => call.command === "open_output_folder" && call.args.path === "/Downloads/Harry_Potter"
        )
      )
    );
    const filter = page.getByRole("combobox", { name: "Transfer status" });
    await filter.hover();
    await page.getByRole("tooltip").filter({ hasText: "Showing: Active" }).waitFor();
    assert.equal(await filter.locator(".tray-filter-indicator").count(), 0);
    const choose = async (label) => {
      await filter.click();
      await page.getByRole("option", { name: label, exact: true }).click();
    };
    await filter.click();
    await page.waitForTimeout(2200);
    await page.getByRole("option", { name: "All statuses", exact: true }).waitFor();
    await page.screenshot({ path: `${screenshots}/tray-filter.png` });
    await page.keyboard.press("Escape");
    assert.equal(
      await page.evaluate(() => window.trayTest.calls.some((call) => call.command === "dismiss_tray")),
      false,
      "Escape closes filter before popup"
    );
    await choose("All statuses");
    assert.equal(await filter.locator(".tray-filter-indicator").count(), 1);
    await page.evaluate(() => {
      window.trayTest.holdAction = true;
    });
    await page.getByRole("button", { name: "Interrupt Harry_Potter", exact: true }).click();
    await page.getByRole("status", { name: "Updating Harry_Potter" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Interrupt Harry_Potter", exact: true }).count(), 0);
    await page.evaluate(() => {
      window.trayTest.holdAction = false;
      window.trayTest.finishAction();
    });
    await page.getByRole("button", { name: "Resume Harry_Potter", exact: true }).waitFor();
    assert.equal(
      await page.evaluate(
        () =>
          window.trayTest.calls.filter((call) => call.command === "cancel_download_task" && call.args.id === "a").length
      ),
      1
    );
    await choose("Interrupted");
    await page.waitForFunction(() => document.querySelectorAll(".tray-transfer").length === 1);
    await page.evaluate(() => {
      window.trayTest.failAction = true;
    });
    await page.getByRole("button", { name: "Resume Harry_Potter", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Restart Visuales" }).waitFor();
    await page.evaluate(() => {
      window.trayTest.failAction = false;
    });
    await page.getByRole("button", { name: "Resume Harry_Potter", exact: true }).click();
    await page.getByText("No matching transfers").waitFor();
    await choose("Queued");
    await page.getByRole("button", { name: "Interrupt Planet Earth", exact: true }).click();
    await page.getByText("No matching transfers").waitFor();
    await page.evaluate(() => {
      window.trayTest.summary.transfers.push({
        id: "done",
        name: "Completed album",
        status: "completed",
        completedFiles: 2,
        totalFiles: 2,
        totalBytes: 1000,
        downloadedBytes: 1000,
      });
      window.trayTest.summary.transfers.push({ id: "failed", name: "Failed album", status: "failed" });
    });
    await choose("Completed");
    await page.getByText("Completed album", { exact: true }).waitFor();
    const completedRow = page.getByRole("article", { name: "Completed album", exact: true });
    const nameBounds = await completedRow.locator(".tray-transfer-name").boundingBox();
    const statusBounds = await completedRow.locator(".tray-task-status").boundingBox();
    assert.ok(nameBounds && statusBounds);
    assert.ok(
      Math.abs(nameBounds.y + nameBounds.height / 2 - statusBounds.y - statusBounds.height / 2) < 1,
      "status shares the title line"
    );
    assert.ok(nameBounds.x + nameBounds.width <= statusBounds.x, "status does not overlap the title");
    await page.screenshot({ path: `${screenshots}/tray-completed-compact.png` });
    assert.equal(await page.getByRole("progressbar").getAttribute("aria-valuenow"), "100");
    assert.equal(await page.getByRole("button", { name: /Interrupt|Resume/ }).count(), 0);
    await page.getByRole("button", { name: "Open output folder for Completed album" }).waitFor();
    await choose("Failed");
    await page.getByRole("button", { name: "Resume Failed album" }).waitFor();
    await choose("Running");
    await page.waitForFunction(() => document.querySelectorAll(".tray-transfer").length === 2);
    await choose("Active");
    assert.equal(await filter.locator(".tray-filter-indicator").count(), 0);
    await page.getByRole("button", { name: "Open Downloads" }).click();
    assert.ok(await page.evaluate(() => window.trayTest.calls.some((call) => call.command === "open_downloads")));
    await page.keyboard.press("Escape");
    assert.ok(await page.evaluate(() => window.trayTest.calls.some((call) => call.command === "dismiss_tray")));
    await page.getByRole("button", { name: "Quit Visuales" }).click();
    assert.ok(await page.evaluate(() => window.trayTest.calls.some((call) => call.command === "quit_from_tray")));
    await page.evaluate(() => {
      window.trayTest.fail = true;
    });
    await page.getByText("Transfer status unavailable").waitFor();
    assert.equal(await page.getByText("4.2 MB/s", { exact: true }).count(), 0);
    await page.evaluate(() => {
      window.trayTest.fail = false;
      window.trayTest.summary = { running: 0, queued: 0, speedBytes: null, transfers: [] };
    });
    await page.getByRole("button", { name: "Retry" }).click();
    await page.getByText("No active transfers").waitFor();
    await page.evaluate(() => {
      window.trayTest.summary = {
        running: 0,
        queued: 20,
        speedBytes: null,
        transfers: Array.from({ length: 20 }, (_, i) => ({
          id: String(i),
          name: `Waiting ${i}`,
          status: "queued",
          progress: null,
        })),
      };
    });
    await page.waitForFunction(() => document.querySelectorAll(".tray-transfer").length === 20);
    assert.ok(await page.locator(".tray-transfers").evaluate((el) => el.scrollHeight > el.clientHeight));
    const quitBounds = await page.getByRole("button", { name: "Quit Visuales" }).boundingBox();
    assert.ok(quitBounds && quitBounds.y + quitBounds.height <= 560, "footer stays visible when rows scroll");
    await page.setViewportSize({ width: 360, height: 360 });
    const compactQuitBounds = await page.getByRole("button", { name: "Quit Visuales" }).boundingBox();
    assert.ok(
      compactQuitBounds && compactQuitBounds.y + compactQuitBounds.height <= 360,
      "footer fits a screen-constrained popup"
    );
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}
