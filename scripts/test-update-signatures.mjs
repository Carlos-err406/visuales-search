import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "visuales-signature-test-"));
const cli = resolve("node_modules/@tauri-apps/cli/tauri.js");
const run = (...args) => execFileSync(process.execPath, [cli, ...args], { stdio: "pipe" });
const verify = (key, artifact) =>
  spawnSync(
    "cargo",
    ["run", "--locked", "--example", "verify-update", "--", `${key}.pub`, artifact, `${artifact}.sig`],
    { encoding: "utf8" }
  );
try {
  const key = join(directory, "test.key");
  const other = join(directory, "other.key");
  run("signer", "generate", "--ci", "--password", "", "--write-keys", key);
  run("signer", "generate", "--ci", "--password", "", "--write-keys", other);
  const artifact = join(directory, "artifact.bin");
  await writeFile(artifact, "test update, never installed");
  run("signer", "sign", "--private-key-path", key, "--password", "", artifact);
  const valid = verify(key, artifact);
  assert.equal(valid.status, 0, valid.stderr);
  assert.notEqual(verify(other, artifact).status, 0, "a different trusted key must reject this artifact");
  await writeFile(artifact, "tampered update");
  assert.notEqual(verify(key, artifact).status, 0, "tampered bytes must be rejected");
  console.log(
    "Signature checks passed: valid key accepted; wrong key and tampered bytes rejected. No update installed."
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
