import { ArrowUpCircle, Check, Download, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { IconButton } from "./icon-button";
import { formatBytes } from "./task-view";
import type { AppUpdates } from "./use-app-updates";

export function AppUpdatesButton({ updates }: { updates: AppUpdates }) {
  return (
    <IconButton
      label="App updates"
      className={`app-updates-button ${updates.version ? "update-available" : ""}`}
      description={
        updates.version ? `Visuales ${updates.version} is available.` : "Check the app version and software updates."
      }
      aria-expanded={updates.expanded}
      aria-controls="app-updates"
      onClick={() => updates.setExpanded(!updates.expanded)}
    >
      <ArrowUpCircle size={17} />
    </IconButton>
  );
}

export function AppUpdatesPanel({ updates, activeTransfers }: { updates: AppUpdates; activeTransfers: boolean }) {
  if (!updates.expanded) return null;
  const { phase, info, progress, version } = updates;
  const percent = progress.total ? Math.min(100, Math.round((progress.received / progress.total) * 100)) : null;
  const message = {
    idle: info?.reason || "Check for app updates.",
    checking: "Checking for updates...",
    current: "You're up to date.",
    available: `Visuales ${version} is available.`,
    downloading: `Downloading update${percent === null ? "" : `: ${percent}%`}${progress.received ? ` (${formatBytes(progress.received)})` : ""}`,
    downloaded: activeTransfers
      ? "Update verified. Finish or cancel running and queued transfers before installing."
      : `Visuales ${version} is ready to install. The app will need to restart.`,
    installing: "Installing update. The app may close and restart...",
    ready: `Visuales ${version} installed. Restart to finish.`,
  }[phase];
  return (
    <section id="app-updates" className="app-updates" aria-label="App updates">
      <div className="app-update-copy">
        <span className="secondary">Visuales {info?.currentVersion || ""}</span>
        <span role="status">{message}</span>
        {phase === "downloading" && <Progress value={percent} aria-label="App update download" />}
        {updates.error && (
          <span className="app-update-error" role="alert">
            {updates.error}
          </span>
        )}
      </div>
      <div className="app-update-actions">
        {["idle", "current", "checking"].includes(phase) && (
          <Button
            variant="outline"
            disabled={phase === "checking" || info?.supported === false}
            onClick={() => void updates.check()}
          >
            <RefreshCw size={15} className={phase === "checking" ? "spin" : ""} /> Check for updates
          </Button>
        )}
        {phase === "available" && (
          <Button onClick={() => void updates.download()}>
            <Download size={15} /> Download update
          </Button>
        )}
        {phase === "downloaded" && (
          <Button disabled={activeTransfers} onClick={() => void updates.install()}>
            <Check size={15} /> Install update
          </Button>
        )}
        {phase === "ready" && (
          <Button onClick={() => void updates.restart()}>
            <RefreshCw size={15} /> Restart app
          </Button>
        )}
        <IconButton
          label="Dismiss app updates"
          description="Hide this notice. Updates remain available from the header."
          onClick={() => updates.setExpanded(false)}
        >
          <X size={15} />
        </IconButton>
      </div>
    </section>
  );
}
