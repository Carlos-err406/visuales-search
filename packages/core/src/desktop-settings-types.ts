import { MAX_CONNECTIONS_PER_FILE } from "./download/limits.js";
import { createIgnoreMatcher, splitIgnoreRules } from "./download/ignore-rules.js";

export interface DesktopSettings {
  output: string;
  concurrent: number;
  connections: number;
  maxRetries: number;
  exclude: string[];
}

export interface DesktopSettingsSnapshot {
  settings: DesktopSettings;
  defaults: DesktopSettings;
}

export const desktopSettingsLimits = {
  concurrent: { min: 1, max: 32 },
  connections: { min: 1, max: MAX_CONNECTIONS_PER_FILE },
  maxRetries: { min: 0, max: 20 },
} as const;

export const desktopExclusionLimits = { patterns: 100, length: 512 } as const;

export function normalizeDesktopExclusions(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((pattern) => typeof pattern !== "string"))
    throw new Error("Exclusions must be a list of glob patterns.");
  if (value.length > desktopExclusionLimits.patterns)
    throw new Error(`Use at most ${desktopExclusionLimits.patterns} exclusion patterns.`);
  for (const pattern of value) {
    if (pattern.length > desktopExclusionLimits.length)
      throw new Error(`Each exclusion pattern must be at most ${desktopExclusionLimits.length} characters.`);
    if (/[\0\r\n]/.test(pattern))
      throw new Error("Each exclusion pattern must be a single line without null characters.");
  }
  const patterns = splitIgnoreRules(value);
  if (patterns.length > desktopExclusionLimits.patterns)
    throw new Error(`Use at most ${desktopExclusionLimits.patterns} exclusion patterns.`);
  createIgnoreMatcher(patterns);
  return patterns;
}
