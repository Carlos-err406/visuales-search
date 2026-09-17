import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { messageForDisplay, urlPathForDisplay } from "@visuales/core/uri-display";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowLeft,
  ArrowRight,
  Download,
  ListPlus,
  Maximize,
  RefreshCw,
  Scan,
  Search,
  WrapText,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { TransformWrapper, TransformComponent, type ReactZoomPanPinchRef } from "react-zoom-pan-pinch";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { IconButton } from "./icon-button";
import { formatBytes } from "./task-view";
import { previewKind, type FilePreview as Preview, type LibraryEntry } from "@visuales/core/library-types";
import type { LibraryResource } from "./library-window";
import { useLibraryTransfer } from "./use-library-transfer";

function ImagePreview({ preview, name }: { preview: Preview; name: string }) {
  const controls = useRef<ReactZoomPanPinchRef>(null);
  const area = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const [scale, setScale] = useState(1);
  const [fit, setFit] = useState(true);
  const [decoded, setDecoded] = useState(false);
  const [error, setError] = useState(false);
  function fitImage() {
    if (!area.current || !image.current?.naturalWidth) return;
    const bounds = area.current.getBoundingClientRect();
    const target = Math.min(
      1,
      (bounds.width - 24) / image.current.naturalWidth,
      (bounds.height - 24) / image.current.naturalHeight
    );
    controls.current?.centerView(Math.max(0.01, target), 0);
  }
  useEffect(() => {
    if (!area.current || !decoded || !fit) return;
    const observer = new ResizeObserver(fitImage);
    observer.observe(area.current);
    fitImage();
    return () => observer.disconnect();
  }, [decoded, fit]);
  return (
    <div className="image-preview">
      <div className="aux-toolbar image-tools">
        <IconButton
          label="Zoom out"
          disabled={!decoded}
          onClick={() => {
            setFit(false);
            controls.current?.zoomOut();
          }}
        >
          <ZoomOut size={16} />
        </IconButton>
        <span className="zoom-value">{Math.round(scale * 100)}%</span>
        <IconButton
          label="Zoom in"
          disabled={!decoded}
          onClick={() => {
            setFit(false);
            controls.current?.zoomIn();
          }}
        >
          <ZoomIn size={16} />
        </IconButton>
        <IconButton
          label="Fit to window"
          disabled={!decoded}
          aria-pressed={fit}
          onClick={() => {
            setFit(true);
            fitImage();
          }}
        >
          <Maximize size={16} />
        </IconButton>
        <IconButton
          label="Actual size"
          disabled={!decoded}
          onClick={() => {
            setFit(false);
            controls.current?.centerView(1, 0);
          }}
        >
          <Scan size={16} />
        </IconButton>
      </div>
      <div className="image-canvas" ref={area}>
        {error && <p role="alert">This image could not be decoded.</p>}
        <TransformWrapper
          ref={controls}
          minScale={0.01}
          maxScale={16}
          centerOnInit
          onTransform={(_, state) => setScale(state.scale)}
          onZoomStart={() => setFit(false)}
          onPanningStart={() => setFit(false)}
        >
          <TransformComponent wrapperStyle={{ width: "100%", height: "100%" }}>
            <img
              ref={image}
              draggable={false}
              src={`data:${preview.mime};base64,${preview.content}`}
              alt={name}
              onLoad={() => setDecoded(true)}
              onError={() => setError(true)}
            />
          </TransformComponent>
        </TransformWrapper>
      </div>
    </div>
  );
}

function TextPreview({ content }: { content: string }) {
  const [term, setTerm] = useState("");
  const [wrap, setWrap] = useState(true);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const text = useRef<HTMLPreElement>(null);
  const matches = useMemo(() => {
    if (!term) return [];
    const expression = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
    const matches: { index: number; length: number }[] = [];
    for (const match of content.matchAll(expression)) {
      matches.push({ index: match.index, length: match[0].length });
      if (matches.length === 1000) break;
    }
    return matches;
  }, [content, term]);
  useEffect(() => {
    text.current?.querySelector('[data-current="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active, matches]);
  return (
    <section
      className="text-preview"
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
          event.preventDefault();
          input.current?.focus();
          input.current?.select();
        }
      }}
    >
      <div className="aux-toolbar">
        <Search size={16} aria-hidden="true" />
        <Input
          ref={input}
          aria-label="Find in preview"
          placeholder="Find in preview"
          value={term}
          onChange={(event) => {
            setTerm(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && matches.length) {
              event.preventDefault();
              setActive((current) => (current + (event.shiftKey ? -1 : 1) + matches.length) % matches.length);
            }
            if (event.key === "Escape") {
              event.stopPropagation();
              setTerm("");
              text.current?.focus();
            }
          }}
        />
        <span className="secondary find-count">
          {term ? `${matches.length ? active + 1 : 0} / ${matches.length}${matches.length === 1000 ? "+" : ""}` : ""}
        </span>
        <IconButton
          label="Previous match"
          disabled={!matches.length}
          onClick={() => setActive((value) => (value - 1 + matches.length) % matches.length)}
        >
          <ArrowLeft size={16} />
        </IconButton>
        <IconButton
          label="Next match"
          disabled={!matches.length}
          onClick={() => setActive((value) => (value + 1) % matches.length)}
        >
          <ArrowRight size={16} />
        </IconButton>
        <IconButton label="Word wrap" aria-pressed={wrap} onClick={() => setWrap(!wrap)}>
          <WrapText size={16} />
        </IconButton>
      </div>
      <pre ref={text} tabIndex={0} className={wrap ? "wrap" : ""}>
        {matches.map((match, index) => (
          <Fragment key={match.index}>
            {content.slice(index ? matches[index - 1].index + matches[index - 1].length : 0, match.index)}
            <mark data-current={index === active}>{content.slice(match.index, match.index + match.length)}</mark>
          </Fragment>
        ))}
        {content.slice(matches.length ? matches.at(-1)!.index + matches.at(-1)!.length : 0) ||
          (!content ? "(Empty file)" : "")}
      </pre>
    </section>
  );
}

