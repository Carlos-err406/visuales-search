#!/usr/bin/env node

import { Command } from "commander";
import { setupSearchCommand } from "./commands/search/index.js";
import { setupDownloadCommand } from "./commands/download/index.js";
import { setupCacheCommand } from "./commands/cache/index.js";
import { setupUpdateCommand } from "./commands/update/index.js";

function createProgram(): Command {
  const program = new Command();

  program
    .name("visuales")
    .description("Search tool for visuales.uclv.cu content")
    .version("1.0.0", "-v, --version", "display version number")
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
    setupCacheCommand(program);
    setupUpdateCommand(program);

    // Parse command line arguments
    await program.parseAsync(process.argv);

    // If no command is provided, show help
    if (!process.argv.slice(2).length) {
      program.outputHelp();
    }
  } catch (error) {
    console.error(
      "❌ CLI Error:",
      error instanceof Error ? error.message : "Unknown error"
    );
    process.exit(1);
  }
}

main();
