#!/usr/bin/env node

import { Command } from "commander";
import { readFileSync } from "node:fs";
import { setupSearchCommand } from "./commands/search/index.js";
import { setupDownloadCommand } from "./commands/download/index.js";
import { setupCacheCommand } from "./commands/cache/index.js";
import { setupTasksCommand } from "./commands/tasks/index.js";

function readPackageVersion(): string {
  try {
    const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")) as {
      version?: string;
    };
    return packageJson.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function createProgram(): Command {
  const program = new Command();

  program
    .name("visuales")
    .description("Search and download visuales.uclv.cu content")
    .version(readPackageVersion(), "-v, --version", "display version number")
    .helpOption("-h, --help", "display help for command");

  // Global options
  program.option("--verbose", "enable verbose logging");

  return program;
}

async function main(): Promise<void> {
  try {
    const program = createProgram();

    // Setup subcommands
    setupSearchCommand(program);
    setupDownloadCommand(program);
    setupTasksCommand(program);
    setupCacheCommand(program);

    // Parse command line arguments
    await program.parseAsync(process.argv);

    // If no command is provided, show help
    if (!process.argv.slice(2).length) {
      program.outputHelp();
    }
  } catch (error) {
    console.error("❌ CLI Error:", error instanceof Error ? error.message : "Unknown error");
    process.exit(1);
  }
}

main();
