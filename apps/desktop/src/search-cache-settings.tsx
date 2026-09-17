import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { isDesktop } from "./use-transfers";

export function SearchCacheSettings() {
  const busy = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const [updated, setUpdated] = useState(false);
  const [error, setError] = useState("");

  async function revalidate() {
    if (!isDesktop() || busy.current) return;
    busy.current = true;
    setRefreshing(true);
    setUpdated(false);
    setError("");
    try {
      await invoke("search_content", { terms: [], noCache: true });
      setUpdated(true);
    } catch (reason) {
      setError(String(reason));
    } finally {
      busy.current = false;
      setRefreshing(false);
    }
  }

  return (
    <section className="settings-section settings-search-cache" aria-labelledby="settings-search-heading">
      <h3 id="settings-search-heading">Search</h3>
      <div className="settings-row">
        <span className="settings-label">Search index</span>
        <div className="settings-control">
          <Button
            type="button"
            variant="outline"
            disabled={!isDesktop() || refreshing}
            onClick={() => void revalidate()}
          >
            {refreshing ? <Spinner /> : <RefreshCw size={15} />}
            {refreshing ? "Revalidating..." : "Revalidate cache"}
          </Button>
          <span className="settings-cache-status" role="status">
            {refreshing ? "Fetching search index..." : updated ? "Search index updated." : ""}
          </span>
          {error && (
            <span className="settings-field-error" role="alert">
              {error}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
