import { build } from "esbuild";

await build({
  entryPoints: ["apps/sidecar/src/main.ts"],
  outfile: "apps/sidecar/dist/sidecar.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  minify: true,
  legalComments: "eof",
});
