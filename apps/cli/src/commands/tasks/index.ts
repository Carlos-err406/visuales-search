import { Command } from "commander";
import colors from "ansi-colors";
import { listDownloadTasks, moveQueuedDownloadTask, orderedQueue } from "@visuales/core";
import { transferName } from "@visuales/core/download/transfer-summary";

async function queueCommand(): Promise<void> {
  const queue = orderedQueue(await listDownloadTasks());
  if (!queue.length) console.log("No queued downloads.");
  for (const [index, task] of queue.entries()) console.log(`${index + 1}\t${task.id}\t${transferName(task)}`);
}

async function moveCommand(task: string, position: string): Promise<void> {
  try {
    if (position !== "next" && !/^[1-9]\d*$/.test(position))
      throw new Error("Queue position must be a positive integer");
    await moveQueuedDownloadTask(task, position === "next" ? "next" : Number(position));
    await queueCommand();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
import { cancelCommand, deleteCommand, resumeCommand, retryFilesCommand } from "../download/index.js";
import { findDownloadTask } from "@visuales/core";
import { readDownloadFileDetails } from "@visuales/core/download/file-details";
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

  tasks.command("queue").description("Show waiting downloads in execution order").action(queueCommand);
  tasks
    .command("retry")
    .description("Retry recorded failed files on the original stopped task (all failed files by default)")
    .argument("<task>", "Task id or URL")
    .option(
      "--file <path>",
      "Task-relative file path to retry (repeatable)",
      (value: string, previous: string[]) => [...previous, value],
      []
    )
    .action((id: string, options: { file: string[] }) =>
      retryFilesCommand(id, options.file.length ? options.file : undefined)
    );
  tasks
    .command("files")
    .description("List recorded file paths and statuses for a transfer")
    .argument("<task>", "Task id or URL")
    .option("--json", "Print file details as JSON")
    .action(async (id: string, options: { json?: boolean }) => {
      const task = await findDownloadTask(id);
      if (!task) throw new Error("Download task not found");
      const details = await readDownloadFileDetails(task.id);
      if (options.json) console.log(JSON.stringify(details));
      else if (!details) console.log("No file details were recorded for this transfer.");
      else
        for (const file of details.files)
          console.log(`${file.status}\t${file.path}${file.error ? `\t${file.error}` : ""}`);
    });
  tasks
    .command("move")
    .description("Move a queued download to a one-based queue position")
    .argument("<task>", "Task id or URL")
    .argument("<position>", "New queue position (1 is next)")
    .action(moveCommand);
  tasks
    .command("next")
    .description("Move a queued download to the front without interrupting active downloads")
    .argument("<task>", "Task id or URL")
    .action((task: string) => moveCommand(task, "next"));

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
    .argument("[tasks...]", "Task ids or URLs")
    .option("-a, --all", "Cancel every running and queued task")
    // optsWithGlobals: the parent `tasks` command also defines --all, and Commander routes the
    // flag there, so the merged view is what actually carries `cancel --all`.
    .action((idOrUrls, _options, cmd) => cancelCommand(idOrUrls, { all: cmd.optsWithGlobals().all }));

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
