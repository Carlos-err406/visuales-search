import { Command } from "commander";
import colors from "ansi-colors";
import { formatDistanceToNow } from "date-fns";
import { clearAllCaches, clearCacheById, listCaches } from "../../lib/cache.js";

async function cacheListAction(): Promise<void> {
  const caches = await listCaches();

  if (caches.length === 0) {
    console.log(colors.yellow("📭 No caches found."));
    return;
  }

  console.log(colors.blue.bold("\n📦 Cached Data:"));
  console.log(
    colors.gray("──────────────────────────────────────────────────")
  );

  for (const cache of caches) {
    const sizeStr =
      cache.type === "directory"
        ? `${cache.size} files`
        : `${(cache.size / 1024).toFixed(2)} KB`;
    const ageString = formatDistanceToNow(new Date(cache.created), {
      addSuffix: true,
    });

    console.log(
      `${colors.cyan.bold(cache.id.padEnd(10))} ${colors.white(cache.name)}`
    );
    console.log(
      `           ${colors.gray(`Size: ${sizeStr} | Created: ${ageString}`)}`
    );
    if (cache.description) {
      console.log(`           ${colors.gray.italic(cache.description)}`);
    }
    console.log();
  }
}

async function cacheClearCommand(options: {
  all?: boolean;
  id?: string;
}): Promise<void> {
  if (options.all) {
    try {
      await clearAllCaches();
    } catch (error) {
      console.error(colors.red(`❌ Failed to clear all caches: ${error}`));
      process.exit(1);
    }
    return;
  }

  if (options.id) {
    try {
      await clearCacheById(options.id);
    } catch (error) {
      console.error(
        colors.red(
          `❌ Failed to clear cache with ID '${options.id}': ${
            error instanceof Error ? error.message : String(error)
          }`
        )
      );
      process.exit(1);
    }
    return;
  }

  console.log(
    colors.yellow("⚠️  Please provide an option: --all or --id <cache-id>")
  );
  console.log(colors.gray("Example: visuales cache clear --all"));
}

export function setupCacheCommand(program: Command): void {
  const cacheCommand = program
    .command("cache")
    .description("Manage cached data")
    .action(cacheListAction);

  cacheCommand
    .command("clear")
    .description("Clear cached data")
    .option("--all", "Clear all caches")
    .option("--id <cache-id>", "Clear cache by ID (e.g., 'list', 'download')")
    .action(cacheClearCommand);
}
