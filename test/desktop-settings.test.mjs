import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { setupDownloadCommand } from "../dist/commands/download/index.js";
import { downloadDefaults } from "../packages/core/dist/download/defaults.js";
import {
  loadDesktopSettings,
  saveDesktopSettings,
  validateDesktopSettings,
} from "../packages/core/dist/desktop-settings.js";
import { clearAllCaches } from "../packages/core/dist/lib/cache.js";

let home;
let originalHome, originalProfile;
before(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "visuales-settings-"));
  originalHome = process.env.HOME;
  originalProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
});
after(async () => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalProfile;
  await fs.rm(home, { recursive: true, force: true });
});

test("desktop settings persist atomically, validate strictly, and survive cache clearing", async () => {
  const nativeOutput = path.join(home, "Native Downloads", "Visuales");
  const defaults = { output: nativeOutput, concurrent: 5, connections: 3, maxRetries: 3 };
  const program = new Command();
  setupDownloadCommand(program);
  const cliDefaults = program.commands.find((command) => command.name() === "download").opts();
  assert.deepEqual(downloadDefaults, {
    concurrent: 5,
    connections: 3,
    maxRetries: 3,
    resume: true,
    timeout: Infinity,
    compact: false,
  });
  for (const key of ["concurrent", "connections", "maxRetries"]) {
    assert.equal(Number(cliDefaults[key]), defaults[key], `${key} matches the CLI default`);
  }
  assert.equal(cliDefaults.resume, downloadDefaults.resume);
  assert.equal(Number(cliDefaults.timeout), downloadDefaults.timeout);
  assert.deepEqual(await loadDesktopSettings(nativeOutput), { settings: defaults, defaults });
  const settingsFile = path.join(home, ".visuales-cli-cache", "desktop-settings.json");
  await assert.rejects(fs.access(settingsFile));
  const singleConnection = { ...defaults, connections: 1 };
  await saveDesktopSettings(singleConnection, nativeOutput);
  assert.deepEqual(
    await loadDesktopSettings(nativeOutput),
    {
      settings: singleConnection,
      defaults,
    },
    "saved overrides survive the shared baseline change"
  );
  assert.equal(cliDefaults.connections, "3", "desktop preferences do not change CLI defaults");
  const custom = { output: "~/Custom Downloads", concurrent: 2, connections: 4, maxRetries: 0 };
  const expected = { ...custom, output: path.join(home, "Custom Downloads") };
  assert.deepEqual(await saveDesktopSettings(custom, nativeOutput), { settings: expected, defaults });
  assert.deepEqual((await loadDesktopSettings(nativeOutput)).settings, expected);

  for (const value of [
    null,
    [],
    {},
    { ...custom, output: "relative" },
    { ...custom, output: "\0" },
    { ...custom, concurrent: 0 },
    { ...custom, concurrent: 33 },
    { ...custom, concurrent: 1.5 },
    { ...custom, concurrent: "2" },
    { ...custom, maxRetries: -1 },
    { ...custom, maxRetries: Infinity },
    { ...custom, maxRetries: 21 },
    { ...custom, connections: 0 },
    { ...custom, connections: 9 },
    { ...custom, connections: 1.5 },
    { ...custom, unknown: true },
  ]) {
    assert.throws(() => validateDesktopSettings(value));
    await assert.rejects(saveDesktopSettings(value));
  }
  assert.deepEqual(
    (await loadDesktopSettings(nativeOutput)).settings,
    expected,
    "invalid writes preserve saved settings"
  );
  await Promise.all(
    Array.from({ length: 8 }, (_, index) => saveDesktopSettings({ ...expected, concurrent: index + 1 }))
  );
  const concurrent = await loadDesktopSettings();
  assert.ok(concurrent.settings.concurrent >= 1 && concurrent.settings.concurrent <= 8);
  assert.deepEqual(
    (await fs.readdir(path.dirname(settingsFile))).filter((name) => name.endsWith(".tmp") || name.endsWith(".lock")),
    []
  );
  await clearAllCaches();
  assert.deepEqual((await loadDesktopSettings()).settings, concurrent.settings);
  if (process.platform !== "win32") assert.equal((await fs.stat(settingsFile)).mode & 0o777, 0o600);

  for (const invalid of ['{"version":', JSON.stringify({ version: 2, settings: expected })]) {
    await fs.writeFile(settingsFile, invalid);
    await assert.rejects(loadDesktopSettings(), /invalid/);
    await assert.rejects(saveDesktopSettings(expected), /invalid/);
    assert.equal(await fs.readFile(settingsFile, "utf8"), invalid, "invalid persisted data is not overwritten");
  }
});
