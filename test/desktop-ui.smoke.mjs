/* global window, document */
// Run against Vite with PLAYWRIGHT_MODULE pointing to an installed Playwright module when needed.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const playwright = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await playwright[process.env.BROWSER || "chromium"].launch({
  headless: true,
  channel: process.env.BROWSER_CHANNEL,
});
const screenshots = resolve(".cache/desktop-ui");
await mkdir(screenshots, { recursive: true });
const page = await browser.newPage({ viewport: { width: 1240, height: 820 }, reducedMotion: "reduce" });
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

try {
  await page.addInitScript(() => {
    const updateScenario = new URL(window.location.href).searchParams.get("updates");
    const now = Date.now();
    const statuses = ["running", "queued", "failed", "interrupted", "completed", "running"];
    const names = [
      "Planet Earth II",
      "Blue Planet",
      "A very long documentary title with additional release details",
      "Cosmos",
      "The Universe",
      "Discovery",
    ];
    const state = {
      settings: JSON.parse(window.localStorage.getItem("test-settings") || "null") || {
        output: "/Users/carlos/Downloads/Visuales",
        concurrent: 5,
        connections: 3,
        maxRetries: 3,
      },
      settingsDefaults: { output: "/Users/carlos/Downloads/Visuales", concurrent: 5, connections: 3, maxRetries: 3 },
      calls: [],
      fail:
        updateScenario === "offline"
          ? "check_app_update"
          : updateScenario === "settings-error"
            ? "get_desktop_settings"
            : "",
      listDelay: 60,
      activeLists: 0,
      updateVersion: updateScenario === "available" ? "1.4.0" : null,
      tasks: statuses.map((status, index) => ({
        id: `task-${index}`,
        url: `https://visuales.uclv.cu/Documentales/${encodeURIComponent(names[index])}/`,
        output: "/Users/carlos/Downloads/Visuales/Documentaries/An exceptionally long destination folder",
        status,
        createdAt: now,
        updatedAt: now,
        lastError: status === "failed" ? "Connection timed out. Partial files retained for resume." : undefined,
        overallProgress:
          index === 5
            ? undefined
            : {
                completedFiles: 2,
                totalFiles: 8,
                downloadedBytes: 375000000,
                totalBytes: 1000000000,
                speedBytes: 2500000,
                updatedAt: now,
              },
      })),
      results: Array.from({ length: 45 }, (_, index) => ({
        text: `Planet Earth - Episode ${String(index + 1).padStart(2, "0")} - A very long descriptive release title`,
        encodedUrl: `https://visuales.uclv.cu/Documentales/Planet%20Earth/${index}/`,
        directory: "/Documentales/Nature/Planet Earth/An exceptionally long nested directory path",
        isDirectoryLink: index % 3 !== 0,
        downloadId: `id-${index}`,
      })),
    };
    window.testBridge = state;
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.__TAURI_INTERNALS__ = {
      transformCallback() {
        return 1;
      },
      async invoke(command, args) {
        state.calls.push({ command, args });
        if (command === "list_download_tasks") {
          state.activeLists++;
          await new Promise((resolve) => setTimeout(resolve, state.listDelay));
          state.activeLists--;
          if (state.fail === command) throw new Error(`Test failure: ${command}`);
          return structuredClone(state.tasks);
        }
        await new Promise((resolve) => setTimeout(resolve, command === "search_content" ? 300 : 60));
        if (state.fail === command) throw new Error(`Test failure: ${command}`);
        if (command.startsWith("plugin:event|")) return 1;
        if (command === "app_update_info")
          return {
            currentVersion: "1.3.10",
            supported: updateScenario !== "unsupported",
            reason: updateScenario === "unsupported" ? "Use the AppImage for in-app updates." : null,
            automatic: Boolean(updateScenario),
          };
        if (command === "check_app_update") return state.updateVersion;
        if (command === "download_app_update") {
          args.onProgress.onmessage({ received: 500000, total: 1000000 });
          await new Promise((resolve) => setTimeout(resolve, 300));
          args.onProgress.onmessage({ received: 1000000, total: 1000000 });
          return null;
        }
        if (command === "install_app_update") {
          if (state.tasks.some((task) => ["running", "queued"].includes(task.status)))
            throw new Error("Transfers are active");
          return null;
        }
        if (command === "restart_after_update") return null;
        if (command === "default_output_dir") return "/Users/carlos/Downloads/Visuales";
        if (command === "get_desktop_settings")
          return structuredClone({ settings: state.settings, defaults: state.settingsDefaults });
        if (command === "save_desktop_settings") {
          state.settings = structuredClone(args.settings);
          window.localStorage.setItem("test-settings", JSON.stringify(state.settings));
          return structuredClone({ settings: state.settings, defaults: state.settingsDefaults });
        }
        if (command === "search_content") return { results: state.results };
        if (command === "plugin:dialog|open") return "/Users/carlos/Downloads/Chosen";
        if (command === "start_download") return { id: "new-task" };
        if (command === "open_output_folder") return null;
        const task = state.tasks.find((item) => item.id === args.id);
        if (command === "resume_download_task") task.status = "running";
        else if (command === "cancel_download_task") task.status = "interrupted";
        else if (command === "delete_download_task") state.tasks = state.tasks.filter((item) => item.id !== args.id);
        else throw new Error(`Unexpected command: ${command}`);
      },
    };
  });
  await page.goto(process.env.DESKTOP_URL || "http://127.0.0.1:1420/");
  await page.getByText("No search results yet").waitFor();
  await page.waitForFunction(() => document.querySelector(".brand-mark use")?.getBBox().width > 0);
  assert.equal(await page.locator(".brand-mark").evaluate((el) => window.getComputedStyle(el).borderRadius), "1px");
  const favicon = await page.locator('link[rel="icon"]').getAttribute("href");
  assert.ok((await page.request.get(new URL(favicon, page.url()).href)).ok(), "app favicon loads");
  const disabledSearch = page.getByRole("button", { name: "Search", exact: true });
  await disabledSearch.focus();
  await page.getByRole("tooltip").waitFor();
  assert.match(await page.getByRole("tooltip").textContent(), /Enter a search term first/);
  await page.keyboard.press("Enter");
  assert.equal(
    await page.evaluate(() => window.testBridge.calls.filter((call) => call.command === "search_content").length),
    0
  );
  await page.screenshot({ path: `${screenshots}/tooltip-disabled-search.png` });
  await page.keyboard.press("Escape");
  await page.getByRole("tooltip").waitFor({ state: "detached" });
  assert.equal(await page.getByText("Connected", { exact: true }).count(), 0);
  assert.equal(await page.locator(".results-toolbar").count(), 0, "no empty selection toolbar");
  await page.screenshot({ path: `${screenshots}/default-empty.png` });
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  await page.getByLabel("Default output folder", { exact: true }).waitFor();
  const settingsOutput = page.getByLabel("Default output folder", { exact: true });
  const concurrentFiles = page.getByLabel("Concurrent files", { exact: true });
  const retries = page.getByLabel("Retries per file", { exact: true });
  const saveSettings = page.getByRole("button", { name: "Save changes", exact: true });
  assert.equal(await concurrentFiles.inputValue(), "5");
  const connections = page.getByLabel("Connections per file", { exact: true });
  assert.equal(await connections.inputValue(), "3");
  assert.equal(await connections.getAttribute("readonly"), null);
  assert.equal(await saveSettings.isDisabled(), true);
  await page.screenshot({ path: `${screenshots}/settings-default.png` });
  await concurrentFiles.fill("2");
  await connections.fill("9");
  assert.equal(await saveSettings.isDisabled(), true);
  await page.getByText("Enter a whole number from 1 to 8.", { exact: true }).waitFor();
  await connections.fill("4");
  await retries.fill("0");
  await page.getByRole("button", { name: "Choose default output folder", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("#settings-output").value.endsWith("/Chosen"));
  await page.getByRole("tab", { name: "Search", exact: true }).click();
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  assert.equal(await concurrentFiles.inputValue(), "2", "unsaved edits survive navigation");
  await concurrentFiles.fill("0");
  assert.equal(await saveSettings.isDisabled(), true);
  await page.getByText("Enter a whole number from 1 to 32.", { exact: true }).waitFor();
  await concurrentFiles.fill("2");
  await page.evaluate(() => {
    window.testBridge.fail = "save_desktop_settings";
  });
  await saveSettings.click();
  await page.getByRole("alert").filter({ hasText: "Test failure: save_desktop_settings" }).waitFor();
  assert.equal(await concurrentFiles.inputValue(), "2", "save errors retain draft");
  await page.evaluate(() => {
    window.testBridge.fail = "";
  });
  await saveSettings.click();
  await page.getByText("Saved", { exact: true }).waitFor();
  await page.reload();
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("#settings-concurrent")?.value === "2");
  assert.equal(await retries.inputValue(), "0");
  assert.equal(await connections.inputValue(), "4");
  assert.equal(await settingsOutput.inputValue(), "/Users/carlos/Downloads/Chosen");
  await settingsOutput.fill(`/Users/carlos/Downloads/${"Long destination folder ".repeat(12)}`);
  for (const viewport of [
    { width: 1240, height: 820 },
    { width: 760, height: 620 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.screenshot({ path: `${screenshots}/settings-${viewport.width}.png` });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true,
      "settings has no horizontal overflow"
    );
    const bounds = await saveSettings.boundingBox();
    assert.ok(bounds.y + bounds.height <= viewport.height, "save action stays reachable");
  }
  await page.setViewportSize({ width: 1240, height: 820 });
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  assert.equal(await settingsOutput.inputValue(), "/Users/carlos/Downloads/Chosen");
  await page.getByRole("button", { name: "Restore defaults", exact: true }).click();
  assert.equal(await concurrentFiles.inputValue(), "5");
  assert.equal(await connections.inputValue(), "3");
  assert.equal(await saveSettings.isEnabled(), true, "reset requires explicit save");
  await saveSettings.click();
  await page.getByText("Saved", { exact: true }).waitFor();
  await page.reload();
  await page.getByText("No search results yet").waitFor();
  const search = page.getByRole("searchbox", { name: "Search library", exact: true });
  await search.fill("planet earth");
  await search.focus();
  assert.equal(await search.evaluate((el) => window.getComputedStyle(el).outlineStyle), "none");
  await page.screenshot({ path: `${screenshots}/default-search-focus.png` });
  await page.getByLabel("Clear search", { exact: true }).click();
  assert.equal(await search.inputValue(), "");
  assert.equal(await search.evaluate((el) => el === document.activeElement), true);
  await search.fill("planet earth");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Searching", exact: true }).isDisabled(), true);
  await page.locator(".result-row").first().waitFor();
  assert.equal(await page.locator(".result-row").count(), 45);
  const checkboxes = page.locator('.result-row [role="checkbox"]');
  await checkboxes.nth(0).check();
  await checkboxes.nth(3).click({ modifiers: ["Shift"] });
  assert.equal(await page.locator('.result-row [role="checkbox"][aria-checked="true"]').count(), 4, "shift selection");
  async function checkSelectionAccents() {
    const rows = await page.locator(".result-row").evaluateAll((elements) =>
      elements.map((el) => ({
        checked: el.querySelector('[role="checkbox"]').getAttribute("aria-checked") === "true",
        shadow: window.getComputedStyle(el).boxShadow,
      }))
    );
    for (const row of rows) {
      if (row.checked)
        assert.match(row.shadow, /3px 0px 0px 0px inset|inset 3px 0px 0px 0px/, "selected row has accent");
      else assert.equal(row.shadow, "none", "unselected row has no selection accent, even when focused");
    }
  }
  await checkSelectionAccents();
  await search.focus();
  await checkSelectionAccents();
  await checkboxes.nth(4).focus();
  await checkSelectionAccents();
  await checkboxes.nth(3).uncheck();
  await checkSelectionAccents();
  await checkboxes.nth(3).check();
  await checkSelectionAccents();
  await page.screenshot({ path: `${screenshots}/selection-accents.png` });
  assert.equal(await page.getByLabel("Download destination").inputValue(), "/Users/carlos/Downloads/Visuales");
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  await settingsOutput.fill("/Users/carlos/Downloads/New default");
  await saveSettings.click();
  await page.getByText("Saved", { exact: true }).waitFor();
  await page.getByRole("tab", { name: "Search", exact: true }).click();
  assert.equal(await page.getByLabel("Download destination").inputValue(), "/Users/carlos/Downloads/New default");
  await page.getByLabel("Download destination").fill("/Users/carlos/Downloads/Visuales");
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  await retries.fill("4");
  await saveSettings.click();
  await page.getByText("Saved", { exact: true }).waitFor();
  await page.getByRole("tab", { name: "Search", exact: true }).click();
  assert.equal(
    await page.getByLabel("Download destination").inputValue(),
    "/Users/carlos/Downloads/Visuales",
    "saving defaults preserves an explicit destination"
  );
  assert.equal(await page.getByRole("checkbox", { name: "Select all results" }).getAttribute("aria-checked"), "mixed");
  const checkboxStyles = await page.getByRole("checkbox").evaluateAll((inputs) =>
    inputs.map((input) => {
      const style = window.getComputedStyle(input);
      return { radius: style.borderRadius, width: style.width, height: style.height };
    })
  );
  for (const style of checkboxStyles) {
    assert.deepEqual(style, { radius: "1px", width: "15px", height: "15px" });
  }
  assert.equal(await checkboxes.nth(0).locator('[data-slot="checkbox-indicator"]').isVisible(), true);
  assert.equal(await checkboxes.nth(4).locator('[data-slot="checkbox-indicator"]').isVisible(), false);
  assert.equal(await page.getByRole("checkbox", { name: "Select all results" }).locator(".lucide-minus").count(), 1);
  await checkboxes.nth(0).focus();
  await page.screenshot({ path: `${screenshots}/checkbox-states.png` });
  await page.getByLabel("Choose output folder").hover();
  await page.getByRole("tooltip").waitFor();
  assert.match(await page.getByRole("tooltip").textContent(), /Pick the parent folder/);
  assert.equal(
    await page.getByLabel("Choose output folder").getAttribute("title"),
    null,
    "no duplicate native tooltip"
  );
  await page.locator(".button-tooltip").hover();
  assert.equal(await page.locator(".button-tooltip").isVisible(), true, "tooltip remains readable under pointer");
  await page.screenshot({ path: `${screenshots}/tooltip-folder-picker.png` });
  await page.keyboard.press("Escape");
  await page.getByRole("tooltip").waitFor({ state: "detached" });
  await page.getByLabel("Open output folder", { exact: true }).focus();
  await page.getByRole("tooltip").waitFor();
  assert.match(await page.getByRole("tooltip").textContent(), /without changing the destination/);
  await page.keyboard.press("Escape");
  await page.getByRole("tooltip").waitFor({ state: "detached" });
  await page.getByLabel("Choose output folder").click();
  await page.waitForFunction(() => document.querySelector("#destination").value.endsWith("/Chosen"));
  await page.getByLabel("Open output folder", { exact: true }).click();
  assert.equal(
    await page.evaluate(() => window.testBridge.calls.find((call) => call.command === "open_output_folder").args.path),
    "/Users/carlos/Downloads/Chosen"
  );
  await page.evaluate(() => {
    window.testBridge.fail = "open_output_folder";
  });
  await page.getByLabel("Open output folder", { exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Test failure: open_output_folder" }).waitFor();
  await page.evaluate(() => {
    window.testBridge.fail = "";
  });
  await page.getByLabel("Open output folder", { exact: true }).click();
  await page.locator(".selection-error").waitFor({ state: "detached" });
  await page.locator(".results-list").evaluate((el) => {
    el.scrollTop = 500;
  });
  await page.getByRole("tab", { name: /Downloads/ }).click();
  await page.getByRole("table", { name: "Downloads", exact: true }).waitFor();
  const completedColors = await page.evaluate(() => {
    const completed = document.querySelector("#panel-downloads .transfer-row.completed");
    return {
      primary: window.getComputedStyle(document.querySelector(".brand-mark")).backgroundColor,
      bar: window.getComputedStyle(completed.querySelector('[data-slot="progress-indicator"]')).backgroundColor,
      status: window.getComputedStyle(completed.querySelector(".status")).color,
    };
  });
  assert.equal(completedColors.bar, completedColors.primary, "completed progress uses the primary color");
  assert.equal(completedColors.status, completedColors.primary, "completed status uses the primary color");
  await page.getByRole("tab", { name: "Search", exact: true }).click();
  assert.equal(await search.inputValue(), "planet earth");
  assert.equal(await page.locator('.result-row [role="checkbox"][aria-checked="true"]').count(), 4);
  assert.equal(await page.locator(".results-list").evaluate((el) => el.scrollTop), 500);

  async function checkLayout(name) {
    const problems = await page.evaluate(() => {
      const issues = [];
      if (document.documentElement.scrollWidth > window.innerWidth) issues.push("page overflow");
      const panel = document.querySelector('[role="tabpanel"]:not([hidden])');
      const toolbar = panel.querySelector(".downloads-toolbar");
      if (toolbar && window.innerWidth > 680) {
        const rect = toolbar.getBoundingClientRect();
        const controls = toolbar.querySelectorAll(
          '.downloads-heading, .filter-field, [data-slot="select-trigger"], .downloads-refresh'
        );
        for (const control of controls) {
          const box = control.getBoundingClientRect();
          if (Math.abs(box.top + box.height / 2 - (rect.top + rect.height / 2)) > 1)
            issues.push("downloads toolbar controls are not on one row");
        }
        if (Math.abs(rect.height - 64) > 1) issues.push(`downloads toolbar height: ${rect.height}`);
      }
      const searchForm = panel.querySelector(".search-form");
      if (searchForm) {
        const form = searchForm.getBoundingClientRect();
        const button = searchForm.querySelector(".search-submit").getBoundingClientRect();
        const insets = [button.top - form.top, form.right - button.right, form.bottom - button.bottom];
        if (insets.some((inset) => Math.abs(inset - 6) > 0.5))
          issues.push(`search button insets: ${insets.join(", ")}`);
      }
      for (const selector of [
        ".search-form",
        ".selection-bar",
        ".activity-tray",
        ".downloads-toolbar",
        ".downloads-footer",
      ]) {
        const element = panel.querySelector(selector);
        if (!element) continue;
        const rect = element.getBoundingClientRect();
        if (rect.left < 0 || rect.right > window.innerWidth + 1 || rect.bottom > window.innerHeight + 1)
          issues.push(selector);
      }
      const list = panel.querySelector(".list-scroll");
      if (list.clientHeight < 70 || list.scrollWidth > list.clientWidth + 1) {
        issues.push(
          `list overflow or collapsed: ${list.clientWidth}x${list.clientHeight}, content width ${list.scrollWidth}`
        );
        const right = list.getBoundingClientRect().right;
        for (const child of list.querySelectorAll("*")) {
          if (child.getBoundingClientRect().right > right + 1) issues.push(`${child.tagName}.${child.className}`);
        }
      }
      for (const element of panel.querySelectorAll("button, input, select")) {
        if (element.getAttribute("aria-hidden") === "true" || element.type === "hidden") continue;
        if (!element.getClientRects().length || element.closest(".list-scroll, .tray-list")) continue;
        const rect = element.getBoundingClientRect();
        if (rect.left < 0 || rect.right > window.innerWidth + 1)
          issues.push(element.getAttribute("aria-label") || element.textContent);
      }
      return issues;
    });
    await page.screenshot({ path: `${screenshots}/${name}.png` });
    assert.deepEqual(problems, [], `${name} fits`);
  }

  await page.emulateMedia({ reducedMotion: "no-preference" });
  for (const [name, width, height] of [
    ["default", 1240, 820],
    ["minimum", 760, 620],
    ["mobile", 390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await checkLayout(`${name}-search`);
    await page.locator(".tray-toggle").click();
    await checkLayout(`${name}-expanded`);
    await page.locator(".tray-toggle").click();
    await page.getByRole("tab", { name: /Downloads/ }).click();
    await checkLayout(`${name}-downloads`);
    assert.equal(await page.locator(".download-count").textContent(), "6", "one unfiltered download count");
    await page.getByLabel("Cancel Planet Earth II", { exact: true }).hover({ position: { x: 15, y: 2 } });
    await page.getByRole("tooltip").waitFor();
    assert.match(await page.getByRole("tooltip").textContent(), /Cancel download/);
    const removeButton = page.getByLabel("Remove task Planet Earth II", { exact: true });
    const removeBox = await removeButton.boundingBox();
    await page.mouse.move(removeBox.x + 15, removeBox.y + 2, { steps: 12 });
    await page.waitForFunction(() => document.querySelector(".tooltip-title")?.textContent === "Remove from history");
    await page.getByRole("tooltip").waitFor();
    assert.match(await page.getByRole("tooltip").textContent(), /Stop this task.*Downloaded files are kept/);
    const tooltipBox = await page.locator(".button-tooltip").boundingBox();
    assert.ok(
      tooltipBox.x >= 0 &&
        tooltipBox.y >= 0 &&
        tooltipBox.x + tooltipBox.width <= width &&
        tooltipBox.y + tooltipBox.height <= height
    );
    assert.equal(
      await page.locator(".button-tooltip").evaluate((el) => window.getComputedStyle(el).borderRadius),
      "1px"
    );
    await page.screenshot({ path: `${screenshots}/${name}-tooltip.png` });
    for (const [label, title] of [
      ["Cancel Planet Earth II", "Cancel download"],
      ["Open output folder for Planet Earth II", "Open download folder"],
      ["Remove task Planet Earth II", "Remove from history"],
    ]) {
      const box = await page.getByLabel(label, { exact: true }).boundingBox();
      await page.mouse.move(box.x + 15, box.y + 2, { steps: 12 });
      await page.waitForFunction(
        (expected) => document.querySelector(".tooltip-title")?.textContent === expected,
        title
      );
      assert.equal(await page.getByRole("tooltip").count(), 1, "only the hovered action has a tooltip");
      // Crossing button gaps can exceed closeDelay on CI; a reopened popup is valid.
      // Stationary-hover identity and flicker are checked separately below.
      assert.equal(
        await page.getByRole("tooltip").evaluate((el) => el.getAnimations().length),
        0,
        "tooltip does not replay entrance animations between actions"
      );
    }
    await page.locator(".button-tooltip").hover();
    assert.equal(await page.locator(".button-tooltip").isVisible(), true, "switched tooltip remains hoverable");
    if (name === "minimum") {
      await page.locator(".downloads-list").evaluate((el) => {
        el.scrollTop = 80;
      });
      await page.getByRole("tooltip").waitFor({ state: "detached" });
      await page.locator(".downloads-list").evaluate((el) => {
        el.scrollTop = 0;
      });
    }
    await page.keyboard.press("Escape");
    await page.getByRole("tooltip").waitFor({ state: "detached" });
    await page.getByRole("tab", { name: "Search", exact: true }).click();
  }
  await page.setViewportSize({ width: 1240, height: 820 });
  await page.getByRole("tab", { name: /Downloads/ }).click();
  await page.evaluate(() => {
    window.testBridge.listDelay = 200;
    window.testBridge.tasks[0].overallProgress.downloadedBytes = 500000000;
  });
  const refreshButton = page.getByRole("button", { name: "Refresh downloads", exact: true });
  await refreshButton.hover();
  await page.getByRole("tooltip").waitFor();
  const stationaryHover = await page.evaluate(async () => {
    const button = document.querySelector(".downloads-refresh");
    const popup = document.querySelector('[role="tooltip"]');
    const initialText = popup.textContent;
    const initialOpacity = window.getComputedStyle(button).opacity;
    const callsBefore = window.testBridge.calls.filter((call) => call.command === "list_download_tasks").length;
    const changes = new Set();
    const started = performance.now();
    await new Promise((resolve) => {
      const sample = () => {
        if (button.getAttribute("aria-disabled") === "true") changes.add("button disabled");
        if (button.querySelector(".spin")) changes.add("icon spinning");
        if (window.getComputedStyle(button).opacity !== initialOpacity) changes.add("button opacity changed");
        if (document.querySelector('[role="tooltip"]') !== popup) changes.add("popup replaced or removed");
        if (popup.textContent !== initialText) changes.add("tooltip text changed");
        if (window.getComputedStyle(popup).opacity !== "1") changes.add("tooltip opacity changed");
        if (performance.now() - started >= 5000) resolve();
        else window.requestAnimationFrame(sample);
      };
      window.requestAnimationFrame(sample);
    });
    return {
      changes: [...changes],
      polls: window.testBridge.calls.filter((call) => call.command === "list_download_tasks").length - callsBefore,
    };
  });
  assert.ok(stationaryHover.polls >= 2, "background polling continues during stationary hover");
  assert.deepEqual(stationaryHover.changes, [], "background polling must not flicker the refresh button or tooltip");
  assert.match(await page.locator("#panel-downloads .transfer-row").first().textContent(), /50%/);
  await page.screenshot({ path: `${screenshots}/stationary-refresh-tooltip.png` });
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    window.testBridge.listDelay = 500;
  });
  await page.waitForFunction(() => window.testBridge.activeLists > 0);
  assert.equal(await refreshButton.isEnabled(), true, "automatic refresh does not disable manual refresh");
  await refreshButton.click();
  assert.equal(await refreshButton.isDisabled(), true, "manual refresh shows busy feedback during an existing poll");
  assert.equal(await refreshButton.locator(".spin").count(), 1);
  await page.waitForFunction(
    () => document.querySelector(".downloads-refresh").getAttribute("aria-disabled") !== "true"
  );
  assert.equal(await refreshButton.locator(".spin").count(), 0);
  await page.evaluate(() => {
    window.testBridge.fail = "list_download_tasks";
  });
  await refreshButton.click();
  await page.getByRole("alert").filter({ hasText: "Test failure: list_download_tasks" }).waitFor();
  await page.waitForFunction(
    () => document.querySelector(".downloads-refresh").getAttribute("aria-disabled") !== "true"
  );
  assert.equal(await refreshButton.locator(".spin").count(), 0, "failed manual refresh clears busy feedback");
  await page.evaluate(() => {
    window.testBridge.listDelay = 60;
    window.testBridge.fail = "";
  });
  await page.getByLabel("Reconnect", { exact: true }).click();
  await page.locator(".connection-error").waitFor({ state: "detached" });
  await page.getByRole("tab", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: "Queue", exact: true }).click();
  await page.getByText("Transfer added to queue").waitFor();
  const confirmationShownAt = Date.now();
  const queued = await page.evaluate(() => window.testBridge.calls.find((call) => call.command === "start_download"));
  assert.equal(queued.args.queue, true);
  assert.equal(queued.args.urls.length, 4);
  assert.equal(queued.args.output, "/Users/carlos/Downloads/Chosen");
  assert.equal(await page.locator(".selection-bar").count(), 0);
  await page.waitForFunction(
    () => document.querySelector('.result-row [role="checkbox"]').getAttribute("aria-disabled") !== "true"
  );
  await checkboxes.nth(0).focus();
  await page.keyboard.press("Space");
  assert.equal(await checkboxes.nth(0).isChecked(), true, "keyboard selection");
  await page.getByText("Transfer added to queue").waitFor({ state: "detached", timeout: 6000 });
  assert.ok(Date.now() - confirmationShownAt >= 3000, "confirmation stays visible before expiring");
  assert.equal(await checkboxes.nth(0).isChecked(), true, "expiring confirmation retains new selection");
  await page.evaluate(() => {
    window.testBridge.fail = "start_download";
  });
  await page.getByRole("button", { name: "Download", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Test failure: start_download" }).waitFor();
  assert.equal(await checkboxes.nth(0).isChecked(), true, "failure retains selection");
  await page.evaluate(() => {
    window.testBridge.fail = "";
  });
  await page.getByRole("button", { name: "Download", exact: true }).click();
  await page.getByText("Transfer started").waitFor();
  assert.equal(
    await page.evaluate(
      () => window.testBridge.calls.filter((call) => call.command === "start_download").at(-1).args.queue
    ),
    false
  );
  await page.getByRole("checkbox", { name: "Select all results" }).check();
  assert.equal(await page.locator('.result-row [role="checkbox"][aria-checked="true"]').count(), 45);
  await page.getByLabel("Clear selection").click();
  assert.equal(await page.locator('.result-row [role="checkbox"][aria-checked="true"]').count(), 0);
  await page.getByRole("tab", { name: "Search", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.getByRole("tab", { name: /Downloads/ }).getAttribute("aria-selected"), "true");
  await page.getByRole("combobox", { name: "Download status" }).click();
  await page.screenshot({ path: `${screenshots}/status-select.png` });
  assert.equal(
    await page.locator('[data-slot="select-content"]').evaluate((el) => window.getComputedStyle(el).borderRadius),
    "1px"
  );
  await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "option");
  await page.keyboard.press("End");
  await page.waitForFunction(() => document.activeElement?.textContent === "Completed");
  await page.keyboard.press("Enter");
  await page.getByRole("listbox").waitFor({ state: "detached" });
  assert.equal(await page.locator("#panel-downloads .transfer-row").count(), 1, "keyboard status filter");
  assert.equal(await page.locator(".download-count").textContent(), "1 of 6");
  assert.equal(
    await page.getByRole("combobox", { name: "Download status" }).evaluate((el) => el === document.activeElement),
    true,
    "select returns focus to its trigger"
  );
  await page.getByRole("combobox", { name: "Download status" }).click();
  await page.getByRole("option", { name: "Needs attention" }).click();
  assert.equal(await page.locator("#panel-downloads .transfer-row").count(), 2);
  assert.equal(await page.locator(".download-count").textContent(), "2 of 6");
  await page.getByLabel("Filter downloads").fill("Cosmos");
  assert.equal(await page.locator("#panel-downloads .transfer-row").count(), 1);
  await page.getByRole("button", { name: "Resume Cosmos", exact: true }).click();
  await page.getByText("No matching transfers").waitFor();
  assert.equal(await page.locator(".download-count").textContent(), "0 of 6");
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByLabel("Open output folder for Cosmos", { exact: true }).click();
  assert.equal(
    await page.evaluate(
      () => window.testBridge.calls.filter((call) => call.command === "open_output_folder").at(-1).args.path
    ),
    "/Users/carlos/Downloads/Visuales/Documentaries/An exceptionally long destination folder"
  );
  await page.getByRole("button", { name: "Cancel Cosmos", exact: true }).click();
  await page.getByRole("button", { name: "Resume Cosmos", exact: true }).waitFor();
  await page.evaluate(() => {
    window.testBridge.fail = "delete_download_task";
  });
  await page.getByRole("button", { name: "Remove task Cosmos", exact: true }).click();
  await page.getByText("Error: Test failure: delete_download_task").waitFor();
  await page.evaluate(() => {
    window.testBridge.fail = "";
  });
  await page.getByRole("button", { name: "Remove task Cosmos", exact: true }).click();
  await page.getByRole("button", { name: "Remove task Cosmos", exact: true }).waitFor({ state: "detached" });
  await page.evaluate(() => {
    window.testBridge.tasks = window.testBridge.tasks.filter((task) => task.status === "failed");
  });
  await page.getByLabel("Refresh downloads").click();
  await page.waitForFunction(() => document.querySelectorAll("#panel-downloads .transfer-row").length === 1);
  await page.getByRole("tab", { name: "Search", exact: true }).click();
  assert.equal(await page.locator(".activity-tray").count(), 0, "idle tray hidden");
  assert.equal(await page.locator(".failure-count").textContent(), "1", "idle failures discoverable");
  await page.evaluate(() => {
    window.testBridge.fail = "search_content";
  });
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Test failure: search_content" }).waitFor();
  assert.equal(await page.locator(".result-row").count(), 45, "search failure retains results");
  await page.evaluate(() => {
    window.testBridge.fail = "";
    window.testBridge.results = [];
  });
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByText("No matching results").waitFor();
  await page.evaluate(() => {
    window.testBridge.fail = "list_download_tasks";
  });
  await page.getByRole("alert").filter({ hasText: "Test failure: list_download_tasks" }).waitFor();
  await page.evaluate(() => {
    window.testBridge.fail = "";
    window.testBridge.tasks = Array.from({ length: 25 }, (_, index) => ({
      ...window.testBridge.tasks[0],
      id: `external-${index}`,
      status: "completed",
      lastError: undefined,
    }));
  });
  await page.getByLabel("Reconnect").click();
  await page.locator(".connection-error").waitFor({ state: "detached" });
  await page.getByRole("tab", { name: /Downloads/ }).click();
  await page.waitForFunction(() => document.querySelectorAll("#panel-downloads .transfer-row").length === 25);
  await page.locator(".downloads-list").evaluate((el) => {
    el.scrollTop = 450;
  });
  await page.getByRole("tab", { name: "Search", exact: true }).click();
  await page.getByRole("tab", { name: /Downloads/ }).click();
  assert.equal(await page.locator(".downloads-list").evaluate((el) => el.scrollTop), 450);
  await page.getByLabel("App updates", { exact: true }).click();
  await page.getByRole("button", { name: "Check for updates", exact: true }).click();
  await page.getByText("You're up to date.").waitFor();
  await page.evaluate(() => {
    window.testBridge.fail = "check_app_update";
  });
  await page.getByRole("button", { name: "Check for updates", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Test failure: check_app_update" }).waitFor();
  await page.evaluate(() => {
    window.testBridge.fail = "";
    window.testBridge.updateVersion = "1.4.0";
  });
  await page.getByRole("button", { name: "Check for updates", exact: true }).click();
  await page.getByText("Visuales 1.4.0 is available.").waitFor();
  await page.getByLabel("Dismiss app updates", { exact: true }).click();
  assert.equal(await page.locator("#app-updates").count(), 0);
  await page.getByLabel("App updates", { exact: true }).click();
  await page.evaluate(() => {
    window.testBridge.fail = "download_app_update";
  });
  await page.getByRole("button", { name: "Download update", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Test failure: download_app_update" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Install update", exact: true }).count(), 0);
  await page.evaluate(() => {
    window.testBridge.fail = "";
  });
  await page.getByRole("button", { name: "Download update", exact: true }).click();
  await page.getByRole("progressbar", { name: "App update download" }).waitFor();
  await page.getByRole("button", { name: "Install update", exact: true }).waitFor();
  await page.evaluate(() => {
    window.testBridge.tasks[0].status = "running";
  });
  await page.getByLabel("Refresh downloads", { exact: true }).click();
  await page.getByText("Update verified. Finish or cancel running and queued transfers before installing.").waitFor();
  assert.equal(await page.getByRole("button", { name: "Install update", exact: true }).isDisabled(), true);
  await page.setViewportSize({ width: 390, height: 844 });
  await checkLayout("mobile-app-update");
  await page.screenshot({ path: `${screenshots}/mobile-app-update.png` });
  await page.setViewportSize({ width: 1240, height: 820 });
  await page.evaluate(() => {
    window.testBridge.tasks[0].status = "completed";
  });
  await page.getByLabel("Refresh downloads", { exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector("#app-updates button:not(.icon-button)")?.getAttribute("aria-disabled") !== "true"
  );
  await page.evaluate(() => {
    window.testBridge.fail = "install_app_update";
  });
  await page.getByRole("button", { name: "Install update", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Test failure: install_app_update" }).waitFor();
  await page.evaluate(() => {
    window.testBridge.fail = "";
  });
  await page.getByRole("button", { name: "Install update", exact: true }).click();
  await page.getByRole("button", { name: "Restart app", exact: true }).waitFor();
  assert.equal(await page.locator(".action-spinner").count(), 0, "App updates must not show task-action spinners");
  assert.equal(
    await page
      .getByRole("button", { name: /^Remove task / })
      .first()
      .isDisabled(),
    true
  );
  assert.equal(
    await page
      .getByRole("button", { name: /^Open output folder for / })
      .first()
      .isEnabled(),
    true
  );
  await page.screenshot({ path: `${screenshots}/app-update-ready.png` });
  await page.evaluate(() => {
    window.testBridge.fail = "restart_after_update";
  });
  await page.getByRole("button", { name: "Restart app", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Test failure: restart_after_update" }).waitFor();
  await page.evaluate(() => {
    window.testBridge.fail = "";
  });
  await page.getByRole("button", { name: "Restart app", exact: true }).click();
  const automaticUrl = new URL(process.env.DESKTOP_URL || "http://127.0.0.1:1420/");
  automaticUrl.searchParams.set("updates", "available");
  await page.goto(automaticUrl.href);
  await page.getByText("Visuales 1.4.0 is available.").waitFor();
  assert.equal(
    await page.evaluate(() => window.testBridge.calls.filter((call) => call.command === "download_app_update").length),
    0,
    "automatic check never installs or downloads without consent"
  );
  automaticUrl.searchParams.set("updates", "offline");
  await page.goto(automaticUrl.href);
  await page.waitForFunction(() => window.testBridge.calls.some((call) => call.command === "check_app_update"));
  await page.getByLabel("App updates", { exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Test failure: check_app_update" }).waitFor();
  assert.equal(await page.getByText("You're up to date.").count(), 0, "offline is not reported as up to date");
  automaticUrl.searchParams.set("updates", "unsupported");
  await page.goto(automaticUrl.href);
  await page.getByLabel("App updates", { exact: true }).click();
  await page.getByText("Use the AppImage for in-app updates.").waitFor();
  assert.equal(await page.getByRole("button", { name: "Check for updates", exact: true }).isDisabled(), true);
  automaticUrl.searchParams.set("updates", "settings-error");
  await page.goto(automaticUrl.href);
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Test failure: get_desktop_settings" }).waitFor();
  await page.evaluate(() => {
    window.testBridge.fail = "";
  });
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page.getByLabel("Concurrent files", { exact: true }).waitFor();
  assert.deepEqual(errors, [], "no browser exceptions");
  console.log(`Desktop UI smoke checks passed. Screenshots: ${screenshots}`);
} catch (error) {
  await page.screenshot({ path: `${screenshots}/failure.png` });
  throw error;
} finally {
  await browser.close();
}
