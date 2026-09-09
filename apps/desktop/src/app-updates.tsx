import { Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatBytes } from "./task-view";
import { isDesktop } from "./use-transfers";
import type { AppUpdates } from "./use-app-updates";

export function AppUpdatesPanel({ updates, activeTransfers }: { updates: AppUpdates; activeTransfers: boolean }) {
  if (!updates.noticeVisible) return null;
  const { phase, progress, version } = updates;
  const percent = progress.total ? Math.min(100, Math.round((progress.received / progress.total) * 100)) : null;
  const message = {
    idle: "",
    checking: "",
    current: "",
    available: `Visuales ${version} is available.`,
    downloading: `Downloading update${percent === null ? "" : `: ${percent}%`}${progress.received ? ` (${formatBytes(progress.received)})` : ""}`,
    downloaded: activeTransfers
      ? "Update ready. Finish or cancel running and queued transfers before restarting."
      : `Visuales ${version} is ready. Restart to update.`,
    restarting: "Updating and restarting Visuales...",
    ready: `Visuales ${version} is installed. Restart to finish updating.`,
  }[phase];
  return (
    <section id="app-updates" className="app-updates" aria-label="App update">
      <div className="app-update-copy">
        <span role="status">{message}</span>
        {phase === "downloading" && <Progress value={percent} aria-label="App update download" />}
        {updates.error && (
          <span className="app-update-error" role="alert">
            {updates.error}
          </span>
        )}
      </div>
      <div className="app-update-actions">
        {phase === "available" && (
          <>
            {!updates.error && (
              <Button type="button" variant="ghost" onClick={updates.dismiss}>
                Later
              </Button>
            )}
            <Button type="button" onClick={() => void updates.download()}>
              <Download size={15} /> Download update
            </Button>
          </>
        )}
        {["downloaded", "ready", "restarting"].includes(phase) && (
          <Button
            type="button"
            disabled={phase === "restarting" || (phase === "downloaded" && activeTransfers)}
            onClick={() => void updates.restart()}
          >
            <RefreshCw size={15} className={phase === "restarting" ? "spin" : ""} />
            {phase === "restarting" ? "Restarting..." : "Restart to update"}
          </Button>
        )}
      </div>
    </section>
  );
}

export function AppUpdatesSettings({ updates }: { updates: AppUpdates }) {
  const { info, phase, lastChecked } = updates;
  const checkable = ["idle", "current", "checking"].includes(phase);
  const deferred = phase === "available" && !updates.noticeVisible;
  const status = !isDesktop()
    ? "Updates are available in the desktop app."
    : info?.reason ||
      (phase === "checking"
        ? "Checking for updates..."
        : phase === "current"
          ? "You're up to date."
          : deferred
            ? `Visuales ${updates.version} is available.`
            : phase === "idle"
              ? updates.error
                ? "Could not check for updates."
                : "Updates have not been checked."
              : null);
  return (
    <section className="settings-section settings-updates" aria-labelledby="settings-updates-heading">
      <h3 id="settings-updates-heading">App updates</h3>
      <div className="settings-update-row">
        <div className="app-update-copy">
          <span>Installed version{info ? `: ${info.currentVersion}` : ": unavailable"}</span>
          {status && (
            <span className="secondary" role="status">
              {status}
            </span>
          )}
          {lastChecked && (
            <span className="secondary">
              Last checked{" "}
              <time dateTime={new Date(lastChecked).toISOString()}>{new Date(lastChecked).toLocaleString()}</time>
            </span>
          )}
          {updates.error && !updates.noticeVisible && (
            <span className="app-update-error" role="alert">
              {updates.error}
            </span>
          )}
        </div>
        {checkable && (
          <Button
            type="button"
            variant="outline"
            disabled={!isDesktop() || phase === "checking" || info?.supported === false}
            onClick={() => void updates.check()}
          >
            <RefreshCw size={15} className={phase === "checking" ? "spin" : ""} /> Check for updates
          </Button>
        )}
        {deferred && (
          <Button type="button" onClick={() => void updates.download()}>
            <Download size={15} /> Download update
          </Button>
        )}
      </div>
    </section>
  );
}
