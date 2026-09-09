export interface DesktopSettings {
  output: string;
  concurrent: number;
  connections: number;
  maxRetries: number;
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
import { MAX_CONNECTIONS_PER_FILE } from "./download/limits.js";