export function FilePreview({ file }: { file: LibraryResource }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState("waiting");
  const [revision, setRevision] = useState(0);
  const [siblings, setSiblings] = useState<LibraryEntry[]>([]);
  const [navigating, setNavigating] = useState(false);
  const transfer = useLibraryTransfer();
  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    setLoading(true);
    setPhase("waiting");
    setError("");
    const poll = async () => {
      try {
        const value = await invoke<string>("library_preview_status", { url: file.url });
        if (active && value !== "idle") setPhase(value);
      } catch {
        /* The preview request reports errors. */
      }
      if (active) timer = window.setTimeout(() => void poll(), 500);
    };
    void (async () => {
      try {
        const cached = await invoke<Preview | null>("cached_library_preview", { url: file.url });
        if (!active) return;
        if (cached) setPreview(cached);
        void poll();
        const result = await invoke<Preview>("preview_library_file", {
          url: file.url,
          refresh: file.revision > 0 || revision > 0,
        });
        if (active) setPreview(result);
      } catch (reason) {
        if (active) setError(String(reason));
      } finally {
        if (active) {
          setLoading(false);
          active = false;
          clearTimeout(timer);
        }
      }
    })();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [file.url, file.revision, revision]);
  useEffect(() => {
    if (previewKind(file.url) !== "image") return;
    let active = true;
    void invoke<LibraryEntry[]>("list_library_directory", { url: new URL(".", file.url).href, refresh: false })
      .then((entries) => {
        if (active)
          setSiblings(
            entries
              .filter((entry) => previewKind(entry.encodedUrl) === "image")
              .sort((a, b) => a.text.localeCompare(b.text, undefined, { numeric: true }))
          );
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [file.url]);
  const position = siblings.findIndex((entry) => entry.encodedUrl === file.url);
  async function navigate(offset: number) {
    const next = siblings[position + offset];
    if (!next || navigating) return;
    setNavigating(true);
    try {
      await invoke("navigate_preview", { url: next.encodedUrl });
    } catch (reason) {
      setError(String(reason));
    } finally {
      setNavigating(false);
    }
  }
  function action(command: string) {
    void invoke(command, { url: file.url }).catch((reason) => setError(String(reason)));
  }
  return (
    <main className="auxiliary-window" aria-label="File preview">
      <header className="aux-heading">
        <div className="file-copy">
          <h1>{file.name}</h1>
          <p className="secondary truncate">{urlPathForDisplay(file.url)}</p>
        </div>
        <IconButton label="Show in Search" onClick={() => action("show_in_search")}>
          <Search size={16} />
        </IconButton>
        <IconButton label="Close preview" onClick={() => action("close_library_window")}>
          <X size={18} />
        </IconButton>
      </header>
      <div className="aux-toolbar">
        {previewKind(file.url) === "image" && (
          <>
            <IconButton label="Previous image" disabled={navigating || position <= 0} onClick={() => void navigate(-1)}>
              <ArrowLeft size={16} />
            </IconButton>
            <IconButton
              label="Next image"
              disabled={navigating || position < 0 || position >= siblings.length - 1}
              onClick={() => void navigate(1)}
            >
              <ArrowRight size={16} />
            </IconButton>
          </>
        )}
        <span role="status" className="aux-status secondary">
          {loading ? (
            <>
              <Spinner size={14} />
              {phase === "loading" ? "Loading preview" : "Waiting for preview"}
            </>
          ) : error ? (
            "Preview failed"
          ) : (
            ""
          )}
        </span>
        <IconButton label="Refresh preview" disabled={loading} onClick={() => setRevision((value) => value + 1)}>
          <RefreshCw size={16} />
        </IconButton>
        <IconButton
          label="Add to queue"
          disabled={!!transfer.submitting}
          description={`Save to ${transfer.output}`}
          onClick={() => void transfer.start(file.url, true)}
        >
          <ListPlus size={16} />
        </IconButton>
        <IconButton
          label="Download now"
          disabled={!!transfer.submitting}
          description={`Save to ${transfer.output}`}
          onClick={() => void transfer.start(file.url, false)}
        >
          <Download size={16} />
        </IconButton>
      </div>
      {(error || transfer.error) && (
        <p role="alert" className="aux-error">
          {messageForDisplay(error || transfer.error)}
        </p>
      )}
      {transfer.message && (
        <p role="status" className="aux-message">
          {transfer.message}
        </p>
      )}
      <div className="detached-preview-body" aria-busy={loading}>
        {preview?.kind === "image" && <ImagePreview key={preview.fetchedAt} preview={preview} name={file.name} />}
        {preview?.kind === "text" && <TextPreview content={preview.content} />}
      </div>
      <footer className="aux-footer secondary">
        {preview
          ? `${formatBytes(preview.bytes)} · ${preview.cached ? "Cached" : "Fetched"} · ${new Date(preview.fetchedAt).toLocaleString()}`
          : ""}
      </footer>
    </main>
  );
}
