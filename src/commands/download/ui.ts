import cliProgress from "cli-progress";
import colors from "ansi-colors";
import { formatAverageSpeed, formatDuration, formatSize } from "./utils.js";

export const progressBars = new cliProgress.MultiBar(
  {
    hideCursor: true,
    clearOnComplete: false,
    format: "{filename}",
    forceRedraw: true,
  },
  cliProgress.Presets.shades_grey
);

export let activeDownloadCount = 0;
export const incrementActiveDownloads = () => activeDownloadCount++;
export const decrementActiveDownloads = () => activeDownloadCount--;

export function createDownloadBar(filename: string, total: number, current: number, status: string = "Starting") {
  // Row 1: Name (Status)
  const header = progressBars.create(
    1,
    0,
    { filename: `${colors.cyan("●")} ${colors.bold.white(filename)} ${colors.gray(status)}` },
    { format: "{filename}" }
  );

  // Row 2: Bar % | Downloaded/Total | Speed | ETA
  const progress = progressBars.create(
    total,
    current,
    {
      speed: "---".padEnd(10, " "),
      downloadedPadded: `${formatSize(current)} / ${formatSize(total)}`.padEnd(25, " "),
      percentagePadded: "0".padStart(3, " "),
      etaPadded: "ETA: --:--:--".padEnd(14, " "),
    },
    {
      format: `  ${colors.green("{bar}")} ${colors.bold.white("{percentagePadded}%")}  ${colors.gray("{downloadedPadded}")}  ${colors.gray("•")}  ${colors.yellow("{speed}")}  ${colors.gray("•")}  ${colors.cyan("{etaPadded}")}`,
      barCompleteChar: "━",
      barIncompleteChar: "─",
      barsize: 35,
    }
  );

  return { header, progress };
}

export function logDownloadComplete(filename: string, size: number, durationSeconds: number) {
  progressBars.log(
    `${colors.gray("·")} ${colors.bold.white(filename)} ${colors.gray(`(${formatSize(size)})`)} ${colors.green(
      `(Done in ${formatDuration(durationSeconds)} • avg ${formatAverageSpeed(size, durationSeconds)})`
    )}\n`
  );
}

export function logDownloadSkipped(filename: string, reason: string) {
  progressBars.log(`${colors.gray("·")} ${colors.bold.white(filename)} ${colors.gray(`(Skipped: ${reason})`)}\n`);
}

export function logDownloadError(filename: string, error: string) {
  progressBars.log(`${colors.bold.red(filename)} ${colors.red(`(Error: ${error})`)}\n`);
}
