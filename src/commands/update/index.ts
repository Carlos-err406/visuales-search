import { Command } from "commander";
import colors from "ansi-colors";
import { exec } from "node:child_process";
import * as util from "node:util";

const execAsync = util.promisify(exec);

async function updateCommand(): Promise<void> {
  console.log(colors.blue("🔄 Updating Visuales CLI..."));

  try {
    console.log(colors.yellow("📦 Installing latest published version..."));
    await execAsync("npm install -g visuales@latest");
    console.log(colors.green("✅ Update installed"));

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
  program.command("update").description("Update the Visuales CLI from npm").action(updateCommand);
}
