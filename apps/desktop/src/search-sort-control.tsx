import { useEffect, useState } from "react";
import { ArrowDownWideNarrow, RefreshCw } from "lucide-react";
import { defaultSearchSort, isSearchSort, searchSortOptions, type SearchSort } from "@visuales/core/search-sort";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { IconButton } from "./icon-button";

const key = "visuales.search-sort";
function readSort(): SearchSort {
  try {
    const value = localStorage.getItem(key);
    return isSearchSort(value) ? value : defaultSearchSort;
  } catch {
    return defaultSearchSort;
  }
}

export function useSearchSort() {
  const [sort, setSort] = useState(readSort);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === key || event.key === null) setSort(readSort());
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  function changeSort(value: SearchSort) {
    setSort(value);
    try {
      localStorage.setItem(key, value);
    } catch {
      // Sorting remains available when preferences cannot be persisted.
    }
  }
  return { sort, changeSort };
}

export function SearchSortControl({
  sort,
  onChange,
  dates,
}: {
  sort: SearchSort;
  onChange: (sort: SearchSort) => void;
  dates: { loading: boolean; error?: string; retry: () => void };
}) {
  return (
    <div className="search-sort-tools">
      {dates.loading && (
        <span className="search-sort-status" role="status">
          <Spinner />
          Loading dates
        </span>
      )}
      {dates.error && (
        <IconButton label="Retry loading dates" description={dates.error} onClick={dates.retry}>
          <RefreshCw size={14} />
        </IconButton>
      )}
      <Select value={sort} onValueChange={(value) => isSearchSort(value) && onChange(value)} items={searchSortOptions}>
        <SelectTrigger className="search-sort" size="sm" aria-label="Sort search results">
          <ArrowDownWideNarrow size={14} aria-hidden="true" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end" alignItemWithTrigger={false}>
          {searchSortOptions.map(({ value, label }) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
