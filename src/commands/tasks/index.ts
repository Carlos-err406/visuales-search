import { Command } from "commander";
import colors from "ansi-colors";
import { cancelCommand, deleteCommand, resumeCommand } from "../download/index.js";
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

async function statusCommand(idOrUrls: string[]): Promise<void> {
  const missingTasks: string[] = [];

  for (const [index, idOrUrl] of idOrUrls.entries()) {
    if (index > 0) {
      console.log();
    }

    const found = await printDownloadTaskStatus(idOrUrl);
    if (!found) {
      missingTasks.push(idOrUrl);
      console.error(colors.red(`No download task found for '${idOrUrl}'.`));
      console.log(colors.gray("Run `visuales tasks` to see known tasks."));
    }
  }

  if (missingTasks.length > 0) {
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
    .description("Resume previous download tasks by task id or URL")
    .argument("<tasks...>", "Task ids or URLs")
    .option("-d, --detach", "Run the resumed download in the background")
    .option("-q, --queue", "Wait for running downloads to finish before starting")
    .action((idOrUrls, options, cmd) => {
      const globalOpts = cmd.parent.parent.opts();
      return resumeCommand(idOrUrls, { detach: options.detach, queue: options.queue, verbose: globalOpts.verbose });
    });

  tasks
    .command("cancel")
    .description("Cancel running download tasks by task id or URL")
    .argument("<tasks...>", "Task ids or URLs")
    .action(cancelCommand);

  tasks
    .command("delete")
    .alias("rm")
    .description("Delete download tasks by task id or URL (does not remove downloaded files)")
    .argument("<tasks...>", "Task ids or URLs")
    .action(deleteCommand);

  tasks
    .command("watch")
    .description("Watch running download task progress")
    .argument("[task]", "Task id or URL")
    .option("-i, --interval <seconds>", "Refresh interval in seconds", "2")
    .action(watchCommand);

  tasks
    .command("status")
    .description("Show details for download tasks")
    .argument("<tasks...>", "Task ids or URLs")
    .action(statusCommand);
}
