export function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1000;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !isFinite(seconds)) return "--:--:--";
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return [hrs, mins, secs].map((v) => v.toString().padStart(2, "0")).join(":");
}

export function formatAverageSpeed(bytes: number, seconds: number): string {
  if (seconds <= 0) return "--";
  return `${formatSize(bytes / seconds)}/s`;
}

export function parseSize(sizeStr: string | undefined): number {
  if (!sizeStr || sizeStr === "-" || sizeStr.trim() === "") return 0;

  // Clean up string - remove extra whitespace
  const cleanSizeStr = sizeStr.trim();

  const units: { [key: string]: number } = {
    B: 1,
    K: 1024,
    M: 1024 * 1024,
    G: 1024 * 1024 * 1024,
    T: 1024 * 1024 * 1024 * 1024,
  };

  // Enhanced regex to handle formats like "82K", "789M", "4.7K", "1.0M", "1024", "1.5GB"
  const match = cleanSizeStr.match(/^([\d.]+)\s*([KMGT]?B?)$/i);
  if (!match) return 0;

  const value = parseFloat(match[1]);
  if (isNaN(value)) return 0;

  const unit = match[2].toUpperCase();
  let multiplier = 1;

  if (unit === "" || unit === "B") {
    multiplier = units.B;
  } else if (unit === "K" || unit === "KB") {
    multiplier = units.K;
  } else if (unit === "M" || unit === "MB") {
    multiplier = units.M;
  } else if (unit === "G" || unit === "GB") {
    multiplier = units.G;
  } else if (unit === "T" || unit === "TB") {
    multiplier = units.T;
  }

  return Math.floor(value * multiplier);
}

export { splitIgnoreRules as splitGlobPatterns, createIgnoreMatcher as createGlobMatcher } from "./ignore-rules.js";

// Shared function for thread progress visualization
export function calculateThreadProgress(percentage: number): string {
  const filledCircles = Math.floor(percentage / 10);
  const emptyCircles = 10 - filledCircles;
  return "●".repeat(filledCircles) + "○".repeat(emptyCircles);
}

// UI throttling utilities
export class UIThrottler {
  private lastUpdate = 0;
  private readonly minInterval: number;

  constructor(minInterval: number = 100) {
    this.minInterval = minInterval;
  }

  shouldUpdate(): boolean {
    const now = Date.now();
    if (now - this.lastUpdate >= this.minInterval) {
      this.lastUpdate = now;
      return true;
    }
    return false;
  }

  reset(): void {
    this.lastUpdate = 0;
  }
}

// Progress state tracking to avoid redundant updates
export class ProgressState {
  private lastProgress = -1;

  shouldUpdate(newProgress: number): boolean {
    if (Math.abs(newProgress - this.lastProgress) >= 1) {
      this.lastProgress = newProgress;
      return true;
    }
    return false;
  }

  reset(): void {
    this.lastProgress = -1;
  }
}
