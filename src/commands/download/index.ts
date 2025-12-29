import { Command } from "commander";
import colors from "ansi-colors";
import { downloadUrl, stopProgress } from "./downloader.js";
import { DownloadOptions } from "./types.js";
import { CONFIG } from "../../lib/types.js";
import path from "path";

// Helper functions for Download
export function printDownloadUsage(): void {
  console.log(colors.yellow("Usage: visuales download <url> --output <path> [options]"));
  console.log(colors.gray("Examples:"));
  console.log(
    colors.gray(
      '  visuales download "https://visuales.uclv.cu/Series/Ingles/Killing%20Eve/libros/1.pdf" --output ./downloads'
    )
  );
  console.log(
    colors.gray(
      '  visuales download "https://visuales.uclv.cu/Series/Ingles/Killing%20Eve/libros/" --output ./killing-eve-books --concurrent 5'
    )
  );
}

export function printDownloading(url: string, outputPath: string, cacheDir: string): void {
  const line = colors.gray("─".repeat(50));
  console.log(line);
  console.log(`${colors.cyan("●")} ${colors.bold.white("VISUALES DOWNLOADER")}`);
  console.log(line);
  console.log(`${colors.gray("Source:")}  ${colors.white(url)}`);
  console.log(`${colors.gray("Target:")}  ${colors.white(path.resolve(outputPath))}`);
  console.log(`${colors.gray("Cache:")}   ${colors.white(path.resolve(cacheDir))}`);
  console.log(line);
  console.log();
}

export function printError(error: unknown): void {
  console.error(colors.bold.red("\n[ERROR]"));
  if (error instanceof Error) {
    console.error(colors.red(error.message));
  } else {
    console.error(colors.red(String(error)));
  }
}

async function downloadCommand(
  url: string,
  options: {
    output: string;
    resume?: boolean;
    maxRetries?: string;
    timeout?: string;
    concurrent?: string;
    verbose?: boolean;
  }
): Promise<void> {
  if (!url) {
    console.log(colors.yellow("Please provide a URL to download"));
    printDownloadUsage();
    return;
  }

  if (!options.output) {
    console.log(colors.yellow("Please provide an output directory using --output"));
    printDownloadUsage();
    return;
  }

  const downloadOptions: DownloadOptions = {
    output: options.output,
    resume: options.resume ?? true,
    maxRetries: parseInt(options.maxRetries ?? "3"),
    timeout: options.timeout === "Infinity" ? Infinity : parseInt(options.timeout ?? "Infinity"),
    concurrent: parseInt(options.concurrent ?? "5"),
    verbose: options.verbose,
  };

  printDownloading(url, downloadOptions.output, CONFIG.CACHE_DIR);

  try {
    await downloadUrl(url, downloadOptions);
    await stopProgress();
    console.log(colors.bold.green("\n[SUCCESS] All downloads finished successfully!"));
  } catch (error) {
    await stopProgress();
    printError(error);
    process.exit(1);
  }
}

export function setupDownloadCommand(program: Command): void {
  program
    .command("download")
    .description("Download files or directories from visuales.uclv.cu")
    .argument("<url>", "URL to download (file or directory)")
    .requiredOption("-o, --output <path>", "Output directory")
    .option("-r, --resume <boolean>", "Resume interrupted downloads", true)
    .option("--max-retries <number>", "Maximum retry attempts", "3")
    .option("--timeout <number>", "Request timeout in seconds (Infinity for no timeout)", "Infinity")
    .option("-c, --concurrent <number>", "Maximum concurrent downloads", "5")
    .action((url, options, cmd) => {
      // In subcommands, options is from the command, but we need the program for global options
      const globalOpts = cmd.parent.opts();
      return downloadCommand(url, { ...options, verbose: globalOpts.verbose });
    });
}
