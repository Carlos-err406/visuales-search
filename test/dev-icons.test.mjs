import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { load } from "cheerio";

test("development commands select separate native icons without modifying release configuration", async () => {
  const json = async (path) => JSON.parse(await readFile(path, "utf8"));
  const desktop = await json("apps/desktop/package.json");
  const root = await json("package.json");
  assert.equal(root.scripts["desktop:dev"], "npm --prefix apps/desktop run dev:desktop");
  assert.match(desktop.scripts["dev:desktop"], /--config src-tauri\/tauri\.dev\.conf\.json/);
  const production = await json("apps/desktop/src-tauri/tauri.conf.json");
  const dev = await json("apps/desktop/src-tauri/tauri.dev.conf.json");
  assert.deepEqual(production.bundle.icon, ["icons/icon.png", "icons/icon.ico", "icons/icon.icns"]);
  assert.deepEqual(dev.bundle.icon, ["icons/dev/icon.png", "icons/dev/icon.ico", "icons/dev/icon.icns"]);
  assert.deepEqual(Object.keys(dev).sort(), ["$schema", "bundle"]);
  for (const config of [production, dev]) {
    for (const icon of config.bundle.icon) {
      assert.ok((await readFile(`apps/desktop/src-tauri/${icon}`)).length > 100);
    }
  }
});

test("dev logo integrates Lucide brackets around the master V without a separate badge", async () => {
  const svg = async (path) => load(await readFile(path, "utf8"), { xml: true });
  const production = await svg("apps/desktop/app-icon.svg");
  const dev = await svg("apps/desktop/app-icon-dev.svg");
  const tray = await svg("apps/desktop/tray-icon-dev.svg");
  const mark = production("#visuales-mark").attr("d");
  assert.ok(mark);
  assert.equal(production(".lucide-code").length, 0);
  assert.equal(dev("#visuales-mark").length, 1);
  assert.equal(dev("rect").length, 1, "only the original teal tile, no badge background");
  assert.equal(tray("svg").first().attr("width"), "54");
  assert.equal(tray("svg").first().attr("height"), "32");
  for (const variant of [dev, tray]) {
    assert.equal(variant("path").first().attr("d"), mark);
    assert.equal(variant(".lucide-code path").length, 2);
  }
});
