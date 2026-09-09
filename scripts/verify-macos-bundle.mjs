import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";

if (process.platform !== "darwin") throw new Error("macOS bundle verification requires macOS");
const app = resolve(process.argv[2] || "target/release/bundle/macos/Visuales.app");
execFileSync("codesign", ["--verify", "--deep", "--strict", "--verbose=4", app], { stdio: "inherit" });

// Re-signing the bundled Node runtime must preserve V8's ability to use JIT memory.
execFileSync(
  join(app, "Contents/MacOS/visuales-node"),
  [
    "-e",
    'const vm = require("node:vm"); const result = vm.runInNewContext("let sum = 0; for (let i = 0; i < 1000000; i++) sum += i; sum"); if (result !== 499999500000) process.exit(1); console.log("Bundled Node runtime passed");',
  ],
  { stdio: "inherit", timeout: 30_000 }
);
console.log("macOS bundle integrity verified (not an Apple notarization check)");
