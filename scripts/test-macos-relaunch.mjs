import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

if (process.platform !== "darwin") throw new Error("Native relaunch smoke testing requires macOS");
execFileSync("cargo", ["build", "--locked", "--example", "relaunch-smoke"], { stdio: "inherit" });
for (let round = 1; round <= 2; round++) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "visuales-relaunch-")));
  const app = join(directory, "Visuales Relaunch Test.app");
  const executable = join(app, "Contents/MacOS/relaunch-smoke");
  let child;
  let closed;
  let output = "";
  try {
    await mkdir(join(app, "Contents/MacOS"), { recursive: true });
    await copyFile(resolve("target/debug/examples/relaunch-smoke"), executable);
    await writeFile(
      join(app, "Contents/Info.plist"),
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>relaunch-smoke</string>
<key>CFBundleIdentifier</key><string>cu.uclv.visuales.relaunch-test</string>
<key>CFBundleName</key><string>Visuales Relaunch Test</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>`
    );
    execFileSync("codesign", ["--force", "--sign", "-", app], { stdio: "pipe" });
    child = spawn("/usr/bin/open", ["-n", "-a", app, "--args", directory], { stdio: ["ignore", "pipe", "pipe"] });
    closed = new Promise((resolve) => child.on("close", resolve));
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    const deadline = Date.now() + 30000;
    let passed = false;
    while (Date.now() < deadline) {
      const failure = await readFile(join(directory, "failed"), "utf8").catch(() => "");
      assert.equal(failure, "", `${failure}\n${output}`);
      if (await readFile(join(directory, "passed"), "utf8").catch(() => "")) {
        passed = true;
        break;
      }
      await delay(100);
    }
    assert(passed, `Native relaunch timed out\n${output}`);
    assert.equal(await closed, 0, output);
    console.log(
      `Native relaunch round ${round}: startup, hidden/minimized reopen, exit lifecycle, and restarted window passed`
    );
  } finally {
    // Only verified processes from this temporary bundle, never installed apps.
    for (const name of ["started.pid", "restarted.pid"]) {
      const pid = Number(await readFile(join(directory, name), "utf8").catch(() => ""));
      if (!Number.isInteger(pid) || pid <= 0) continue;
      try {
        const command = execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" }).trim();
        if (command === executable || command.startsWith(`${executable} `)) process.kill(pid, "SIGKILL");
      } catch {
        /* The test process normally exits itself. */
      }
    }
    if (closed) await closed;
    await rm(directory, { recursive: true, force: true });
  }
}
