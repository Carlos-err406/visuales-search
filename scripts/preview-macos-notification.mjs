import { execFileSync } from "node:child_process";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

if (process.platform !== "darwin") throw new Error("This bundled preview requires macOS");
execFileSync("cargo", ["build", "--locked", "--example", "notification-preview"], { stdio: "inherit" });
const directory = resolve(".cache/notification-action-preview");
const app = join(directory, "Visuales Notification Preview.app");
await mkdir(join(app, "Contents/MacOS"), { recursive: true });
await mkdir(join(app, "Contents/Resources"), { recursive: true });
await copyFile("target/debug/examples/notification-preview", join(app, "Contents/MacOS/notification-preview"));
await copyFile("apps/desktop/src-tauri/icons/dev/icon.icns", join(app, "Contents/Resources/icon.icns"));
await writeFile(
  join(app, "Contents/Info.plist"),
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>notification-preview</string>
<key>CFBundleIdentifier</key><string>cu.uclv.visuales.notification-preview</string>
<key>CFBundleName</key><string>Visuales Notification Preview</string>
<key>CFBundleDisplayName</key><string>Visuales Notification Preview</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleIconFile</key><string>icon.icns</string>
</dict></plist>`
);
execFileSync("codesign", ["--force", "--sign", "-", app], { stdio: "inherit" });
const log = join(directory, "preview.log");
execFileSync("/usr/bin/open", [
  "-n",
  "-g",
  "-a",
  app,
  "--stdout",
  log,
  "--stderr",
  log,
  "--args",
  "--notification-preview",
]);
console.log(`Notification preview launched. Log: ${log}`);
console.log("Allow notifications for Visuales Notification Preview if prompted, then choose Show in Finder.");
console.log("It opens your Downloads folder, starts no downloads, and exits after three minutes.");
