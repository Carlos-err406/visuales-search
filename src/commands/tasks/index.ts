import { Command } from "commander";
import colors from "ansi-colors";
import { cancelCommand, resumeCommand } from "../download/index.js";
import {
  clearAndPrintDownloadTasks,
  printDownloadTasks,
  printDownloadTaskStatus,
  watchDownloadTasks,
} from "../download/tasks.js";

async function listTasksCommand(options: { all?: boolean; clear?: boolean }): Promise<void> {
  if (options.clear) {
    await clearAndPrintDownloadTasks();
    return;
  }

  await printDownloadTasks({ all: options.all });
}

async function statusCommand(idOrUrl: string): Promise<void> {
  const found = await printDownloadTaskStatus(idOrUrl);
  if (!found) {
    console.error(colors.red(`No download task found for '${idOrUrl}'.`));
    console.log(colors.gray("Run `visuales tasks` to see known tasks."));
    process.exit(1);
  }
}

async function watchCommand(idOrUrl: string | undefined, options: { interval?: string }): Promise<void> {
  const found = await watchDownloadTasks(idOrUrl, { interval: options.interval });
  if (!found) {
    process.exit(1);
  }
}

export function setupTasksCommand(program: Command): void {
  const tasks = program
    .command("tasks")
    .description("Manage background and resumable download tasks")
    .option("-a, --all", "Show completed and failed task history")
    .option("--clear", "Clear saved download task history")
    .action(listTasksCommand);

  tasks
    .command("resume")
    .description("Resume a previous download task by task id or URL")
    .argument("<task>", "Task id or URL")
    .option("-d, --detach", "Run the resumed download in the background")
    .action((idOrUrl, options, cmd) => {
      const globalOpts = cmd.parent.parent.opts();
      return resumeCommand(idOrUrl, { detach: options.detach, verbose: globalOpts.verbose });
    });

  tasks
    .command("cancel")
    .description("Cancel a running download task by task id or URL")
    .argument("<task>", "Task id or URL")
    .action(cancelCommand);

  tasks
    .command("watch")
    .description("Watch running download task progress")
    .argument("[task]", "Task id or URL")
    .option("-i, --interval <seconds>", "Refresh interval in seconds", "2")
    .action(watchCommand);

  tasks
    .command("status")
    .description("Show details for one download task")
    .argument("<task>", "Task id or URL")
    .action(statusCommand);
}
