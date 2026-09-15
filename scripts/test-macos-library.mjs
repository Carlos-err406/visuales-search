import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

if (process.platform !== "darwin") throw new Error("Native library smoke testing requires macOS");
execFileSync("cargo", ["build", "--locked", "--example", "library-smoke"], { stdio: "inherit" });
const directory = await realpath(await mkdtemp(join(tmpdir(), "visuales-library-windows-")));
const app = join(directory, "Visuales Library Test.app");
const executable = join(app, "Contents/MacOS/library-smoke");
try {
  await mkdir(join(app, "Contents/MacOS"), { recursive: true });
  await copyFile(resolve("target/debug/examples/library-smoke"), executable);
  await writeFile(
    join(app, "Contents/Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>library-smoke</string><key>CFBundleIdentifier</key><string>cu.uclv.visuales.library-test</string><key>CFBundleName</key><string>Visuales Library Test</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`
  );
  execFileSync("codesign", ["--force", "--sign", "-", app], { stdio: "pipe" });
  execFileSync("/usr/bin/open", ["-n", "-a", app, "--args", directory]);
  const deadline = Date.now() + 30000;
  let passed = "";
  while (Date.now() < deadline) {
    assert.equal(await readFile(join(directory, "failed"), "utf8").catch(() => ""), "");
    passed = await readFile(join(directory, "passed"), "utf8").catch(() => "");
    if (passed) break;
    await delay(100);
  }
  assert.ok(passed, "Native library smoke timed out");
  console.log(passed);
} finally {
  const pid = Number(await readFile(join(directory, "started.pid"), "utf8").catch(() => ""));
  if (Number.isInteger(pid) && pid > 0) {
    try {
      const command = execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" }).trim();
      if (command === executable || command.startsWith(`${executable} `)) process.kill(pid, "SIGKILL");
    } catch {
      /* The fixture normally exits itself. */
    }
  }
  await rm(directory, { recursive: true, force: true });
}
