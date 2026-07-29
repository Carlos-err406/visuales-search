import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import process from "node:process";

if (
  process.env.CI ||
  process.env.npm_command === "pack" ||
  process.env.npm_command === "publish" ||
  !existsSync(".git")
) {
  process.exit(0);
}

execFileSync("npx", ["husky"], { stdio: "inherit" });
