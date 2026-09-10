/* global window, document */
import assert from "node:assert/strict";

export async function testAppearance({ page, screenshots, checkLayout }) {
  const storageKey = "visuales.appearance";
  async function choose(label) {
    await page.getByRole("tab", { name: "Settings", exact: true }).click();
    await page.getByRole("combobox", { name: "Theme", exact: true }).click();
    await page.getByRole("option", { name: label, exact: true }).click();
    await page.waitForFunction((value) => document.documentElement.dataset.appearance === value, label.toLowerCase());
  }
  const isDark = () => page.locator("html").evaluate((el) => el.classList.contains("dark"));
  const luminance = (hex) => {
    const value = hex.trim().slice(1);
    const full = value.length === 3 ? [...value].map((part) => part + part).join("") : value;
    const rgb = [0, 2, 4].map((offset) => parseInt(full.slice(offset, offset + 2), 16) / 255);
    const linear = rgb.map((part) => (part <= 0.04045 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4));
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  };
  async function checkContrast() {
    const colors = await page.evaluate(() => {
      const style = window.getComputedStyle(document.documentElement);
      return Object.fromEntries(
        [
          "text",
          "surface",
          "background",
          "surface-alt",
          "muted",
          "placeholder",
          "primary",
          "primary-foreground",
          "primary-strong",
          "primary-soft",
          "danger",
          "danger-soft",
          "tooltip-text",
          "tooltip-detail",
          "tooltip-background",
        ].map((key) => [key, style.getPropertyValue(`--${key}`)])
      );
    });
    for (const [foreground, background] of [
      ["text", "background"],
      ["text", "surface"],
      ["muted", "surface"],
      ["muted", "surface-alt"],
      ["placeholder", "surface"],
      ["primary-foreground", "primary"],
      ["primary-foreground", "primary-strong"],
      ["primary-strong", "primary-soft"],
      ["danger", "danger-soft"],
      ["tooltip-text", "tooltip-background"],
      ["tooltip-detail", "tooltip-background"],
    ]) {
      const values = [luminance(colors[foreground]), luminance(colors[background])].sort((a, b) => b - a);
      const contrast = (values[0] + 0.05) / (values[1] + 0.05);
      assert.ok(contrast >= 4.5, `${foreground} on ${background}: ${contrast.toFixed(2)} contrast`);
    }
  }

  await page.setViewportSize({ width: 1240, height: 820 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  assert.equal(await isDark(), false);
  await checkContrast();
  const storedDownloads = await page.evaluate(() => window.localStorage.getItem("test-settings"));
  await choose("Dark");
  await page.waitForFunction(() => window.testBridge.nativeTheme === "dark");
  assert.equal(await isDark(), true);
  await checkContrast();
  assert.equal(await page.evaluate((key) => window.localStorage.getItem(key), storageKey), "dark");
  assert.equal(await page.getByRole("button", { name: "Save changes", exact: true }).isDisabled(), true);
  assert.equal(await page.evaluate(() => window.localStorage.getItem("test-settings")), storedDownloads);
  const url = new URL(page.url());
  url.searchParams.set("updates", "current");
  await page.goto(url.href);
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  await page.getByRole("combobox", { name: "Theme", exact: true }).waitFor();
  await page.getByLabel("Concurrent files", { exact: true }).waitFor();
  assert.equal(await isDark(), true, "explicit dark persists with a light OS");
  await page.emulateMedia({ colorScheme: "dark" });
  await choose("Light");
  assert.equal(await isDark(), false, "explicit light overrides a dark OS");
  await page.emulateMedia({ colorScheme: "light" });
  await page.emulateMedia({ colorScheme: "dark" });
  assert.equal(await isDark(), false, "OS changes do not override an explicit choice");
  await choose("System");
  await page.waitForFunction(() => window.testBridge.nativeTheme === null);
  assert.equal(await isDark(), true);
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForFunction(() => !document.documentElement.classList.contains("dark"));
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForFunction(() => document.documentElement.classList.contains("dark"));

  await page.evaluate(() => {
    window.testBridge.fail = "plugin:app|set_app_theme";
  });
  await choose("Light");
  await page.getByRole("alert").filter({ hasText: "Could not update the native window appearance" }).waitFor();
  await page.evaluate(() => {
    window.testBridge.fail = "";
  });
  await choose("Dark");
  await page.waitForFunction(() => window.testBridge.nativeTheme === "dark");
  assert.equal(await page.locator("#appearance-error").count(), 0);

  await page.evaluate(() => {
    window.testBridge.slowTheme = true;
  });
  await choose("Light");
  await choose("Dark");
  await choose("System");
  await page.waitForFunction(() => window.testBridge.nativeTheme === null);
  await page.waitForTimeout(450);
  assert.equal(
    await page.evaluate(() => window.testBridge.nativeTheme),
    null,
    "latest native choice wins after slow requests"
  );
  await page.evaluate(() => {
    window.testBridge.slowTheme = false;
  });

  await page.evaluate(() => {
    const original = window.Storage.prototype.setItem;
    window.Storage.prototype.setItem = function (key, value) {
      if (key === "visuales.appearance") throw new Error("Storage unavailable");
      return original.call(this, key, value);
    };
    window.restoreAppearanceStorage = () => {
      window.Storage.prototype.setItem = original;
    };
  });
  await choose("Light");
  assert.equal(await isDark(), false);
  await page.getByRole("alert").filter({ hasText: "Could not save appearance" }).waitFor();
  await page.evaluate(() => window.restoreAppearanceStorage());
  await choose("Dark");
  assert.equal(await page.locator("#appearance-error").count(), 0);

  // The HTML bootstrap must honor saved appearance even before React can execute.
  const boot = await page.context().newPage();
  try {
    await boot.emulateMedia({ colorScheme: "light" });
    await boot.route("**/src/main.tsx", (route) => route.abort());
    await boot.goto(page.url());
    assert.equal(await boot.locator("html").evaluate((el) => el.classList.contains("dark")), true);
    assert.equal(
      await boot.locator("body").evaluate((el) => window.getComputedStyle(el).backgroundColor),
      "rgb(21, 24, 25)"
    );
    await boot.evaluate((key) => window.localStorage.setItem(key, "invalid"), storageKey);
    await boot.emulateMedia({ colorScheme: "dark" });
    await boot.reload();
    assert.equal(await boot.locator("html").getAttribute("data-appearance"), "system");
    assert.equal(await boot.locator("html").evaluate((el) => el.classList.contains("dark")), true);
    await boot.addInitScript(() => {
      window.Storage.prototype.getItem = () => {
        throw new Error("Storage unavailable");
      };
    });
    await boot.reload();
    assert.equal(await boot.locator("html").getAttribute("data-appearance"), "system");
    assert.equal(await boot.locator("html").evaluate((el) => el.classList.contains("dark")), true);
  } finally {
    await boot.close();
  }
  await choose("Dark");
  await page.getByRole("combobox", { name: "Theme", exact: true }).click();
  const menu = page.locator('[data-slot="select-content"]');
  assert.equal(await menu.evaluate((el) => window.getComputedStyle(el).borderRadius), "1px");
  assert.equal(await menu.evaluate((el) => window.getComputedStyle(el).backgroundColor), "rgb(28, 32, 34)");
  await page.screenshot({ path: `${screenshots}/dark-theme-menu.png` });
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Search", exact: true }).click();
  await page.getByRole("searchbox").fill("Planet Earth");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".results-list")?.getAttribute("aria-busy") === "false");
  await page.locator(".result-row").first().waitFor();
  await page.locator('.result-row [role="checkbox"]').first().click();
  const checked = page.locator('.result-row.selected [data-slot="checkbox"]');
  assert.equal(await checked.evaluate((el) => window.getComputedStyle(el).color), "rgb(16, 38, 40)");
  for (const viewport of [
    { width: 1240, height: 820 },
    { width: 760, height: 620 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    for (const name of ["Search", "Downloads", "Settings"]) {
      await page
        .getByRole("tab", { name: name === "Downloads" ? /Downloads/ : name, exact: name !== "Downloads" })
        .click();
      await checkLayout(`dark-${name.toLowerCase()}-${viewport.width}`);
    }
  }
  await page.setViewportSize({ width: 1240, height: 820 });
  await page.getByRole("tab", { name: /Downloads/ }).click();
  await page.getByRole("button", { name: "Refresh downloads", exact: true }).hover();
  const tooltip = page.getByRole("tooltip");
  await tooltip.waitFor();
  assert.equal(await tooltip.evaluate((el) => window.getComputedStyle(el).backgroundColor), "rgb(48, 56, 60)");
  await page.screenshot({ path: `${screenshots}/dark-tooltip.png` });
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  await page.evaluate(() => {
    window.testBridge.updateVersion = "1.4.0";
  });
  await page.getByRole("button", { name: "Check for updates", exact: true }).click();
  await page.locator("#app-updates").waitFor();
  await page.screenshot({ path: `${screenshots}/dark-update.png` });
  await choose("Light");
  await checkLayout("light-appearance-settings");
  await checkContrast();
}
