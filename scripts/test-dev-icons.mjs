/* global document */
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build, createServer, preview } from "vite";
import { chromium } from "playwright";

const root = resolve("apps/desktop");
const output = resolve(".cache/dev-icon-preview");
const screenshots = resolve(".cache/desktop-ui");
const nodeEnv = process.env.NODE_ENV;
await mkdir(screenshots, { recursive: true });
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL });
try {
  for (const development of [true, false]) {
    process.env.NODE_ENV = development ? "development" : "production";
    let server;
    try {
      if (development) {
        server = await createServer({ root, server: { host: "127.0.0.1", port: 0, strictPort: true } });
        await server.listen();
      } else {
        await build({ root, build: { outDir: output, emptyOutDir: true } });
        server = await preview({ root, build: { outDir: output }, preview: { host: "127.0.0.1", port: 0 } });
      }
      const url = server.resolvedUrls.local[0];
      const page = await browser.newPage({ viewport: { width: 1240, height: 820 }, colorScheme: "dark" });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(url);
      const source = await page.locator(".brand-mark use").getAttribute("href");
      assert.equal(source.includes("app-icon-dev"), development);
      assert.equal((await page.locator('link[rel="icon"]').getAttribute("href")).includes("app-icon-dev"), development);
      await page.locator("#tab-about").click();
      const about = page.locator(".about-identity img");
      assert.equal((await about.getAttribute("src")).includes("app-icon-dev"), development);
      assert.equal(await about.getAttribute("alt"), development ? "Visuales development" : "");
      const coloredPixels = await about.evaluate(async (element) => {
        await element.decode();
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 32;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(element, 0, 0, 32, 32);
        return [...ctx.getImageData(0, 0, 32, 32).data].filter((value, index) => index % 4 === 3 && value > 128).length;
      });
      assert.ok(coloredPixels > 600, "logo must render nonblank");
      await page.screenshot({ path: resolve(screenshots, `icons-${development ? "dev" : "production"}-about.png`) });
      await page.goto(`${url}?tray`);
      const trayLogo = page.locator(".tray-popup img");
      assert.equal((await trayLogo.getAttribute("src")).includes("app-icon-dev"), development);
      await trayLogo.evaluate((image) => image.decode());
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`${development ? "Development" : "Production"} header, About, popup, and favicon passed`);
    } finally {
      if (server?.close) await server.close();
      else if (server) await new Promise((resolve) => server.httpServer.close(resolve));
    }
  }

  const data = async (path, mime) => `data:${mime};base64,${(await readFile(path)).toString("base64")}`;
  const production = await data("apps/desktop/src-tauri/icons/icon.png", "image/png");
  const development = await data("apps/desktop/src-tauri/icons/dev/icon.png", "image/png");
  const tray = await data("apps/desktop/src-tauri/icons/dev/tray.png", "image/png");
  const gallery = await browser.newPage({ viewport: { width: 760, height: 430 }, deviceScaleFactor: 2 });
  await gallery.setContent(`<style>
    body{margin:0;padding:28px;background:#171b1d;color:#edf1f2;font:14px system-ui}
    h1{font-size:18px;margin:0 0 22px}.row{display:flex;align-items:center;gap:28px;height:135px}
    .label{width:95px}.tray{display:flex;gap:26px;align-items:center}.light{background:#fff;padding:12px;color:#222}
    .light img{filter:invert(1)}
  </style><h1>Visuales icons</h1>
  ${[
    ["Production", production],
    ["Development", development],
  ]
    .map(
      ([label, src]) =>
        `<div class="row"><span class="label">${label}</span>${[16, 24, 32, 64, 128]
          .map((size) => `<img src="${src}" width="${size}" height="${size}">`)
          .join("")}</div>`
    )
    .join("")}
  <div class="tray"><span class="label">Dev menu bar</span><img src="${tray}" width="30.375" height="18">
  <span class="light"><img src="${tray}" width="30.375" height="18"></span><img src="${tray}" width="54" height="32"></div>`);
  await gallery.locator("img").evaluateAll((images) => Promise.all(images.map((image) => image.decode())));
  await gallery.screenshot({ path: resolve(screenshots, "dev-icons.png") });
  await gallery.close();
} finally {
  await browser.close();
  if (nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = nodeEnv;
}
