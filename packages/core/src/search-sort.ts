export const searchSortOptions = [
  { value: "name-asc", label: "Name A-Z" },
  { value: "name-desc", label: "Name Z-A" },
  { value: "modified-desc", label: "Modified: newest first" },
  { value: "modified-asc", label: "Modified: oldest first" },
] as const;

export type SearchSort = (typeof searchSortOptions)[number]["value"];
export const defaultSearchSort: SearchSort = "name-asc";
export function isSearchSort(value: unknown): value is SearchSort {
  return searchSortOptions.some((option) => option.value === value);
}
