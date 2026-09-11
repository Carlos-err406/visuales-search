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
import { normalizeDesktopExclusions } from "../packages/core/dist/desktop-settings-types.js";
import { createGlobMatcher } from "../packages/core/dist/download/utils.js";

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
  const defaults = { output: nativeOutput, concurrent: 5, connections: 3, maxRetries: 3, exclude: [] };
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
  const legacy = { output: nativeOutput, concurrent: 7, connections: 2, maxRetries: 0 };
  const legacyDocument = JSON.stringify({ version: 1, settings: legacy });
  await fs.writeFile(settingsFile, legacyDocument);
  assert.deepEqual((await loadDesktopSettings(nativeOutput)).settings, { ...legacy, exclude: [] });
  assert.equal(
    await fs.readFile(settingsFile, "utf8"),
    legacyDocument,
    "loading old preferences does not rewrite them"
  );
  const custom = {
    output: "~/Custom Downloads",
    concurrent: 2,
    connections: 4,
    maxRetries: 0,
    exclude: ["*.{jpg,nfo},*.srt", "Extras/**", "*.srt", ""],
  };
  const expected = {
    ...custom,
    output: path.join(home, "Custom Downloads"),
    exclude: ["*.{jpg,nfo}", "*.srt", "Extras/**", "*.srt"],
  };
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
    ...[null, "*.jpg", [5], ["x\0"], ["x\ny"], ["x".repeat(513)], Array(101).fill("*.jpg")].map((exclude) => ({
      ...custom,
      exclude,
    })),
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
  await saveDesktopSettings(defaults, nativeOutput);
  assert.deepEqual(
    (await loadDesktopSettings(nativeOutput)).settings.exclude,
    [],
    "restoring defaults removes exclusions"
  );
  assert.equal(cliDefaults.exclude, undefined, "desktop exclusions do not change CLI defaults");

  for (const invalid of ['{"version":', JSON.stringify({ version: 2, settings: expected })]) {
    await fs.writeFile(settingsFile, invalid);
    await assert.rejects(loadDesktopSettings(), /invalid/);
    await assert.rejects(saveDesktopSettings(expected), /invalid/);
    assert.equal(await fs.readFile(settingsFile, "utf8"), invalid, "invalid persisted data is not overwritten");
  }
});

test("desktop exclusions preserve ordered CLI ignore semantics", () => {
  const raw = ["*.{jpg,nfo},*.srt", "!poster.jpg", "Extras/**", "*sample?.mkv", "", "*.srt"];
  const saved = normalizeDesktopExclusions(raw);
  assert.deepEqual(saved, ["*.{jpg,nfo}", "*.srt", "!poster.jpg", "Extras/**", "*sample?.mkv", "*.srt"]);
  const cli = createGlobMatcher(raw);
  const desktop = createGlobMatcher(saved);
  for (const file of [
    "cover.JPG",
    "film.nfo",
    "Subs/film.srt",
    "Extras/deep/info.txt",
    "Extras\\info.txt",
    "sample1.mkv",
    "movie.mkv",
    "readme.txt",
  ]) {
    assert.equal(desktop(file), cli(file), file);
  }
  assert.deepEqual(normalizeDesktopExclusions(undefined), []);
  assert.deepEqual(normalizeDesktopExclusions(["  ", ","]), []);
  assert.throws(() => normalizeDesktopExclusions([Array(101).fill("x").join(",")]), /at most 100/);
  assert.throws(
    () => normalizeDesktopExclusions([Array.from({ length: 101 }, (_, index) => `x${index}`).join(",")]),
    /at most 100/
  );
  const ordered = ["*.jpg", "!poster.jpg", "*.jpg"];
  assert.deepEqual(normalizeDesktopExclusions(ordered), ordered, "duplicate rules must not be deduplicated");
  assert.equal(createGlobMatcher(normalizeDesktopExclusions(ordered))("poster.jpg"), true);
  assert.deepEqual(normalizeDesktopExclusions(["# comment, not a rule", "\\!literal", "space\\ "]), [
    "# comment, not a rule",
    "\\!literal",
    "space\\ ",
  ]);
  assert.throws(() => normalizeDesktopExclusions(["{1..2000}.jpg"]), /at most 1000/);
});
