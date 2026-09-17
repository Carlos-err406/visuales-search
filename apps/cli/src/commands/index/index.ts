import { Command } from "commander";
import { setTimeout as sleep } from "node:timers/promises";
import { runSearchIndexer, controlSearchIndex, getSearchIndexStatus } from "@visuales/core/search-indexer";
import { searchIndexLabel, type SearchIndexAction, type SearchIndexStatus } from "@visuales/core/search-index-types";

function printStatus(status: SearchIndexStatus) {
  console.log(
    `${searchIndexLabel(status)} | ${status.files.toLocaleString()} files | ${status.completed}/${status.total} folders`
  );
  if (status.error) console.error(status.error);
}

async function run(action: SearchIndexAction = "resume") {
  const initial = await controlSearchIndex(action);
  if (action === "pause" || initial.phase === "paused") {
    printStatus(initial);
    return;
  }
  const controller = new AbortController();
  let owned = false;
  let last = "";
  const report = async () => {
    const status = await getSearchIndexStatus();
    const label = `${searchIndexLabel(status)}:${status.files}:${status.error ?? ""}`;
    if (label !== last) {
      last = label;
      printStatus(status);
    }
    return status;
  };
  const interrupt = () => {
    void (owned ? controlSearchIndex("pause") : Promise.resolve()).catch(() => {}).finally(() => controller.abort());
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  const timer = setInterval(() => {
    void report().catch(() => {});
  }, 1000);
  try {
    await runSearchIndexer({
      signal: controller.signal,
      onAcquired: () => {
        owned = true;
      },
    });
    // Another owner (usually desktop) continues the same job. Observing never steals its lease.
    if (!owned)
      while (!controller.signal.aborted) {
        const status = await report();
        if (!status.running || ["complete", "partial", "paused", "offline"].includes(status.phase)) break;
        await sleep(1000, undefined, { signal: controller.signal }).catch(() => {});
      }
    const final = await report();
    if (["offline", "partial"].includes(final.phase)) process.exitCode = 1;
  } finally {
    clearInterval(timer);
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
  }
}

export function setupIndexCommand(program: Command) {
  const command = program
    .command("index")
    .description("Index library filenames for shared CLI and desktop search")
    .action(() => run());
  command
    .command("status")
    .description("Show file-index coverage and progress")
    .action(async () => printStatus(await getSearchIndexStatus()));
  command
    .command("pause")
    .description("Pause shared background indexing")
    .action(() => run("pause"));
  command
    .command("resume")
    .description("Resume indexing in the foreground or observe its current owner")
    .action(() => run("resume"));
  command
    .command("refresh")
    .description("Refresh file listings without removing searchable cached results")
    .action(() => run("refresh"));
}
