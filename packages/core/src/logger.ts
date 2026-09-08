export interface Logger {
  log(...values: unknown[]): void;
  error(...values: unknown[]): void;
}

export let logger: Logger = { log() {}, error() {} };
export function setLogger(value: Logger): void {
  logger = value;
}
