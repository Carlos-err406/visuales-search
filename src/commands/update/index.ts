import { Command } from "commander";
import colors from "ansi-colors";
import { exec } from "node:child_process";
import * as util from "node:util";

const execAsync = util.promisify(exec);

function getErrorOutput(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const output = ["stdout", "stderr"]
      .map((key) => (key in error ? String(error[key as keyof typeof error] ?? "") : ""))
      .join("\n")
      .trim();

    if (output) return output;
  }

  return error instanceof Error ? error.message : String(error);
}

function isPermissionError(output: string): boolean {
  return /\b(EACCES|EPERM)\b/i.test(output) || /permission denied/i.test(output);
}

async function updateCommand(): Promise<void> {
  console.log(colors.blue("🔄 Updating Visuales CLI..."));

  try {
    console.log(colors.yellow("📦 Installing latest published version..."));
    await execAsync("npm install -g visuales@latest");
    console.log(colors.green("✅ Update installed"));

    console.log(colors.green("\n🎉 Visuales CLI updated successfully!"));
  } catch (error) {
    const output = getErrorOutput(error);

    console.error(colors.red("\n❌ Update failed:"));
    console.error(colors.red(output));

    if (isPermissionError(output)) {
      console.error();
      console.error(colors.yellow("This looks like a global npm permissions issue."));
      console.error(colors.gray("Try one of these:"));
      console.error(colors.gray("  sudo npm install -g visuales@latest"));
      console.error(colors.gray("  npm config set prefix ~/.npm-global"));
      console.error(colors.gray('  export PATH="$HOME/.npm-global/bin:$PATH"'));
    }

    process.exit(1);
  }
}

export function setupUpdateCommand(program: Command): void {
  program.command("update").description("Update the Visuales CLI from npm").action(updateCommand);
}
