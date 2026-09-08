import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isReleaseVersion, releaseVersion } from "./release-version.mjs";

export const platforms = ["darwin-aarch64", "darwin-x86_64", "linux-x86_64", "windows-x86_64"];
const repository = "Carlos-err406/visuales-search";
const extensions = {
  "darwin-aarch64": ["app.tar.gz", "dmg"],
  "darwin-x86_64": ["app.tar.gz", "dmg"],
  "linux-x86_64": ["AppImage", "deb"],
  "windows-x86_64": ["exe"],
};

export function buildManifest(fragments, version, date = new Date().toISOString()) {
  if (!isReleaseVersion(version)) throw new Error("Invalid release version");
  if (fragments.length !== platforms.length) throw new Error("A release must include all four desktop platforms");
  const result = { version, notes: `Visuales ${version}`, pub_date: date, platforms: {} };
  for (const fragment of fragments) {
    const { platform, asset, signature } = fragment;
    if (!platforms.includes(platform) || result.platforms[platform]) throw new Error("Unknown or duplicate platform");
    if (fragment.version !== version) throw new Error("Mixed release versions");
    const expected = `Visuales_${version}_${platform}.${extensions[platform][0]}`;
    if (asset !== expected) throw new Error(`Unexpected updater asset: ${asset}`);
    if (typeof signature !== "string" || !signature.trim() || !/^[A-Za-z0-9+/=]+$/.test(signature))
      throw new Error(`Missing or invalid signature for ${platform}`);
    result.platforms[platform] = {
      signature,
      url: `https://github.com/${repository}/releases/download/v${version}/${encodeURIComponent(asset)}`,
    };
  }
  return result;
}

export async function stageArtifacts(
  platform,
  version,
  bundle = "target/release/bundle",
  output = ".cache/desktop-release"
) {
  if (!platforms.includes(platform) || !isReleaseVersion(version)) throw new Error("Invalid platform or version");
  const destination = resolve(output, platform);
  await mkdir(destination, { recursive: true });
  const files = [];
  for (const directory of await readdir(bundle, { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    for (const file of await readdir(resolve(bundle, directory.name), { withFileTypes: true })) {
      if (file.isFile()) files.push(resolve(bundle, directory.name, file.name));
    }
  }
  let fragment;
  for (const [index, extension] of extensions[platform].entries()) {
    const matches = files.filter((file) => file.endsWith(`.${extension}`));
    if (matches.length !== 1) throw new Error(`Expected exactly one .${extension} artifact for ${platform}`);
    const source = matches[0];
    if ((await stat(source)).size === 0) throw new Error(`Empty artifact: ${source}`);
    const asset = `Visuales_${version}_${platform}.${extension}`;
    await copyFile(source, resolve(destination, asset));
    if (index === 0) {
      const signature = (await readFile(`${source}.sig`, "utf8")).trim();
      if (!signature) throw new Error(`Missing signature: ${source}`);
      await copyFile(`${source}.sig`, resolve(destination, `${asset}.sig`));
      fragment = { platform, version, asset, signature };
    }
  }
  await writeFile(resolve(destination, "platform.json"), `${JSON.stringify(fragment, null, 2)}\n`);
  return destination;
}

export async function assembleArtifacts(directory, version) {
  const fragments = [];
  const files = [];
  for (const platform of platforms) {
    const folder = resolve(directory, platform);
    fragments.push(JSON.parse(await readFile(resolve(folder, "platform.json"), "utf8")));
    for (const file of await readdir(folder)) {
      if (file !== "platform.json") files.push(resolve(folder, file));
    }
    for (const extension of extensions[platform]) {
      if (!(await stat(resolve(folder, `Visuales_${version}_${platform}.${extension}`))).size)
        throw new Error(`Empty artifact for ${platform}`);
    }
  }
  const manifest = buildManifest(fragments, version);
  for (const fragment of fragments) {
    const signature = (await readFile(resolve(directory, fragment.platform, `${fragment.asset}.sig`), "utf8")).trim();
    if (signature !== fragment.signature) throw new Error(`Signature mismatch for ${fragment.platform}`);
  }
  const manifestPath = resolve(directory, "latest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const checksums = [];
  for (const file of files) {
    checksums.push(
      `${createHash("sha256")
        .update(await readFile(file))
        .digest("hex")}  ${basename(file)}`
    );
  }
  const sumsPath = resolve(directory, "SHA256SUMS.txt");
  await writeFile(sumsPath, `${checksums.sort().join("\n")}\n`);
  return [...files, manifestPath, sumsPath];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, argument] = process.argv.slice(2);
  const version = await releaseVersion();
  if (command === "stage") console.log(await stageArtifacts(argument, version));
  else if (command === "verify") {
    if (!platforms.includes(argument)) throw new Error("Unknown platform");
    const folder = resolve(".cache/desktop-release", argument);
    const fragment = JSON.parse(await readFile(resolve(folder, "platform.json"), "utf8"));
    const config = JSON.parse(await readFile("apps/desktop/src-tauri/tauri.conf.json", "utf8"));
    const keyPath = resolve(".cache/updater-public-key.txt");
    await writeFile(keyPath, config.plugins.updater.pubkey);
    execFileSync(
      "cargo",
      [
        "run",
        "--locked",
        "--example",
        "verify-update",
        "--",
        keyPath,
        resolve(folder, fragment.asset),
        resolve(folder, `${fragment.asset}.sig`),
      ],
      { stdio: "inherit" }
    );
  } else if (command === "assemble") console.log(JSON.stringify(await assembleArtifacts(argument, version)));
  else throw new Error("Usage: desktop-artifacts.mjs stage|verify <platform> | assemble <directory>");
}
