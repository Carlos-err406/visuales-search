import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "smol-toml";
import { format } from "prettier";

const root = fileURLToPath(new URL("../", import.meta.url));
const json = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));
export const isReleaseVersion = (value) =>
  typeof value === "string" && value === value.trim() && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value);

export async function releaseVersion({ write = false, stage = false, tag } = {}) {
  const pkg = await json("package.json");
  const version = pkg.version;
  if (!isReleaseVersion(version)) throw new Error("Releases require a stable major.minor.patch version");
  if (tag && tag !== `v${version}`) throw new Error(`Tag ${tag} does not match package version ${version}`);
  const files = [
    ...pkg.workspaces.map((workspace) => `${workspace}/package.json`),
    "apps/desktop/src-tauri/tauri.conf.json",
  ];
  const lock = await json("package-lock.json");
  for (const path of files) {
    const document = await json(path);
    if (write) {
      document.version = version;
      await writeFile(resolve(root, path), await format(JSON.stringify(document), { parser: "json", printWidth: 120 }));
      const workspace = path.replace(/\/package.json$/, "");
      if (lock.packages[workspace]) lock.packages[workspace].version = version;
    } else if (document.version !== version) {
      throw new Error(`${path} must use ${version}; run npm run version:sync`);
    }
  }
  const cargoPath = "apps/desktop/src-tauri/Cargo.toml";
  const cargo = parse(await readFile(resolve(root, cargoPath), "utf8"));
  if (write) {
    cargo.package.version = version;
    await writeFile(resolve(root, cargoPath), stringify(cargo));
    lock.version = version;
    lock.packages[""].version = version;
    await writeFile(resolve(root, "package-lock.json"), `${JSON.stringify(lock, null, 2)}\n`);
    execFileSync("cargo", ["update", "--workspace"], { cwd: root, stdio: "inherit" });
    if (stage)
      execFileSync("git", ["add", ...files, cargoPath, "Cargo.lock", "package-lock.json"], {
        cwd: root,
        stdio: "inherit",
      });
  } else {
    if (cargo.package.version !== version) throw new Error("Rust package version is out of sync");
    for (const path of ["", ...pkg.workspaces]) {
      if (lock.packages[path].version !== version)
        throw new Error(`package-lock.json version is out of sync for ${path}`);
    }
    const cargoLock = parse(await readFile(resolve(root, "Cargo.lock"), "utf8"));
    if (cargoLock.package.find((item) => item.name === "visuales-desktop").version !== version)
      throw new Error("Cargo.lock version is out of sync");
  }
  return version;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const tagIndex = process.argv.indexOf("--tag");
  console.log(
    await releaseVersion({
      write: process.argv.includes("--write"),
      stage: process.argv.includes("--stage"),
      tag: tagIndex < 0 ? undefined : process.argv[tagIndex + 1],
    })
  );
}
