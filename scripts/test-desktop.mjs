import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "vite";

const server = await createServer({ root: "apps/desktop", server: { host: "127.0.0.1", port: 0, strictPort: true } });
try {
  await server.listen();
  const { stdout, stderr } = await promisify(execFile)(process.execPath, ["test/desktop-ui.smoke.mjs"], {
    env: { ...process.env, DESKTOP_URL: server.resolvedUrls.local[0] },
    timeout: 180000,
    maxBuffer: 10 * 1024 * 1024,
  });
  process.stdout.write(stdout);
  process.stderr.write(stderr);
} finally {
  await server.close();
}
