import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildManifest, platforms, stageArtifacts, assembleArtifacts } from "../scripts/desktop-artifacts.mjs";
import { isReleaseVersion, releaseVersion } from "../scripts/release-version.mjs";

const version = "1.4.0";
const extensions = ["app.tar.gz", "app.tar.gz", "AppImage", "exe"];
const fragments = platforms.map((platform, index) => ({
  platform,
  version,
  asset: `Visuales_${version}_${platform}.${extensions[index]}`,
  signature: Buffer.from("test signature").toString("base64"),
}));

test("updater manifest covers every platform and uses immutable versioned asset URLs", () => {
  const manifest = buildManifest(fragments, version, "2026-09-08T00:00:00Z");
  assert.deepEqual(Object.keys(manifest.platforms), platforms);
  assert.equal(manifest.version, version);
  for (const platform of platforms)
    assert.match(manifest.platforms[platform].url, /releases\/download\/v1\.4\.0\/Visuales_/);
});

test("release assembly rejects missing, duplicate, unsigned, mixed, and unexpected artifacts", () => {
  assert.throws(() => buildManifest(fragments.slice(1), version), /all four/);
  for (const replacement of [
    fragments[1],
    { ...fragments[0], signature: "" },
    { ...fragments[0], version: "1.3.0" },
    { ...fragments[0], asset: "../../malicious.exe" },
  ]) {
    assert.throws(() => buildManifest([replacement, ...fragments.slice(1)], version));
  }
});

test("stage and assemble actual files, fail closed on missing signatures", async () => {
  const root = await mkdtemp(join(tmpdir(), "visuales-release-"));
  try {
    const output = join(root, "output");
    for (const [index, platform] of platforms.entries()) {
      const bundle = join(root, platform);
      const dir = join(bundle, "bundle-kind");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `input.${extensions[index]}`), "artifact");
      await assert.rejects(stageArtifacts(platform, version, bundle, output));
      await writeFile(join(dir, `input.${extensions[index]}.sig`), fragments[index].signature);
      if (platform.startsWith("darwin")) await writeFile(join(dir, "input.dmg"), "installer");
      if (platform.startsWith("linux")) await writeFile(join(dir, "input.deb"), "installer");
      await stageArtifacts(platform, version, bundle, output);
    }
    const files = await assembleArtifacts(output, version);
    assert.equal(files.length, 13);
    assert.equal(JSON.parse(await readFile(join(output, "latest.json"), "utf8")).version, version);
    assert.match(await readFile(join(output, "SHA256SUMS.txt"), "utf8"), /^[a-f0-9]{64} {2}Visuales_/);
    await writeFile(join(output, platforms[0], `${fragments[0].asset}.sig`), "changed");
    await assert.rejects(assembleArtifacts(output, version), /Signature mismatch/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("all release versions agree and tags cannot override source versions", async () => {
  const version = await releaseVersion();
  assert.ok(isReleaseVersion(version));
  assert.equal(await releaseVersion({ tag: `v${version}` }), version);
  await assert.rejects(releaseVersion({ tag: "v999.0.0" }), /does not match/);
  for (const invalid of ["1.0", "01.0.0", "1.0.0-beta.1", "v1.0.0", "1.0.0\n", "1.0.0;echo pwned"])
    assert.equal(isReleaseVersion(invalid), false);
});
