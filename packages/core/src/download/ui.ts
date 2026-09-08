export interface ProgressBar {
  update(value: number, payload?: Record<string, unknown>): void;
  setTotal(value: number): void;
}

export interface DownloadBar {
  progress: ProgressBar;
  slot: number;
}

export interface DownloadRenderer {
  progressBars: {
    log(message: string): void;
    remove(bar: ProgressBar): void;
    stop(): void;
  };
  createDownloadBar(filename: string, total: number, current: number, status?: string, slot?: number): DownloadBar;
  createDownloadBarPayload(filename: string, slot: number): Record<string, unknown>;
  resetDownloadBar(bar: DownloadBar): void;
  createFileCountBar(total: number): ProgressBar;
  updateFileCountBar(
    bar: ProgressBar,
    completed: number,
    total: number,
    bytes?: number,
    totalBytes?: number,
    speed?: number
  ): void;
  logDownloadComplete(filename: string, size: number, seconds: number): void;
  logDownloadSkipped(filename: string, reason: string): void;
  incrementActiveDownloads(): void;
  decrementActiveDownloads(): void;
}

const silentBar: ProgressBar = { update() {}, setTotal() {} };
let renderer: DownloadRenderer = {
  progressBars: { log() {}, remove() {}, stop() {} },
  createDownloadBar: (_name, _total, _current, _status, slot = 1) => ({ progress: silentBar, slot }),
  createDownloadBarPayload: () => ({}),
  resetDownloadBar() {},
  createFileCountBar: () => silentBar,
  updateFileCountBar() {},
  logDownloadComplete() {},
  logDownloadSkipped() {},
  incrementActiveDownloads() {},
  decrementActiveDownloads() {},
};

// Each CLI invocation or desktop worker owns its renderer; the engine defaults to headless.
export function setDownloadRenderer(value: DownloadRenderer): void {
  renderer = value;
}
export const progressBars = {
  log: (message: string) => renderer.progressBars.log(message),
  remove: (bar: ProgressBar) => renderer.progressBars.remove(bar),
  stop: () => renderer.progressBars.stop(),
};
export const createDownloadBar = (...args: Parameters<DownloadRenderer["createDownloadBar"]>) =>
  renderer.createDownloadBar(...args);
export const createDownloadBarPayload = (...args: Parameters<DownloadRenderer["createDownloadBarPayload"]>) =>
  renderer.createDownloadBarPayload(...args);
export const resetDownloadBar = (bar: DownloadBar) => renderer.resetDownloadBar(bar);
export const createFileCountBar = (total: number) => renderer.createFileCountBar(total);
export const updateFileCountBar = (...args: Parameters<DownloadRenderer["updateFileCountBar"]>) =>
  renderer.updateFileCountBar(...args);
export const logDownloadComplete = (...args: Parameters<DownloadRenderer["logDownloadComplete"]>) =>
  renderer.logDownloadComplete(...args);
export const logDownloadSkipped = (...args: Parameters<DownloadRenderer["logDownloadSkipped"]>) =>
  renderer.logDownloadSkipped(...args);
export const incrementActiveDownloads = () => renderer.incrementActiveDownloads();
export const decrementActiveDownloads = () => renderer.decrementActiveDownloads();
