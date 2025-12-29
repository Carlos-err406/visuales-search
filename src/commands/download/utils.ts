export function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !isFinite(seconds)) return "--:--:--";
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return [hrs, mins, secs].map((v) => v.toString().padStart(2, "0")).join(":");
}

export function parseSize(sizeStr: string | undefined): number | undefined {
  if (!sizeStr || sizeStr === "-") return undefined;
  const units: { [key: string]: number } = {
    B: 1,
    K: 1024,
    M: 1024 * 1024,
    G: 1024 * 1024 * 1024,
    T: 1024 * 1024 * 1024 * 1024,
  };
  const match = sizeStr.match(/^([\d.]+)\s*([BKMGTP]?)/i);
  if (!match) return undefined;
  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase() || "B";
  return Math.floor(value * (units[unit] || 1));
}
