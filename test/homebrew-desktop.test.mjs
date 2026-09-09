import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { renderDesktopCask, validateCaskRelease } from "../scripts/homebrew-desktop.mjs";

const version = "2.0.0";
const names = ["aarch64", "x86_64"].map((arch) => `Visuales_${version}_darwin-${arch}.dmg`);
const checksums = names.map((name, index) => `${String(index + 1).repeat(64)}  ${name}`).join("\n");

test("desktop cask uses separate architecture checksums and preserves CLI state", () => {
  const cask = renderDesktopCask(version, checksums);
  assert.match(cask, /cask "visuales-desktop"/);
  assert.match(cask, /arch arm: "aarch64", intel: "x86_64"/);
  assert.match(cask, /sha256 arm: {3}"1{64}",\n +intel: "2{64}"/);
  assert.match(cask, /version "2.0.0"/);
  assert.match(cask, /releases\/download\/v#\{version\}\/Visuales_#\{version\}_darwin-#\{arch\}\.dmg/);
  assert.match(cask, /auto_updates true/);
  assert.match(cask, /depends_on macos: :ventura/);
  assert.match(cask, /app "Visuales.app"/);
  assert.match(cask, /not notarized by Apple/);
  assert.match(cask, /Privacy & Security, click Open Anyway for Visuales/);
  assert.doesNotMatch(cask, /zap|binary |\.visuales-cli-cache|Downloads|no_check|quarantine/);
});

test("desktop cask refuses incomplete, malformed, duplicate, or wrong-version checksums", () => {
  for (const sums of [
    "",
    checksums.split("\n")[0],
    `${checksums}\n${checksums}`,
    checksums.replace("2.0.0", "1.0.0"),
    checksums.replace("1", "z"),
  ])
    assert.throws(() => renderDesktopCask(version, sums));
  assert.throws(() => renderDesktopCask('2.0.0"; exit', checksums), /Invalid release version/);
});

test("Homebrew only promotes the latest complete public stable release", () => {
  const release = {
    tag_name: "v2.0.0",
    draft: false,
    prerelease: false,
    assets: ["SHA256SUMS.txt", ...names].map((name) => ({ name, size: 100 })),
  };
  assert.doesNotThrow(() => validateCaskRelease(release, release, "v2.0.0"));
  for (const changed of [
    { ...release, draft: true },
    { ...release, prerelease: true },
    { ...release, assets: [] },
    { ...release, tag_name: "v1.0.0" },
  ])
    assert.throws(() => validateCaskRelease(changed, release, "v2.0.0"));
  assert.throws(() => validateCaskRelease(release, { tag_name: "v2.1.0" }, "v2.0.0"));
  assert.throws(() => validateCaskRelease(release, release, "../../main"));
});

test("generated cask has valid Ruby syntax", (t) => {
  const result = spawnSync("ruby", ["-c"], { input: renderDesktopCask(version, checksums), encoding: "utf8" });
  if (result.error?.code === "ENOENT") return t.skip("Ruby is not installed on this platform");
  assert.equal(result.status, 0, result.stderr);
});
