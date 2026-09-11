import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import lockfile from "proper-lockfile";
import { CONFIG } from "./lib/types.js";
import { downloadDefaults } from "./download/defaults.js";
import {
  desktopSettingsLimits,
  normalizeDesktopExclusions,
  type DesktopSettings,
  type DesktopSettingsSnapshot,
} from "./desktop-settings-types.js";

export function resolveDesktopOutput(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.includes("\0"))
    throw new Error("Output folder must be a nonempty absolute path");
  let output = value.trim();
  if (output === "~") output = os.homedir();
  else if (output.startsWith("~/") || output.startsWith("~\\")) output = path.join(os.homedir(), output.slice(2));
  if (!path.isAbsolute(output)) throw new Error("Output folder must be an absolute path");
  return path.normalize(output);
}

export function validateDesktopSettings(value: unknown): DesktopSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid desktop settings");
  const settings = value as Record<string, unknown>;
  const keys = ["output", "exclude", ...Object.keys(desktopSettingsLimits)];
  if (Object.keys(settings).some((key) => !keys.includes(key))) throw new Error("Unknown desktop setting");
  for (const [key, { min, max }] of Object.entries(desktopSettingsLimits)) {
    const number = settings[key];
    if (typeof number !== "number" || !Number.isInteger(number) || number < min || number > max)
      throw new Error(`${key} must be a whole number between ${min} and ${max}`);
  }
  return {
    output: resolveDesktopOutput(settings.output),
    concurrent: settings.concurrent as number,
    connections: settings.connections as number,
    maxRetries: settings.maxRetries as number,
    exclude: normalizeDesktopExclusions(settings.exclude),
  };
}

function settingsPath() {
  // Deliberately not a cache-index entry: clearing cached downloads must preserve preferences.
  return path.join(CONFIG.CACHE_DIR, "desktop-settings.json");
}

export async function loadDesktopSettings(
  defaultOutput: string = path.join(os.homedir(), "Downloads", "Visuales")
): Promise<DesktopSettingsSnapshot> {
  const defaults = validateDesktopSettings({
    output: defaultOutput,
    concurrent: downloadDefaults.concurrent,
    connections: downloadDefaults.connections,
    maxRetries: downloadDefaults.maxRetries,
    exclude: [],
  });
  let content: string;
  try {
    content = await fs.readFile(settingsPath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { settings: { ...defaults }, defaults };
    throw new Error("Could not read desktop settings", { cause: error });
  }
  try {
    const document = JSON.parse(content);
    if (document.version !== 1) throw new Error("Unsupported settings version");
    return { settings: validateDesktopSettings(document.settings), defaults };
  } catch (error) {
    throw new Error("Saved desktop settings are invalid; the file has not been changed", { cause: error });
  }
}

export async function saveDesktopSettings(value: unknown, defaultOutput?: string): Promise<DesktopSettingsSnapshot> {
  const settings = validateDesktopSettings(value);
  await fs.mkdir(CONFIG.CACHE_DIR, { recursive: true });
  const file = settingsPath();
  const release = await lockfile.lock(file, {
    realpath: false,
    retries: { retries: 30, minTimeout: 50, maxTimeout: 150 },
  });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    // Refuse to overwrite a damaged or newer-format document without an explicit recovery flow.
    const { defaults } = await loadDesktopSettings(defaultOutput);
    await fs.writeFile(temporary, `${JSON.stringify({ version: 1, settings }, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    await fs.rename(temporary, file);
    return { settings, defaults };
  } finally {
    await fs.rm(temporary, { force: true }).finally(release);
  }
}
