import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
  type KeyboardEvent,
} from "react";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { invoke } from "@tauri-apps/api/core";
import { File, FileImage, FileText, Folder, FolderOpen, RefreshCw } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { IconButton } from "./icon-button";
import { FilePreview } from "./file-preview";
import { formatBytes } from "./task-view";
import {
  buildSearchTree,
  canonicalTreeUrl,
  changeTreeSelection,
  type SearchTreeNode,
  type TreeCheckState,
} from "@visuales/core/search-tree";
import { previewKind, type LibraryEntry } from "@visuales/core/library-types";

type Listing = { entries?: LibraryEntry[]; loading?: boolean; error?: string };

export function useSearchBrowser(results: LibraryEntry[], autoExpand = true) {
  const [listings, setListings] = useState<Record<string, Listing>>({});
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const generation = useRef(0);
  const pending = useRef(new Set<string>());
  const entries = useMemo(() => {
    const all = new Map<string, LibraryEntry>();
    function merge(entry: LibraryEntry) {
      const encodedUrl = canonicalTreeUrl(entry.encodedUrl);
      all.set(encodedUrl, { ...entry, encodedUrl, size: entry.size ?? all.get(encodedUrl)?.size });
    }
    Object.values(listings).forEach((listing) => listing.entries?.forEach(merge));
    results.forEach(merge);
    return [...all.values()];
  }, [results, listings]);
  const tree = useMemo(() => buildSearchTree(entries), [entries]);
  const isOpen = (node: SearchTreeNode) =>
    !collapsed.has(node.url) && (opened.has(node.url) || (autoExpand && node.children.length > 0));
  async function load(node: SearchTreeNode, refresh = false) {
    if (pending.current.has(node.url) || (!refresh && listings[node.url]?.entries)) return;
    const version = generation.current;
    pending.current.add(node.url);
    setListings((current) => ({ ...current, [node.url]: { ...current[node.url], loading: true, error: undefined } }));
    try {
      const contents = await invoke<LibraryEntry[]>("list_library_directory", { url: node.url, refresh });
      if (generation.current === version) setListings((current) => ({ ...current, [node.url]: { entries: contents } }));
    } catch (error) {
      if (generation.current === version)
        setListings((current) => ({
          ...current,
          [node.url]: { ...current[node.url], loading: false, error: String(error) },
        }));
    } finally {
      if (generation.current === version) pending.current.delete(node.url);
    }
  }
  function toggle(node: SearchTreeNode) {
    if (isOpen(node)) {
      setCollapsed((current) => new Set(current).add(node.url));
    } else {
      showContents(node);
    }
  }
  function showContents(node: SearchTreeNode, refresh = false) {
    setCollapsed((current) => {
      const next = new Set(current);
      next.delete(node.url);
      return next;
    });
    setOpened((current) => new Set(current).add(node.url));
    void load(node, refresh);
  }
  function reset() {
    generation.current++;
    pending.current.clear();
    setListings({});
    setOpened(new Set());
    setCollapsed(new Set());
  }
  return { tree, entries, listings, isOpen, toggle, load, showContents, reset };
}

