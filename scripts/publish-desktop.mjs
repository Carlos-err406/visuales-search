import { execFileSync } from "node:child_process";
import { assembleArtifacts } from "./desktop-artifacts.mjs";
import { isReleaseVersion, releaseVersion } from "./release-version.mjs";

const tag = process.env.RELEASE_TAG;
if (!tag) throw new Error("RELEASE_TAG is required");
const version = await releaseVersion({ tag });
const repo = "Carlos-err406/visuales-search";
const gh = (...args) => execFileSync("gh", args, { encoding: "utf8" });
const taggedCommit = execFileSync("git", ["rev-list", "-n", "1", tag], { encoding: "utf8" }).trim();
if (taggedCommit !== execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim())
  throw new Error("Release tag does not match the checked-out source");
const release = JSON.parse(gh("release", "view", tag, "-R", repo, "--json", "isDraft,isPrerelease"));
if (!release.isDraft || release.isPrerelease)
  throw new Error("Only a stable draft release can be published by this workflow");
const releases = JSON.parse(gh("api", `repos/${repo}/releases?per_page=100`));
const newer = (candidate) => {
  const left = candidate.split(".").map(Number);
  const right = version.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] > right[i];
  }
  return false;
};
if (
  releases.some(
    (item) =>
      !item.draft && !item.prerelease && isReleaseVersion(item.tag_name.slice(1)) && newer(item.tag_name.slice(1))
  )
)
  throw new Error("A newer release is already public; refusing to roll back the update feed");
const files = await assembleArtifacts(".cache/release-artifacts", version);
gh("release", "upload", tag, "-R", repo, "--clobber", ...files);
const uploaded = JSON.parse(gh("release", "view", tag, "-R", repo, "--json", "assets"));
for (const file of files) {
  const name = file.split(/[\\/]/).at(-1);
  if (!uploaded.assets.some((asset) => asset.name === name && asset.size > 0))
    throw new Error(`Missing release asset: ${name}`);
}
gh("release", "edit", tag, "-R", repo, "--draft=false", "--latest");
console.log(`Published ${tag} with all signed desktop artifacts and latest.json`);
