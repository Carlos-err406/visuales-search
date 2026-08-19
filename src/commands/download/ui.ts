import cliProgress from "cli-progress";
import colors from "ansi-colors";
import { PROGRESS_BAR_COMPLETE, PROGRESS_BAR_INCOMPLETE } from "./progress-style.js";
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

const BAR_SIZE = 32;
const FILENAME_WIDTH = 38;
const SIZE_WIDTH = 21;

function truncateMiddle(value: string, width: number): string {
  if (value.length <= width) return value.padEnd(width, " ");
  if (width <= 3) return value.slice(0, width);

  const headLength = Math.ceil((width - 3) / 2);
  const tailLength = Math.floor((width - 3) / 2);
  return `${value.slice(0, headLength)}...${value.slice(-tailLength)}`;
}

export function createDownloadBarPayload(filename: string, slot: number) {
  return {
    slot: slot.toString().padStart(2, " "),
    filenamePadded: truncateMiddle(filename, FILENAME_WIDTH),
  };
}

export function createDownloadBar(
  filename: string,
  total: number,
  current: number,
  status: string = "Starting",
  slot = 1
) {
  const payload = createDownloadBarPayload(filename, slot);
  const progress = progressBars.create(
    100,
    current,
    {
      ...payload,
      downloadedPadded: `${formatSize(current)} / ${formatSize(total)}`.padEnd(SIZE_WIDTH, " "),
      percentagePadded: "0".padStart(3, " "),
      statusPadded: status.padEnd(11, " "),
    },
    {
      format: `[${colors.cyan("{slot}")}] [${colors.green("{bar}")}] ${colors.bold.white(
        "{percentagePadded}%"
      )}  ${colors.white("{filenamePadded}")} ${colors.gray("{downloadedPadded}")} ${colors.yellow("{statusPadded}")}`,
      barCompleteChar: PROGRESS_BAR_COMPLETE,
      barIncompleteChar: PROGRESS_BAR_INCOMPLETE,
      barsize: BAR_SIZE,
    }
  );

  return { progress, slot };
}

export function resetDownloadBar(bar: ReturnType<typeof createDownloadBar>) {
  bar.progress.update(0, {
    ...createDownloadBarPayload("", bar.slot),
    downloadedPadded: "".padEnd(SIZE_WIDTH, " "),
    percentagePadded: " ".repeat(3),
    statusPadded: "".padEnd(11, " "),
  });
}

export function createFileCountBar(totalFiles: number) {
  return progressBars.create(
    100,
    0,
    {
      filesPadded: `0/${totalFiles}`.padStart(9, " "),
      downloadedPadded: "0 B / 0 B".padEnd(SIZE_WIDTH, " "),
      percentagePadded: "0".padStart(3, " "),
      etaPadded: "ETA --:--:--".padEnd(12, " "),
    },
    {
      format: `${colors.bold.white("Overall")} [${colors.green("{bar}")}] ${colors.bold.white(
        "{percentagePadded}%"
      )}  ${colors.gray("{downloadedPadded}")} ${colors.bold.white("{filesPadded}")} files  ${colors.cyan(
        "{etaPadded}"
      )}`,
      barCompleteChar: PROGRESS_BAR_COMPLETE,
      barIncompleteChar: PROGRESS_BAR_INCOMPLETE,
      barsize: BAR_SIZE,
    }
  );
}

export function updateFileCountBar(
  bar: ReturnType<typeof createFileCountBar>,
  completedFiles: number,
  totalFiles: number,
  downloadedBytes: number = completedFiles,
  totalBytes: number = totalFiles,
  speedBytesPerSecond: number = 0
) {
  const hasByteTotal = totalBytes > 0;
  const isComplete = totalFiles === 0 || completedFiles >= totalFiles;
  const displayedDownloadedBytes = isComplete && hasByteTotal ? totalBytes : Math.min(downloadedBytes, totalBytes);
  const percentage = isComplete
    ? 100
    : hasByteTotal
      ? Math.floor((Math.min(downloadedBytes, totalBytes) / totalBytes) * 100)
      : Math.floor((completedFiles / totalFiles) * 100);
  const remainingBytes = hasByteTotal ? Math.max(0, totalBytes - displayedDownloadedBytes) : 0;
  const etaSeconds = remainingBytes === 0 ? 0 : speedBytesPerSecond > 0 ? remainingBytes / speedBytesPerSecond : null;

  bar.update(percentage, {
    filesPadded: `${completedFiles}/${totalFiles}`.padStart(9, " "),
    downloadedPadded: hasByteTotal
      ? `${formatSize(displayedDownloadedBytes)} / ${formatSize(totalBytes)}`.padEnd(SIZE_WIDTH, " ")
      : "-- / --".padEnd(SIZE_WIDTH, " "),
    percentagePadded: percentage.toString().padStart(3, " "),
    etaPadded: `ETA ${formatDuration(etaSeconds)}`.padEnd(12, " "),
  });
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
