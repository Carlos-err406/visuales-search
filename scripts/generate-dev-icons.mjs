import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { load } from "cheerio";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Code } from "lucide-react";
import { chromium } from "playwright";

const desktop = resolve("apps/desktop");
const destination = resolve(desktop, "src-tauri/icons/dev");
const generated = resolve(".cache/dev-icon-generation");
const source = load(await readFile(resolve(desktop, "app-icon.svg"), "utf8"), { xml: true });
const mark = source("#visuales-mark").clone().removeAttr("id");
if (mark.length !== 1) throw new Error("Expected one Visuales master mark");
const code = load(
  renderToStaticMarkup(
    createElement(Code, {
      color: "#fff",
      strokeWidth: 2.5,
      x: 116,
      y: 320,
      width: 792,
      height: 384,
      preserveAspectRatio: "none",
    })
  ),
  { xml: true }
);
// Slim the brackets and bring them around the V instead of adding a separate badge.
code("path").eq(0).attr("transform", "translate(13.2 0) scale(.4 1)");
code("path").eq(1).attr("transform", "translate(1.2 0) scale(.4 1)");
const devMark = `<g transform="translate(133.12 113.88) scale(.74)">${mark}</g>\n${code("svg")}`;

const app = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
${source("rect").first()}
<g id="visuales-mark">
${devMark}
</g>
</svg>\n`;
const tray = `<svg xmlns="http://www.w3.org/2000/svg" width="54" height="32" viewBox="152 298 720 428">
${devMark}
</svg>\n`;

await mkdir(destination, { recursive: true });
await writeFile(resolve(desktop, "app-icon-dev.svg"), app);
await writeFile(resolve(desktop, "tray-icon-dev.svg"), tray);
execFileSync(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["--prefix", desktop, "run", "tauri", "--", "icon", "app-icon-dev.svg", "--output", generated],
  { stdio: "inherit", shell: process.platform === "win32" }
);
for (const file of ["icon.png", "icon.ico", "icon.icns"]) {
  await copyFile(resolve(generated, file), resolve(destination, file));
}

// Reuse the integrated mark, cropped to the menu bar's template bounds.
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL });
try {
  const page = await browser.newPage({ viewport: { width: 54, height: 32 }, deviceScaleFactor: 1 });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block}</style>${tray}`);
  await page.screenshot({ path: resolve(destination, "tray.png"), omitBackground: true });
} finally {
  await browser.close();
}
console.log("Generated development icons. Production assets are unchanged.");
