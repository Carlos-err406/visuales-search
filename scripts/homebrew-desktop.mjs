import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isReleaseVersion } from "./release-version.mjs";

const repository = "Carlos-err406/visuales-search";

export function renderDesktopCask(version, checksums) {
  if (!isReleaseVersion(version)) throw new Error("Invalid release version");
  const sums = new Map();
  for (const line of checksums.trim().split(/\r?\n/)) {
    const match = /^([a-f0-9]{64}) {2}(\S+)$/.exec(line);
    if (!match || sums.has(match[2])) throw new Error("Invalid or duplicate release checksum");
    sums.set(match[2], match[1]);
  }
  const hashes = ["aarch64", "x86_64"].map((arch) => {
    const hash = sums.get(`Visuales_${version}_darwin-${arch}.dmg`);
    if (!hash) throw new Error(`Missing macOS ${arch} installer checksum`);
    return hash;
  });
  return `cask "visuales-desktop" do
  arch arm: "aarch64", intel: "x86_64"

  version "${version}"
  sha256 arm:   "${hashes[0]}",
         intel: "${hashes[1]}"

  url "https://github.com/${repository}/releases/download/v#{version}/Visuales_#{version}_darwin-#{arch}.dmg"
  name "Visuales"
  desc "Search and download content from the Visuales library"
  homepage "https://github.com/${repository}"

  auto_updates true
  depends_on macos: :ventura

  app "Visuales.app"

  caveats <<~EOS
    Visuales is ad-hoc signed and is not notarized by Apple.
    If macOS blocks the first launch and you trust this release, open
    System Settings > Privacy & Security, click Open Anyway for Visuales,
    then confirm Open. Try launching the app once before checking Settings.
    Managed Macs may not allow this exception.
  EOS
end
`;
}

export function validateCaskRelease(release, latest, tag) {
  if (!tag?.startsWith("v") || !isReleaseVersion(tag.slice(1))) throw new Error("A stable vX.Y.Z tag is required");
  if (release.tag_name !== tag || latest.tag_name !== tag || release.draft || release.prerelease)
    throw new Error("Only the latest public stable release can update Homebrew");
  for (const asset of [
    "SHA256SUMS.txt",
    ...["aarch64", "x86_64"].map((arch) => `Visuales_${tag.slice(1)}_darwin-${arch}.dmg`),
  ]) {
    if (!release.assets.some((item) => item.name === asset && item.size > 0))
      throw new Error(`Missing public release asset: ${asset}`);
  }
}

async function generateFromRelease(tag, output) {
  if (!tag?.startsWith("v") || !isReleaseVersion(tag.slice(1))) throw new Error("A stable vX.Y.Z tag is required");
  const gh = (...args) => execFileSync("gh", args, { encoding: "utf8" });
  const release = JSON.parse(gh("api", `repos/${repository}/releases/tags/${tag}`));
  const latest = JSON.parse(gh("api", `repos/${repository}/releases/latest`));
  validateCaskRelease(release, latest, tag);
  const directory = await mkdtemp(join(tmpdir(), "visuales-cask-"));
  try {
    gh("release", "download", tag, "--repo", repository, "--pattern", "SHA256SUMS.txt", "--dir", directory);
    const cask = renderDesktopCask(tag.slice(1), await readFile(join(directory, "SHA256SUMS.txt"), "utf8"));
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, cask);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await generateFromRelease(process.env.RELEASE_TAG, resolve(".cache/visuales-desktop.rb"));
}
