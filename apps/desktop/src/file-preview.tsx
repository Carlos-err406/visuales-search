import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RefreshCw, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { IconButton } from "./icon-button";
import { formatBytes } from "./task-view";
import type { FilePreview as Preview } from "@visuales/core/library-types";

export function FilePreview({ file, onClose }: { file: { url: string; name: string }; onClose: () => void }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const returnFocus = useRef(document.activeElement as HTMLElement | null);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setPreview(null);
    setError("");
    void invoke<Preview>("preview_library_file", { url: file.url, refresh: revision > 0 })
      .then(
        (value) => {
          if (active) setPreview(value);
        },
        (reason) => {
          if (active) setError(String(reason));
        }
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [file.url, revision]);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="file-preview" finalFocus={returnFocus}>
        <header className="preview-heading">
          <div className="file-copy">
            <DialogTitle className="file-title">{file.name}</DialogTitle>
            <DialogDescription className="secondary truncate">{file.url}</DialogDescription>
          </div>
          <IconButton
            label="Refresh preview"
            disabled={loading}
            onClick={() => setRevision((value) => value + 1)}
            description="Fetch a fresh copy and replace the cached preview."
          >
            <RefreshCw size={16} />
          </IconButton>
          <IconButton label="Close preview" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </header>
        <div className="preview-body" aria-busy={loading}>
          {loading && (
            <span role="status">
              <Spinner /> Loading preview
            </span>
          )}
          {error && <p role="alert">{error}</p>}
          {!error && preview?.kind === "image" && (
            <img
              src={`data:${preview.mime};base64,${preview.content}`}
              alt={file.name}
              onError={() => setError("This image could not be decoded. Try refreshing the preview.")}
            />
          )}
          {!error && preview?.kind === "text" && <pre tabIndex={0}>{preview.content || "(Empty file)"}</pre>}
        </div>
        {preview && (
          <footer className="preview-footer secondary">
            {formatBytes(preview.bytes)} · {preview.cached ? "Cached" : "Fetched"} ·{" "}
            {new Date(preview.fetchedAt).toLocaleString()}
          </footer>
        )}
      </DialogContent>
    </Dialog>
  );
}
