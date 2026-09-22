import { useRef, useState } from "react";
import { messageForDisplay, urlPathForDisplay } from "@visuales/core/uri-display";
import { invoke } from "@tauri-apps/api/core";
import { Pause, Play, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { isDesktop } from "./use-transfers";
import { searchIndexLabel } from "@visuales/core/search-index-types";
import type { SearchIndexController } from "./use-search-index";

export function SearchCacheSettings({ indexing }: { indexing: SearchIndexController }) {
  const { status, control } = indexing;
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
      <h3 id="settings-search-heading" tabIndex={-1}>
        Search
      </h3>
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
              {messageForDisplay(error)}
            </span>
          )}
        </div>
      </div>
      <div className="settings-file-index">
        <div className="settings-label">File index</div>
        <div className="settings-cache-status" role="status">
          {status ? searchIndexLabel(status) : "File index unavailable"}
        </div>
        {status && (
          <>
            {status.total > 0 && (
              <Progress value={(100 * status.completed) / status.total} aria-label="File indexing progress" />
            )}
            <div className="settings-cache-status">
              {status.files.toLocaleString()} files · {status.completed.toLocaleString()} /{" "}
              {status.total.toLocaleString()} folders
              {status.failed > 0 ? ` · ${status.failed} failed` : ""}
              {status.skipped > 0 ? ` · ${status.skipped} skipped (unavailable or excluded)` : ""}
            </div>
            {status.lastUpdated && (
              <div className="settings-cache-status">Last scan: {new Date(status.lastUpdated).toLocaleString()}</div>
            )}
            {status.retryAt && status.phase !== "paused" && (
              <div className="settings-cache-status">Next retry: {new Date(status.retryAt).toLocaleString()}</div>
            )}
            {!!status.deferred && (
              <div className="settings-cache-status">
                {status.deferred} {status.deferred === 1 ? "folder deferred" : "folders deferred"} until the next scan
              </div>
            )}
            {status.current && (
              <div className="settings-cache-status index-current">{urlPathForDisplay(status.current)}</div>
            )}
            {status.error && (
              <div className="settings-field-error" role="alert">
                {messageForDisplay(status.error)}
              </div>
            )}
          </>
        )}
        <div className="index-controls">
          {status && ["offline", "partial"].includes(status.phase) && (
            <Button type="button" variant="outline" disabled={indexing.busy} onClick={() => void control("resume")}>
              <RefreshCw size={15} />
              Retry indexing
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={!status || indexing.busy}
            onClick={() => void control(status?.phase === "paused" ? "resume" : "pause")}
          >
            {status?.phase === "paused" ? <Play size={15} /> : <Pause size={15} />}
            {status?.phase === "paused" ? "Resume indexing" : "Pause indexing"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!status || indexing.busy}
            onClick={() => void control("refresh")}
          >
            <RefreshCw size={15} />
            Refresh file index
          </Button>
        </div>
        {indexing.error && (
          <div className="settings-field-error" role="alert">
            {messageForDisplay(indexing.error)}
          </div>
        )}
      </div>
    </section>
  );
}
