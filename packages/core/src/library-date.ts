import type { LibraryEntry } from "./library-types.js";

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Preserve Apache's server-local minute; UTC is used only to validate calendar components.
export function parseLibraryDate(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  const modern = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(value.trim());
  const legacy = /^(\d{2})-([A-Z][a-z]{2})-(\d{4}) (\d{2}):(\d{2})$/.exec(value.trim());
  if (!modern && !legacy) return;
  const [year, month, day, hour, minute] = modern
    ? modern.slice(1).map(Number)
    : [Number(legacy![3]), months.indexOf(legacy![2]) + 1, Number(legacy![1]), Number(legacy![4]), Number(legacy![5])];
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, 0, 0);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute
  )
    return;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function mergeLibraryEntry(previous: LibraryEntry | undefined, incoming: LibraryEntry): LibraryEntry {
  if (!previous) return incoming;
  const checked = (entry: LibraryEntry) =>
    Number.isFinite(entry.modifiedCheckedAt) && entry.modifiedCheckedAt! >= 0 ? entry.modifiedCheckedAt! : -1;
  const metadata = checked(previous) > checked(incoming) ? previous : incoming;
  return {
    ...incoming,
    size: incoming.size ?? previous.size,
    modifiedLocal: metadata.modifiedLocal,
    modifiedCheckedAt: metadata.modifiedCheckedAt,
  };
}
