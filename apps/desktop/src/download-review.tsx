import { useEffect, useMemo, useRef, useState } from "react";
import { messageForDisplay } from "@visuales/core/uri-display";
import { invoke } from "@tauri-apps/api/core";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Download, File, Folder, ListPlus, RefreshCw, X } from "lucide-react";
import type { DownloadReview as Review, DownloadReviewEntry } from "@visuales/core/download/review";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { IconButton } from "./icon-button";
import { formatBytes } from "./task-view";

function ReviewFiles({ entries }: { entries: DownloadReviewEntry[] }) {
  const scroll = useRef<HTMLDivElement>(null);
  const list = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => 48,
    getItemKey: (index) => `${entries[index].url}\n${entries[index].path}`,
    overscan: 5,
  });
  return (
    <div ref={scroll} className="review-files" tabIndex={0} aria-label="Reviewed files">
      {!entries.length && <p className="review-notice">No items</p>}
      <ul style={{ height: list.getTotalSize(), position: "relative" }}>
        {list.getVirtualItems().map((item) => {
          const entry = entries[item.index];
          return (
            <li
              key={item.key}
              ref={list.measureElement}
              data-index={item.index}
              style={{ position: "absolute", width: "100%", transform: `translateY(${item.start}px)` }}
            >
              {entry.kind === "directory" ? <Folder size={16} /> : <File size={16} />}
              <span className="review-file-path">{entry.path}</span>
              <span className="secondary">
                {entry.kind === "directory"
                  ? "Entire subtree"
                  : entry.bytes === null
                    ? "Unknown size"
                    : `${entry.estimated ? "~" : ""}${formatBytes(entry.bytes)}`}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function DownloadReview({
  urls,
  output,
  blocked,
  onClose,
  onStarted,
}: {
  urls: string[];
  output?: string;
  blocked: boolean;
  onClose: () => void;
  onStarted: (queue: boolean) => void;
}) {
  const [review, setReview] = useState<(Review & { reviewId: string }) | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [tab, setTab] = useState("included");
  const [submitting, setSubmitting] = useState<"download" | "queue" | null>(null);
  const busy = useRef(false);
  useEffect(() => {
    let stopped = false;
    setReview(null);
    setError("");
    void invoke<Review & { reviewId: string }>("review_download", { urls, output }).then(
      (data) => {
        if (!stopped) setReview(data);
      },
      (reason) => {
        if (!stopped) setError(String(reason));
      }
    );
    return () => {
      stopped = true;
    };
  }, [urls, output, attempt]);
  const entries = useMemo(
    () => review?.entries.filter((entry) => entry.ignored === (tab === "ignored")) ?? [],
    [review, tab]
  );
  async function start(queue: boolean) {
    if (!review || busy.current || blocked) return;
    busy.current = true;
    setSubmitting(queue ? "queue" : "download");
    setError("");
    try {
      await invoke("start_download", { urls, queue, reviewId: review.reviewId });
      onStarted(queue);
    } catch (reason) {
      setError(String(reason));
    } finally {
      busy.current = false;
      setSubmitting(null);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy.current) onClose();
      }}
    >
      <DialogContent className="download-review">
        <header className="review-heading">
          <DialogTitle>Review download</DialogTitle>
          <IconButton
            label="Refresh download review"
            disabled={!!submitting}
            onClick={() => setAttempt((value) => value + 1)}
          >
            <RefreshCw size={16} />
          </IconButton>
          <IconButton label="Close download review" disabled={!!submitting} onClick={onClose}>
            <X size={16} />
          </IconButton>
        </header>
        <DialogDescription className="review-output">
          {review?.output ?? output ?? "Default download folder"}
        </DialogDescription>
        {error && (
          <p role="alert" className="review-notice task-error">
            {messageForDisplay(error)}
          </p>
        )}
        {!review && !error && (
          <div role="status" className="review-notice">
            <Spinner size={16} /> Reviewing files...
          </div>
        )}
        {review && (
          <>
            <section className="review-summary" aria-label="Download size and disk space">
              <div>
                <span className="secondary">Full download</span>
                <strong>
                  {review.estimated ? "~" : ""}
                  {formatBytes(review.knownBytes)}
                  {review.unknownFiles > 0
                    ? ` + ${review.unknownFiles} unknown ${review.unknownFiles === 1 ? "size" : "sizes"}`
                    : ""}
                </strong>
              </div>
              <div>
                <span className="secondary">Available space</span>
                <strong>{review.availableBytes === null ? "Unavailable" : formatBytes(review.availableBytes)}</strong>
              </div>
            </section>
            {review.spaceWarning && (
              <p role="alert" className="review-notice task-error">
                The full download exceeds available space. Existing files may reduce the space needed.
              </p>
            )}
            {!review.spaceWarning && (review.unknownFiles > 0 || review.estimated) && (
              <p className="review-notice secondary">
                Disk space cannot be confirmed from {review.unknownFiles ? "unknown" : "approximate"} file sizes.
              </p>
            )}
            <Tabs value={tab} onValueChange={(value) => setTab(String(value))} className="review-tabs">
              <TabsList variant="line" aria-label="Review files">
                <TabsTrigger value="included">Included {review.includedFiles}</TabsTrigger>
                <TabsTrigger value="ignored">Ignored {review.ignoredFiles + review.ignoredDirectories}</TabsTrigger>
              </TabsList>
              <TabsContent value={tab} className="review-panel">
                <ReviewFiles key={tab} entries={entries} />
              </TabsContent>
            </Tabs>
          </>
        )}
        <footer className="review-footer">
          <Button variant="outline" disabled={!!submitting} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="outline"
            disabled={!review?.includedFiles || !!submitting || blocked}
            onClick={() => void start(true)}
          >
            {submitting === "queue" ? <Spinner size={16} /> : <ListPlus size={16} />} Queue
          </Button>
          <Button disabled={!review?.includedFiles || !!submitting || blocked} onClick={() => void start(false)}>
            {submitting === "download" ? <Spinner size={16} /> : <Download size={16} />} Download
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