export function SearchTree({
  browser,
  selectionStates,
  setSelected,
  disabled,
}: {
  browser: ReturnType<typeof useSearchBrowser>;
  selectionStates: ReadonlyMap<string, TreeCheckState>;
  setSelected: Dispatch<SetStateAction<Set<string>>>;
  disabled: boolean;
}) {
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const anchor = useRef<string | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<string | null>(null);
  const visible: { node: SearchTreeNode; depth: number; pos: number; size: number }[] = [];
  function visit(nodes: SearchTreeNode[], depth: number) {
    nodes.forEach((node, index) => {
      visible.push({ node, depth, pos: index + 1, size: nodes.length });
      if (browser.isOpen(node)) visit(node.children, depth + 1);
    });
  }
  visit(browser.tree, 1);
  const virtual = visible.length > 200;
  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => container.current?.parentElement ?? null,
    initialOffset: () => container.current?.parentElement?.scrollTop ?? 0,
    getItemKey: (index) => visible[index].node.url,
    estimateSize: () => 44,
    overscan: 8,
    enabled: virtual,
    rangeExtractor: (range) => {
      const indices = defaultRangeExtractor(range);
      const focusedIndex = Math.max(
        0,
        visible.findIndex(({ node }) => node.url === focused)
      );
      return indices.includes(focusedIndex) ? indices : [...indices, focusedIndex].sort((a, b) => a - b);
    },
  });
  const rows = virtual
    ? virtualizer.getVirtualItems().map((item) => ({ ...visible[item.index], index: item.index, item }))
    : visible.map((row, index) => ({ ...row, index, item: null }));
  const focusUrl = visible.some(({ node }) => node.url === focused) ? focused : visible[0]?.node.url;
  useLayoutEffect(() => {
    // Selecting near the bottom can reveal the action bar and shrink the viewport.
    const active = document.activeElement;
    if (virtual && active instanceof HTMLElement && container.current?.contains(active)) {
      active.scrollIntoView({ block: "nearest" });
    }
  }, [selectionStates, virtual]);
  useLayoutEffect(() => {
    if (!pendingFocus.current) return;
    const element = [...(container.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])].find(
      (el) => el.dataset.url === pendingFocus.current
    );
    if (element) {
      element.focus({ preventScroll: true });
      pendingFocus.current = null;
    }
  });
  function focus(url: string, preventScroll = false) {
    setFocused(url);
    const element = [...(container.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])].find(
      (el) => el.dataset.url === url
    );
    if (element) element.focus({ preventScroll });
    else if (virtual) {
      pendingFocus.current = url;
      virtualizer.scrollToIndex(
        visible.findIndex(({ node }) => node.url === url),
        { align: "auto" }
      );
    }
  }
  function select(node: SearchTreeNode, checked: boolean, range = false) {
    if (disabled || !node.entry) return;
    const targets = visible.filter(({ node }) => node.entry).map(({ node }) => node.url);
    const start = range && anchor.current ? targets.indexOf(anchor.current) : -1;
    const end = targets.indexOf(node.url);
    const urls = start >= 0 ? targets.slice(Math.min(start, end), Math.max(start, end) + 1) : [node.url];
    setSelected((current) => changeTreeSelection(browser.tree, current, new Set(urls), checked));
    anchor.current = node.url;
  }
  function openPreview(node: SearchTreeNode) {
    if (!disabled && !node.directory && previewKind(node.url)) setPreview({ url: node.url, name: node.name });
  }
  function onKey(event: KeyboardEvent, node: SearchTreeNode, index: number) {
    if (event.target !== event.currentTarget || disabled) return;
    switch (event.key) {
      case "ArrowDown":
        focus(visible[Math.min(index + 1, visible.length - 1)].node.url);
        break;
      case "ArrowUp":
        focus(visible[Math.max(index - 1, 0)].node.url);
        break;
      case "Home":
        focus(visible[0].node.url);
        break;
      case "End":
        focus(visible[visible.length - 1].node.url);
        break;
      case "ArrowRight":
        if (node.directory && !browser.isOpen(node)) browser.toggle(node);
        else if (node.children[0]) focus(node.children[0].url);
        break;
      case "ArrowLeft":
        if (node.directory && browser.isOpen(node)) browser.toggle(node);
        else if (node.parent) focus(node.parent);
        break;
      case " ":
        select(node, selectionStates.get(node.url) !== true, event.shiftKey);
        break;
      case "Enter":
        if (node.directory) browser.toggle(node);
        else openPreview(node);
        break;
      default:
        return;
    }
    event.preventDefault();
  }
  return (
    <>
      <div
        role="tree"
        className="search-tree"
        aria-label="Library files"
        aria-multiselectable="true"
        ref={container}
        style={virtual ? { height: virtualizer.getTotalSize(), position: "relative" } : undefined}
      >
        {rows.map(({ node, depth, pos, size, index, item }) => {
          const listing = browser.listings[node.url];
          const checkState = selectionStates.get(node.url) ?? false;
          const open = node.directory && browser.isOpen(node);
          const kind = node.directory ? null : previewKind(node.url);
          const Symbol = node.directory
            ? open
              ? FolderOpen
              : Folder
            : kind === "image"
              ? FileImage
              : kind === "text"
                ? FileText
                : File;
          const bytes = node.directory ? undefined : node.entry?.size;
          const loadingEmpty = listing?.loading && node.children.length === 0;
          const refreshing = listing?.loading && node.children.length > 0;
          return (
            <div
              key={node.url}
              data-index={index}
              ref={virtual ? virtualizer.measureElement : undefined}
              style={
                item
                  ? { position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${item.start}px)` }
                  : undefined
              }
            >
              <div
                role="treeitem"
                aria-level={depth}
                aria-posinset={pos}
                aria-setsize={size}
                aria-expanded={node.directory ? open : undefined}
                aria-disabled={disabled || undefined}
                aria-busy={listing?.loading || undefined}
                aria-selected={node.entry ? checkState === true : undefined}
                aria-label={node.name}
                data-url={node.url}
                tabIndex={node.url === focusUrl ? 0 : -1}
                className={`tree-row ${node.entry ? "result-row" : "tree-group"} ${node.entry && checkState === true ? "selected" : ""}`}
                onFocus={() => setFocused(node.url)}
                onKeyDown={(event) => onKey(event, node, index)}
                onClick={(event) => {
                  if (disabled || (event.target as HTMLElement).closest('button, input, [role="checkbox"]')) return;
                  focus(node.url, true);
                  if (node.directory) browser.toggle(node);
                  else if (kind) openPreview(node);
                }}
              >
                {node.entry ? (
                  <Checkbox
                    aria-label={`Select ${node.name}`}
                    checked={checkState === true}
                    indeterminate={checkState === "indeterminate"}
                    disabled={disabled}
                    onCheckedChange={(checked, details) =>
                      select(node, checked, "shiftKey" in details.event && Boolean(details.event.shiftKey))
                    }
                  />
                ) : (
                  <span className="tree-selection-space" />
                )}
                <span className="tree-content" style={{ paddingInlineStart: `${Math.min(depth - 1, 8) * 18}px` }}>
                  <Symbol size={18} className="file-symbol" aria-hidden="true" />
                  <span className="file-copy">
                    {kind ? (
                      <button
                        type="button"
                        className="file-title preview-link"
                        disabled={disabled}
                        onClick={() => openPreview(node)}
                      >
                        {node.name}
                      </button>
                    ) : (
                      <span className="file-title">{node.name}</span>
                    )}
                  </span>
                </span>
                <span className="secondary tree-size">{bytes !== undefined ? formatBytes(bytes) : ""}</span>
                {refreshing ? (
                  <Spinner size={14} aria-label="Refreshing folder contents" className="tree-refresh-spinner" />
                ) : node.directory && listing?.entries ? (
                  <IconButton
                    label={`Refresh ${node.name}`}
                    tooltip="Refresh folder"
                    disabled={disabled || listing?.loading}
                    onClick={() => {
                      browser.showContents(node, true);
                    }}
                  >
                    {listing?.loading ? <Spinner size={14} /> : <RefreshCw size={14} />}
                  </IconButton>
                ) : null}
              </div>
              {open &&
                (loadingEmpty || listing?.error || (listing?.entries?.length === 0 && node.children.length === 0)) && (
                  <div
                    className="tree-feedback"
                    style={{ paddingInlineStart: `calc(${48 + Math.min(depth - 1, 8) * 18}px + 2 * var(--tree-gap))` }}
                  >
                    {listing.loading ? (
                      <span role="status">
                        <Spinner size={14} />
                        Loading folder contents
                      </span>
                    ) : listing.error ? (
                      <>
                        <span role="alert">{listing.error}</span>
                        <Button variant="link" disabled={disabled} onClick={() => void browser.load(node, true)}>
                          Retry
                        </Button>
                      </>
                    ) : (
                      <span>Folder is empty</span>
                    )}
                  </div>
                )}
            </div>
          );
        })}
      </div>
      {preview && <FilePreview key={preview.url} file={preview} onClose={() => setPreview(null)} />}
    </>
  );
}
