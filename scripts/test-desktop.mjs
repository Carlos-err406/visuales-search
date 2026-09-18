import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "vite";

// Core rebuilds in a concurrent dev session must not reload pages midway through a regression test.
const server = await createServer({
  root: "apps/desktop",
  server: { host: "127.0.0.1", port: 0, strictPort: true, watch: null, hmr: false },
});
try {
  await server.listen();
  const { stdout, stderr } = await promisify(execFile)(process.execPath, ["test/desktop-ui.smoke.mjs"], {
    env: { ...process.env, DESKTOP_URL: server.resolvedUrls.local[0] },
    // Leave room for the full cross-feature suite on shared CI runners.
    timeout: 300000,
    maxBuffer: 10 * 1024 * 1024,
  });
  process.stdout.write(stdout);
  process.stderr.write(stderr);
} finally {
  await server.close();
}
