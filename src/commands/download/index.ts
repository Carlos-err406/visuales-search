import { Command } from "commander";
import colors from "ansi-colors";

// Helper functions for Download
export function printDownloadUsage(): void {
  console.log(
    colors.yellow("Usage: visuales download <url> --output <path> [options]")
  );
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

export function printDownloading(url: string, outputPath: string): void {
  console.log(colors.blue(`📂 Starting download from: ${url}`));
  console.log(colors.gray(`📁 Output directory: ${outputPath}`));
  console.log();
}

export function printDownloadSummary(
  completed: number,
  total: number,
  failed: number
): void {
  console.log(
    colors.green(`✅ Download completed: ${completed}/${total} files`)
  );
  if (failed > 0) {
    console.log(colors.red(`❌ Failed: ${failed} files`));
  }
}

export function printError(error: unknown): void {
  console.error(colors.red("❌ Error:"));
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
    maxRetries?: number;
    timeout?: string;
    concurrent?: number;
  }
): Promise<void> {
  if (!url) {
    console.log(colors.yellow("Please provide a URL to download"));
    printDownloadUsage();
    return;
  }

  if (!options.output) {
    console.log(
      colors.yellow("Please provide an output directory using --output")
    );
    printDownloadUsage();
    return;
  }

  const downloadOptions = {
    output: options.output,
    resume: options.resume ?? true,
    maxRetries: options.maxRetries ?? 3,
    timeout:
      options.timeout === "Infinity"
        ? Infinity
        : Number(options.timeout) ?? Infinity,
    concurrent: options.concurrent ?? 3,
  };

  printDownloading(url, downloadOptions.output);

  try {
    console.log(colors.green("✅ Download functionality would be implemented"));
  } catch (error) {
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
    .option(
      "--timeout <number>",
      "Request timeout in seconds (Infinity for no timeout)",
      "Infinity"
    )
    .option("--concurrent <number>", "Maximum concurrent downloads", "3")
    .action(downloadCommand);
}
