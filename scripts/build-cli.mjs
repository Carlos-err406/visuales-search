import { build } from "esbuild";
import { readdir, readFile, mkdir, copyFile, writeFile } from "node:fs/promises";
import path from "node:path";

const entries = (await readdir("apps/cli/src", { recursive: true }))
  .filter((file) => file.endsWith(".ts"))
  .map((file) => `apps/cli/src/${file}`);
const pkg = JSON.parse(await readFile("package.json", "utf8"));
await build({
  entryPoints: entries,
  outbase: "apps/cli/src",
  outdir: "dist",
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "node",
  target: "node20",
  external: Object.keys(pkg.dependencies),
  sourcemap: true,
});

// The npm CLI ships independently of the private workspace package, including its types.
for (const file of await readdir("packages/core/dist", { recursive: true })) {
  if (!file.endsWith(".d.ts")) continue;
  const destination = path.join("dist/core", file);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(path.join("packages/core/dist", file), destination);
}
for (const file of await readdir("dist", { recursive: true })) {
  if (!file.endsWith(".d.ts")) continue;
  const destination = path.join("dist", file);
  const declaration = await readFile(destination, "utf8");
  const rewritten = declaration.replace(/(["'])@visuales\/core(?:\/([^"']+))?\1/g, (_match, quote, subpath) => {
    const target = path.join("dist/core", `${subpath || "index"}.js`);
    let relative = path.relative(path.dirname(destination), target).split(path.sep).join("/");
    if (!relative.startsWith(".")) relative = `./${relative}`;
    return `${quote}${relative}${quote}`;
  });
  if (rewritten !== declaration) await writeFile(destination, rewritten);
}
