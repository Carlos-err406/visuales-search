/* global window, document */
import assert from "node:assert/strict";
import { settingsPage } from "./helpers/settings-navigation.mjs";

export async function testSettingsLayout({ page, screenshots }) {
  const base = process.env.DESKTOP_URL || "http://127.0.0.1:1420/";
  await page.setViewportSize({ width: 1240, height: 820 });
  await page.goto(base);
  await page.locator("#tab-settings").click();
  await page.getByLabel("Concurrent files", { exact: true }).waitFor();
  const originalSettings = await page.evaluate(() => window.testBridge.settings);
  const rules = Array.from({ length: 14 }, (_, i) => `folder-${i}/`);
  await page.evaluate((rules) => {
    window.localStorage.setItem("test-settings", JSON.stringify({ ...window.testBridge.settings, exclude: rules }));
  }, rules);
  await page.reload();
  await page.locator("#tab-settings").click();
  const nav = page.getByRole("tablist", { name: "Workspace" });
  const footer = page.locator(".settings-footer");
  const concurrent = page.getByLabel("Concurrent files", { exact: true });
  const editor = page.getByRole("textbox", { name: "Ignore rules", exact: true });
  const completed = page.getByRole("checkbox", { name: "Completed downloads", exact: true });
  const save = page.getByRole("button", { name: "Save changes", exact: true });
  const discard = page.getByRole("button", { name: "Discard", exact: true });
  await editor.waitFor();
  await page.waitForFunction((value) => document.querySelector("#settings-exclude")?.value === value, rules.join("\n"));
  assert.equal(await editor.inputValue(), rules.join("\n"));
  assert.equal(await page.locator(".settings-sidebar").count(), 0);
  assert.equal(await concurrent.isVisible(), true);
  assert.equal(await completed.isVisible(), true);
  assert.equal(await page.getByRole("button", { name: "Check for updates", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Revalidate cache", exact: true }).isVisible(), true);
  assert.equal(await footer.count(), 0);

  async function editorFits() {
    await page.waitForFunction(() => {
      const editor = document.querySelector("#settings-exclude");
      return editor.clientHeight > 0 && editor.scrollHeight <= editor.clientHeight + 1;
    });
    assert.equal(await editor.evaluate((el) => window.getComputedStyle(el).overflowY), "hidden");
  }
  await editorFits();
  const savedHeight = (await editor.boundingBox()).height;
  assert.ok(savedHeight > 250, "saved rules determine the initial height, without a 200px cap");
  await editor.fill([...rules, ...rules].join("\n"));
  await editorFits();
  assert.ok((await editor.boundingBox()).height > savedHeight, "pasted lines grow the editor");
  await editor.fill("");
  await editorFits();
  assert.ok((await editor.boundingBox()).height < savedHeight, "deleting lines shrinks the editor");
  await discard.click();
  await editorFits();
  assert.equal((await editor.boundingBox()).height, savedHeight, "discard restores the saved rule height");

  const originalCompleted = await completed.isChecked();
  const originalConcurrent = await concurrent.inputValue();
  const changedConcurrent = originalConcurrent === "7" ? "6" : "7";
  await completed.click();
  await concurrent.fill(changedConcurrent);
  await nav.getByRole("tab", { name: "Settings", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await page.locator("#about-title").waitFor();
  assert.equal(await footer.isVisible(), false, "Settings actions stay on the Settings page");
  await page.getByText("Carlos Daniel Vilaseca Illnait", { exact: true }).waitFor();
  assert.equal(await page.getByText("Jesus Reikel Lopez Martin", { exact: true }).count(), 0);
  await page.getByText("Installed version: 1.3.10", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Revalidate cache", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Restore defaults", exact: true }).count(), 0);
  await page.locator(".about-license summary").click();
  assert.match(await page.locator(".about-license pre").textContent(), /Permission is hereby granted/);
  await page.locator(".about-license summary").click();
  assert.ok(await page.locator(".about-identity img").evaluate((img) => img.complete && img.naturalWidth > 0));
  const github = page.getByRole("link", { name: "View on GitHub", exact: true });
  assert.equal(await page.locator(".about-panel a").count(), 1);
  assert.equal(await github.getAttribute("href"), "https://github.com/Carlos-err406/visuales-search");
  assert.equal(await github.getAttribute("target"), "_blank");
  const url = page.url();
  await github.click();
  await page.waitForFunction(() => window.testBridge.calls.some((call) => call.command === "open_project_page"));
  assert.equal(page.url(), url, "native external links never navigate the app webview");
  await page.evaluate(() => {
    window.testBridge.fail = "open_project_page";
  });
  await github.click();
  await page.getByRole("alert").filter({ hasText: "Could not open GitHub" }).waitFor();
  await page.evaluate(() => {
    window.testBridge.fail = "";
  });
  await github.click();
  await page.getByRole("alert").filter({ hasText: "Could not open GitHub" }).waitFor({ state: "detached" });
  await page.locator("#tab-downloads").click();
  await page.locator("#tab-settings").click();
  assert.equal(await nav.getByRole("tab", { name: "Settings" }).getAttribute("aria-selected"), "true");
  await settingsPage(page, "Settings");
  assert.equal(await concurrent.inputValue(), changedConcurrent);
  assert.equal(await completed.isChecked(), !originalCompleted);
  await discard.click();
  assert.equal(await completed.isChecked(), originalCompleted);
  assert.equal(await concurrent.inputValue(), originalConcurrent);
  assert.equal(await footer.count(), 0);

  await concurrent.fill("0");
  await settingsPage(page, "About");
  assert.equal(await save.isVisible(), false);
  await settingsPage(page, "Settings");
  assert.equal(await save.isDisabled(), true, "hidden invalid preferences prevent saving");
  await concurrent.fill(changedConcurrent);
  await completed.click();
  await settingsPage(page, "About");
  await settingsPage(page, "Settings");
  await save.click();
  await page.getByText("Saved", { exact: true }).waitFor();
  const stored = await page.evaluate(() => window.testBridge.settings);
  assert.equal(stored.concurrent, Number(changedConcurrent));
  assert.equal(stored.notifyCompleted, !originalCompleted);
  assert.equal(await footer.count(), 0);

  for (const theme of ["Light", "Dark"]) {
    await settingsPage(page, "Settings");
    await page.getByRole("combobox", { name: "Theme", exact: true }).click();
    await page.getByRole("option", { name: theme, exact: true }).click();
    for (const width of [1624, 1240, 760, 390]) {
      const height = width === 760 ? 620 : 900;
      await page.setViewportSize({ width, height });
      for (const category of ["Settings", "About"]) {
        await settingsPage(page, category);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
        const panel = page.locator(category === "Settings" ? ".settings-preferences" : ".about-panel");
        assert.ok(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth), "content fits horizontally");
        if (category === "Settings") {
          await editorFits();
          const downloads = await page.locator(".settings-downloads").boundingBox();
          const general = await page.locator(".settings-general").boundingBox();
          if (width > 1000) {
            assert.equal(downloads.y, general.y, "both columns start at the same height");
            assert.ok(general.x >= downloads.x + downloads.width, "columns do not overlap");
            assert.ok(general.x + general.width > width - 64, "preferences use the available width");
            assert.equal(general.height, downloads.height, "divider extends through the taller column");
            const scroll = await page.locator(".settings-scroll").boundingBox();
            assert.ok(general.y + general.height >= scroll.y + scroll.height - 21, "divider fills the content area");
          } else assert.ok(general.y >= downloads.y + downloads.height, "narrow layouts stack the sections");
        }
        const aboutTab = await page.locator("#tab-about").boundingBox();
        const settingsTab = await page.locator("#tab-settings").boundingBox();
        assert.ok(aboutTab.x >= settingsTab.x + settingsTab.width, "main tabs do not overlap");
        assert.ok(aboutTab.x + aboutTab.width > width - 32, "About is right-aligned");
        await page.screenshot({ path: `${screenshots}/settings-compact-${theme}-${category}-${width}.png` });
      }
      await settingsPage(page, "Settings");
      await editor.fill(`${"long-folder-name/".repeat(28)}*.jpg\n*.nfo`);
      await editorFits();
      const actions = await footer.boundingBox();
      assert.ok(actions.y + actions.height <= height, "dirty footer stays reachable");
      await settingsPage(page, "About");
      await settingsPage(page, "Settings");
      await editorFits();
      await discard.click();
      await editorFits();
    }
    await page.setViewportSize({ width: 1240, height: 820 });
  }
  await page.evaluate(
    (settings) => window.localStorage.setItem("test-settings", JSON.stringify(settings)),
    originalSettings
  );
  await page.reload();
}
