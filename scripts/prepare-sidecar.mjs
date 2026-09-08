import { execFileSync } from "node:child_process";
import { mkdir, copyFile, chmod, writeFile, access } from "node:fs/promises";
import path from "node:path";

const host = execFileSync("rustc", ["-vV"], { encoding: "utf8" }).match(/^host: (.+)$/m)?.[1];
const target = process.env.TAURI_ENV_TARGET_TRIPLE || host;
if (!target) throw new Error("Could not determine the Rust target triple");
if (target !== host && !process.env.VISUALES_NODE_BINARY) {
  throw new Error("Cross builds require VISUALES_NODE_BINARY pointing to a Node runtime for the target");
}
const runtime = process.env.VISUALES_NODE_BINARY || process.execPath;
const base = "apps/desktop/src-tauri";
await mkdir(`${base}/binaries`, { recursive: true });
await mkdir(`${base}/resources`, { recursive: true });
const binary = `${base}/binaries/visuales-node-${target}${target.includes("windows") ? ".exe" : ""}`;
await copyFile(runtime, binary);
await chmod(binary, 0o755);
await copyFile("apps/sidecar/dist/sidecar.cjs", `${base}/resources/sidecar.cjs`);
let nodeLicense = process.env.VISUALES_NODE_LICENSE;
if (!nodeLicense) {
  for (const relative of ["LICENSE", "LICENSE.txt", "../LICENSE", "../LICENSE.txt"]) {
    const candidate = path.resolve(path.dirname(runtime), relative);
    if (
      await access(candidate).then(
        () => true,
        () => false
      )
    ) {
      nodeLicense = candidate;
      break;
    }
  }
}
if (!nodeLicense) throw new Error("Set VISUALES_NODE_LICENSE to the bundled Node runtime's LICENSE file");
await copyFile(nodeLicense, `${base}/resources/NODE-LICENSE.txt`);
await writeFile(
  `${base}/resources/runtime.json`,
  JSON.stringify({ node: process.version, target, binary: path.basename(binary) })
);
console.log(`Prepared Node sidecar for ${target}`);
