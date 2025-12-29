import { Command } from "commander";
import colors from "ansi-colors";
import { exec } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import * as util from "node:util";

const execAsync = util.promisify(exec);

async function updateCommand(): Promise<void> {
  console.log(colors.blue("🔄 Updating Visuales CLI..."));

  try {
    // Determine project root
    // current file: src/commands/update/index.ts (in dist: dist/commands/update/index.js)
    // We need to go up from dist/commands/update/index.js -> dist/commands/update -> dist/commands -> dist -> root
    const currentFilePath = fileURLToPath(import.meta.url);
    const projectRoot = path.resolve(path.dirname(currentFilePath), "../../..");

    console.log(colors.gray(`📂 Project root detected: ${projectRoot}`));

    // 1. Rebuild
    console.log(colors.yellow("🔨 Building cli..."));
    await execAsync("npm run build", { cwd: projectRoot });
    console.log(colors.green("✅ Build successful"));

    // 2. Install globally
    console.log(colors.yellow("📦 Installing globally..."));
    await execAsync("npm install -g .", { cwd: projectRoot });
    console.log(colors.green("✅ Installation successful"));

    console.log(colors.green("\n🎉 Visuales CLI updated successfully!"));
  } catch (error) {
    console.error(colors.red("\n❌ Update failed:"));
    if (error instanceof Error) {
      console.error(colors.red(error.message));
    } else {
      console.error(colors.red(String(error)));
    }
    process.exit(1);
  }
}

export function setupUpdateCommand(program: Command): void {
  program
    .command("update")
    .description("Update the Visuales CLI by rebuilding and reinstalling from source")
    .action(updateCommand);
}
