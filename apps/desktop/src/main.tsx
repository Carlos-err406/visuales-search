import React, { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { messageForDisplay } from "@visuales/core/uri-display";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { TrayPopup } from "./tray-popup";
import { open } from "@tauri-apps/plugin-dialog";
import { IconButton, IconTooltipProvider } from "./icon-button";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupInput, InputGroupAddon } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowUpToLine,
  Check,
  ClipboardList,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Download,
  FolderOutput,
  FolderOpen,
  Info,
  ListPlus,
  Play,
  RefreshCw,
  Search,
  Settings,
  Square,
  Trash2,
  X,
} from "lucide-react";
import type { SearchResult } from "@visuales/core";
import {
  formatBytes,
  isActive,
  taskGroups,
  taskName,
  taskProgress,
  taskProgressLabel,
  taskSize,
  taskSpeed,
  taskSpeedBytes,
  type Task,
} from "./task-view";
import { isDesktop, useTransfers, type TransferCommand } from "./use-transfers";
import { useQueueReorderAnimation } from "./use-queue-reorder-animation";
import { TransferInspector } from "./transfer-inspector";
import { DownloadReview } from "./download-review";
import { InterruptAllButton } from "./interrupt-all-button";
import { hasOpenOverlay } from "./overlay-state";
import "./library-windows.css";
const LibraryWindow = lazy(() => import("./library-window").then((module) => ({ default: module.LibraryWindow })));
import { orderedQueue, compareTransferOrder, type QueueMove } from "@visuales/core/download/queue-order";
import { useAppUpdates } from "./use-app-updates";
import { AppUpdatesPanel } from "./app-updates";
import { useDesktopSettings } from "./use-desktop-settings";
import { useSearchIndex } from "./use-search-index";
import { searchIndexLabel } from "@visuales/core/search-index-types";
import { SettingsView } from "./settings-view";
import { AboutView } from "./about-view";
import { useAppearance } from "./use-appearance";
import { useCollapsedGroups } from "./use-collapsed-groups";
import { SearchTree, useSearchBrowser } from "./search-tree";
import { distinctDownloadUrls, treeSelectionStates } from "@visuales/core/search-tree";
import { appIcon, appIconLabel } from "./app-icon";
import { SearchSortControl, useSearchSort } from "./search-sort-control";

type View = "search" | "downloads" | "settings" | "about";

function TaskRow({
  task,
  pending,
  actionsBlocked,
  error,
  onAction,
  onOpen,
  queuePosition,
  queueTotal,
  inspected,
  onInspect,
}: {
  task: Task;
  pending: boolean;
  actionsBlocked: boolean;
  error?: string;
  onAction: (command: TransferCommand, id: string, position?: QueueMove) => void;
  onOpen: () => void;
  queuePosition: number;
  queueTotal: number;
  inspected: boolean;
  onInspect: () => void;
}) {
  const percent = taskProgress(task);
  const name = taskName(task);
  return (
    <>
      <TableRow
        className={`transfer-row ${task.status}`}
        data-transfer-id={task.id}
        data-transfer-status={task.status}
        data-inspected={inspected || undefined}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("button, a, input, [role=button]")) return;
          onInspect();
        }}
      >
        <TableCell className="transfer-name">
          <div className="file-symbol">
            <ArrowDownToLine size={17} aria-hidden="true" />
          </div>
          <div className="file-copy">
            <Button
              variant="link"
              className="file-title inspect-transfer"
              aria-label={`Details for ${name}`}
              aria-expanded={inspected}
              onClick={onInspect}
            >
              {name}
            </Button>
            <span className="secondary truncate" title={`${task.output} · ${task.id}`}>
              {task.output} <span className="task-id">· {task.id}</span>
            </span>
          </div>
        </TableCell>
        <TableCell className="transfer-progress">
          {task.status === "queued" ? (
            <div className="queue-order">
              <span className="queue-position">
                Queue {queuePosition} of {queueTotal}
              </span>
              <div className="queue-controls" role="group" aria-label={`Queue order for ${name}`}>
                <IconButton
                  label={`Start next: ${name}`}
                  tooltip="Start next"
                  description="Move to the front of the queue. Active downloads are not interrupted."
                  disabled={pending || actionsBlocked || queuePosition <= 1}
                  disabledReason={
                    queuePosition <= 1 ? "Already first in the queue." : "Wait until transfer changes are available."
                  }
                  onClick={() => onAction("move_queued_download", task.id, "next")}
                >
                  <ArrowUpToLine size={15} />
                </IconButton>
                <IconButton
                  label={`Move up: ${name}`}
                  tooltip="Move up in queue"
                  disabled={pending || actionsBlocked || queuePosition <= 1}
                  disabledReason={
                    queuePosition <= 1 ? "Already first in the queue." : "Wait until transfer changes are available."
                  }
                  onClick={() => onAction("move_queued_download", task.id, "up")}
                >
                  <ChevronUp size={15} />
                </IconButton>
                <IconButton
                  label={`Move down: ${name}`}
                  tooltip="Move down in queue"
                  disabled={pending || actionsBlocked || queuePosition >= queueTotal}
                  disabledReason={
                    queuePosition >= queueTotal
                      ? "Already last in the queue."
                      : "Wait until transfer changes are available."
                  }
                  onClick={() => onAction("move_queued_download", task.id, "down")}
                >
                  <ChevronDown size={15} />
                </IconButton>
              </div>
            </div>
          ) : (
            <>
              <div className="progress-label">
                <span>{taskProgressLabel(task)}</span>
                <span className="secondary">{taskSize(task)}</span>
              </div>
              <Progress
                aria-label={`Progress for ${name}`}
                max={100}
                value={percent === null && task.status === "running" ? null : (percent ?? 0)}
              />
            </>
          )}
        </TableCell>
        <TableCell className="transfer-speed">{taskSpeed(task)}</TableCell>
        <TableCell className="transfer-status">
          <Badge variant="outline" className={`status ${task.status}`}>
            {task.status === "completed" && <Check size={12} aria-hidden="true" />}
            {task.status}
          </Badge>
        </TableCell>
        <TableCell className="task-actions" aria-busy={pending}>
          <IconButton
            label={`Open output folder for ${name}`}
            tooltip="Open download folder"
            description="Show this transfer's destination in your file manager."
            onClick={onOpen}
          >
            <FolderOutput size={16} />
          </IconButton>
          {pending ? (
            <span className="action-spinner" role="status" aria-label={`Updating ${name}`}>
              <Spinner size={16} aria-hidden="true" />
            </span>
          ) : (
            <>
              {isActive(task) && (
                <IconButton
                  label={`Cancel ${name}`}
                  disabled={actionsBlocked}
                  disabledReason="Finish the app update before changing transfers."
                  tooltip={task.status === "queued" ? "Cancel queued download" : "Cancel download"}
                  description={
                    task.status === "queued"
                      ? "Stop waiting in the queue. You can resume this task later."
                      : "Stop this transfer. Partial files are kept so you can resume later."
                  }
                  onClick={() => onAction("cancel_download_task", task.id)}
                >
                  <Square size={14} />
                </IconButton>
              )}
              {["interrupted", "failed"].includes(task.status) && (
                <IconButton
                  label={`Add ${name} to queue`}
                  disabled={actionsBlocked}
                  disabledReason="Wait until transfer changes are available."
                  tooltip="Add to queue"
                  description="Resume when this transfer reaches the front of the queue. Its destination, settings, and partial files are kept."
                  onClick={() => onAction("queue_download_task", task.id)}
                >
                  <ListPlus size={16} />
                </IconButton>
              )}
              {["interrupted", "failed"].includes(task.status) && (
                <IconButton
                  label={`Resume ${name}`}
                  disabled={actionsBlocked}
                  disabledReason="Restart Visuales to finish the app update before resuming transfers."
                  tooltip="Resume now"
                  description="Continue immediately using existing partial files, without waiting in the queue."
                  onClick={() => onAction("resume_download_task", task.id)}
                >
                  <Play size={15} />
                </IconButton>
              )}
            </>
          )}
          <IconButton
            label={`Remove task ${name}`}
            tooltip="Remove from history"
            description={
              isActive(task)
                ? "Stop this task and remove its record. Downloaded files are kept."
                : "Remove this task's record. Downloaded files are kept."
            }
            disabledReason={
              actionsBlocked
                ? "Finish the app update before changing transfers."
                : "Wait for this task to finish updating."
            }
            disabled={pending || actionsBlocked}
            onClick={() => onAction("delete_download_task", task.id)}
          >
            <Trash2 size={15} />
          </IconButton>
        </TableCell>
      </TableRow>
      {(error || task.lastError) && (
        <TableRow className="transfer-error-row">
          <TableCell colSpan={5}>
            <Alert variant="destructive" className="task-error">
              <AlertCircle size={14} aria-hidden="true" />
              <AlertDescription>{messageForDisplay(error || task.lastError)}</AlertDescription>
            </Alert>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function TransferTableHead() {
  return (
    <TableHeader>
      <TableRow className="transfer-head">
        <TableHead>Transfer</TableHead>
        <TableHead>Progress</TableHead>
        <TableHead>Speed</TableHead>
        <TableHead>Status</TableHead>
        <TableHead className="align-right">Actions</TableHead>
      </TableRow>
    </TableHeader>
  );
}

function App({ root }: { root?: string }) {
  const appearance = useAppearance();
  const [view, setView] = useState<View>("search");
  const [query, setQuery] = useState("");
  const [searchedQuery, setSearchedQuery] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult[]>([]);
  const { sort, changeSort } = useSearchSort();
  const searchBrowser = useSearchBrowser(results, searchedQuery !== "", root, "", sort);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const selectionStates = useMemo(
    () => treeSelectionStates(searchBrowser.tree, selected),
    [searchBrowser.tree, selected]
  );
  const selectedCount = searchBrowser.entries.filter((entry) => selectionStates.get(entry.encodedUrl) === true).length;
  const [output, setOutput] = useState("~/Downloads/Visuales");
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState<"download" | "queue" | null>(null);
  const [submittingUrl, setSubmittingUrl] = useState<string | null>(null);
  const [searchError, setSearchError] = useState("");
  const [selectionError, setSelectionError] = useState("");
  const [reviewUrls, setReviewUrls] = useState<string[] | null>(null);
  const [message, setMessage] = useState("");
  const [taskErrors, setTaskErrors] = useState<Record<string, string>>({});
  const [interruptingAll, setInterruptingAll] = useState(false);
  const [retryingAll, setRetryingAll] = useState(false);
  const retryAllBusy = useRef(false);
  const [expanded, setExpanded] = useState(false);
  const { collapsed: savedGroups, setCollapsed: saveGroup } = useCollapsedGroups("visuales.download-groups");
  const [groupOverrides, setGroupOverrides] = useState<Record<string, boolean>>({});
  const collapsedGroups = useMemo(() => ({ ...savedGroups, ...groupOverrides }), [savedGroups, groupOverrides]);
  const [taskQuery, setTaskQuery] = useState("");
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const updates = useAppUpdates();
  const settings = useDesktopSettings();
  const indexing = useSearchIndex();
  const [newResults, setNewResults] = useState<SearchResult[] | null>(null);
  const currentResults = useRef(results);
  currentResults.current = results;
  const currentSelection = useRef(selected);
  currentSelection.current = selected;
  const resultRevision = useRef<string | null>(null);
  const { tasks, refresh, refreshManually, refreshing, connectionError, pending, act } = useTransfers(
    updates.blocksTransfers
  );
  const outputEdited = useRef(false);
  const inspectedTask = tasks.find((task) => task.id === inspectedId);
  useEffect(() => {
    if (view !== "downloads") setGroupOverrides((current) => (Object.keys(current).length ? {} : current));
  }, [view]);
  useEffect(() => {
    if (inspectedId && !inspectedTask) setInspectedId(null);
  }, [inspectedId, inspectedTask]);
  const starting = useRef(false);
  const searchingRef = useRef(false);
  const searchRequest = useRef(0);
  const libraryIndex = useRef<Promise<SearchResult[]> | null>(null);
  const indexInvalidated = useRef(false);
  const [indexRevision, setIndexRevision] = useState(0);
  const lastRequest = useRef("");
  const searchInput = useRef<HTMLInputElement>(null);
  const searchList = useRef<HTMLDivElement>(null);
  const downloadsList = useRef<HTMLDivElement>(null);
  const downloadAnchor = useRef<{ id: string; top: number } | null>(null);
  function rememberDownloadAnchor(id?: string) {
    const list = downloadsList.current;
    if (!list) return;
    const top = list.getBoundingClientRect().top;
    const rows = [...list.querySelectorAll<HTMLElement>("[data-transfer-id]")];
    const row = id
      ? rows.find((row) => row.dataset.transferId === id)
      : rows.find((row) => row.getBoundingClientRect().bottom > top);
    if (row) downloadAnchor.current = { id: row.dataset.transferId!, top: row.getBoundingClientRect().top - top };
  }
  useLayoutEffect(() => {
    const anchor = downloadAnchor.current;
    const list = downloadsList.current;
    downloadAnchor.current = null;
    if (!anchor || !list) return;
    const row = [...list.querySelectorAll<HTMLElement>("[data-transfer-id]")].find(
      (row) => row.dataset.transferId === anchor.id
    );
    if (row) list.scrollTop += row.getBoundingClientRect().top - list.getBoundingClientRect().top - anchor.top;
  }, [inspectedId, view]);
  useQueueReorderAnimation(downloadsList, JSON.stringify([view, collapsedGroups, taskQuery]));
  const scrollPositions = useRef({ search: 0, downloads: 0 });

  useEffect(() => {
    const revision =
      searchedQuery === "" && !root && !sort.startsWith("modified")
        ? indexing.status?.libraryRevision
        : indexing.status?.revision;
    if (!revision || revision === resultRevision.current || view !== "search" || searchedQuery === null || searching)
      return;
    let stopped = false;
    const request = searchRequest.current;
    const timer = window.setTimeout(() => {
      void invoke<{ results: SearchResult[] }>("search_content", {
        terms: searchedQuery ? searchedQuery.split(/\s+/) : [],
        noCache: false,
        root,
      })
        .then((response) => {
          if (stopped || request !== searchRequest.current) return;
          resultRevision.current = revision;
          if (JSON.stringify(response.results) === JSON.stringify(currentResults.current)) {
            setNewResults(null);
            return;
          }
          if (
            currentSelection.current.size ||
            (searchList.current?.scrollTop ?? 0) > 0 ||
            searchList.current?.contains(document.activeElement)
          ) {
            setNewResults(response.results);
          } else {
            searchBrowser.reconcile(currentResults.current, response.results);
            setResults(response.results);
            setNewResults(null);
          }
          if (searchedQuery === "") libraryIndex.current = Promise.resolve(response.results);
        })
        .catch(() => {});
    }, 500);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [indexing.status?.revision, indexing.status?.libraryRevision, view, searchedQuery, searching, sort]);

  function applyNewResults() {
    if (!newResults) return;
    searchBrowser.reconcile(results, newResults);
    setResults(newResults);
    setNewResults(null);
  }

  function showIndexSettings() {
    switchView("settings");
    requestAnimationFrame(() => {
      const heading = document.getElementById("settings-search-heading");
      heading?.scrollIntoView({ block: "nearest" });
      heading?.focus({ preventScroll: true });
    });
  }

  useEffect(() => {
    if (!isDesktop() || root) return;
    let stopped = false;
    const navigate = async () => {
      const id = await invoke<string | null>("take_download_navigation");
      if (stopped || typeof id !== "string") return;
      setGroupOverrides(
        id ? { running: false, queued: false, failed: false, interrupted: false, completed: false } : {}
      );
      setTaskQuery(id);
      setView("downloads");
    };
    const unlisten = listen("open-downloads", () => void navigate().catch(() => {}));
    void unlisten
      .then(() => {
        if (!stopped) return navigate();
      })
      .catch(() => {});
    return () => {
      stopped = true;
      void unlisten.then((stop) => stop()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    void loadSearch("");
    return () => {
      searchRequest.current++;
    };
  }, []);

  useEffect(() => {
    if (!isDesktop()) return;
    const stop = listen("search-index-changed", () => {
      libraryIndex.current = null;
      indexInvalidated.current = true;
      setIndexRevision((revision) => revision + 1);
    });
    return () => {
      void stop.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (view !== "search" || !indexInvalidated.current) return;
    indexInvalidated.current = false;
    void loadSearch(lastRequest.current);
  }, [view, indexRevision]);

  useEffect(() => {
    if (!isDesktop() || root) return;
    let stopped = false;
    const navigate = async () => {
      const url = await invoke<string | null>("take_search_navigation");
      if (stopped || !url) return;
      const request = ++searchRequest.current;
      searchingRef.current = true;
      setSearching(true);
      setView("search");
      try {
        const parent = new URL("..", url.endsWith("/") ? url : new URL(".", url)).href;
        const directory = url.endsWith("/") ? parent : new URL(".", url).href;
        const entries = await invoke<SearchResult[]>("list_library_directory", { url: directory, refresh: false });
        if (stopped || request !== searchRequest.current) return;
        const target = entries.find((entry) => entry.encodedUrl === url);
        if (!target) throw new Error("This item is no longer in its folder. Try refreshing the folder.");
        searchBrowser.reset();
        setResults([target]);
        setSearchedQuery(target.text);
        setQuery(target.text);
        setSelected(new Set([url]));
        setSearchError("");
        requestAnimationFrame(() => {
          const row = [...(searchList.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])].find(
            (row) => row.dataset.url === url
          );
          row?.scrollIntoView({ block: "center" });
          row?.focus({ preventScroll: true });
        });
      } catch (error) {
        if (!stopped && request === searchRequest.current) setSearchError(String(error));
      } finally {
        if (!stopped && request === searchRequest.current) {
          searchingRef.current = false;
          setSearching(false);
        }
      }
    };
    const stop = listen("show-in-search", () => void navigate().catch(() => {}));
    void stop.then(navigate).catch(() => {});
    return () => {
      stopped = true;
      void stop.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), 4000);
    return () => window.clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    const available = new Set(searchBrowser.entries.map((entry) => entry.encodedUrl));
    setSelected((current) =>
      [...current].every((url) => available.has(url))
        ? current
        : new Set([...current].filter((url) => available.has(url)))
    );
  }, [searchBrowser.entries]);

  useEffect(() => {
    if (settings.snapshot && !outputEdited.current) setOutput(settings.snapshot.settings.output);
  }, [settings.snapshot]);

  useLayoutEffect(() => {
    if (view !== "search" && view !== "downloads") return;
    const element = view === "search" ? searchList.current : downloadsList.current;
    if (element) element.scrollTop = scrollPositions.current[view];
  }, [view]);

  const activeTasks = tasks.filter(isActive);
  const runningCount = tasks.filter((task) => task.status === "running").length;
  const queuedCount = tasks.filter((task) => task.status === "queued").length;
  const failedCount = tasks.filter((task) => task.status === "failed").length;
  const totalSpeed = activeTasks.reduce((total, task) => total + (taskSpeedBytes(task) ?? 0), 0);
  const queuePositions = useMemo(
    () => new Map(orderedQueue(tasks).map((task, index) => [task.id, index + 1])),
    [tasks]
  );
  const visibleTasks = useMemo(
    () =>
      tasks
        .filter((task) => {
          return `${taskName(task)} ${task.output} ${task.id}`.toLowerCase().includes(taskQuery.toLowerCase());
        })
        .sort(compareTransferOrder),
    [tasks, taskQuery]
  );

  function switchView(next: View) {
    const element = view === "search" ? searchList.current : downloadsList.current;
    if (element && (view === "search" || view === "downloads")) scrollPositions.current[view] = element.scrollTop;
    setView(next);
  }

  function showFailures() {
    setGroupOverrides({ running: true, queued: true, completed: true, failed: false, interrupted: true });
    setTaskQuery("");
    switchView("downloads");
  }

  async function runSearch(event: React.FormEvent) {
    event.preventDefault();
    if (!query.trim() || searchingRef.current || starting.current) return;
    await loadSearch(query);
  }

  async function loadSearch(value: string) {
    const request = ++searchRequest.current;
    const terms = value.trim() ? value.trim().split(/\s+/) : [];
    lastRequest.current = terms.join(" ");
    searchingRef.current = true;
    setSearching(true);
    setSearchError("");
    setMessage("");
    setNewResults(null);
    resultRevision.current =
      (!value.trim() && !root && !sort.startsWith("modified")
        ? indexing.status?.libraryRevision
        : indexing.status?.revision) ?? null;
    if (!terms.length) {
      searchBrowser.reset();
      setResults([]);
      setSelected(new Set());
      setSearchedQuery("");
    }
    try {
      if (!isDesktop()) throw new Error("Library connection unavailable. Open Visuales to search.");
      let response: SearchResult[];
      if (!terms.length) {
        // Share the initial request (including StrictMode's remount) and reuse the
        // parsed index when clearing a query, even if the server goes offline.
        const pending =
          libraryIndex.current ??
          invoke<{ results: SearchResult[] }>("search_content", { terms: [], noCache: false, root }).then(
            (result) => result.results
          );
        libraryIndex.current = pending;
        try {
          response = await pending;
        } catch (error) {
          if (libraryIndex.current === pending) libraryIndex.current = null;
          throw error;
        }
      } else {
        response = (await invoke<{ results: SearchResult[] }>("search_content", { terms, noCache: false, root }))
          .results;
      }
      if (searchRequest.current !== request) return;
      searchBrowser.reset();
      setResults(response);
      setSelected(new Set());
      setSearchedQuery(terms.join(" "));
      setSelectionError("");
      scrollPositions.current.search = 0;
      if (searchList.current) searchList.current.scrollTop = 0;
    } catch (error) {
      if (searchRequest.current === request) setSearchError(String(error));
    } finally {
      if (searchRequest.current === request) {
        setSearching(false);
        searchingRef.current = false;
      }
    }
  }

  function changeQuery(value: string) {
    setQuery(value);
    if (!value.trim() && query.trim()) void loadSearch("");
  }

  function clearSelection() {
    setSelected(new Set());
    setSelectionError("");
    searchList.current?.querySelector<HTMLElement>('[role="treeitem"][tabindex="0"]')?.focus({ preventScroll: true });
  }

  async function chooseOutput() {
    try {
      if (!isDesktop()) throw new Error("Folder picker is unavailable. Enter a destination path.");
      const chosen = await open({ directory: true, multiple: false });
      if (typeof chosen === "string") {
        outputEdited.current = true;
        setOutput(chosen);
        setSelectionError("");
      }
    } catch (error) {
      setSelectionError(String(error));
    }
  }

  async function startDownload(queue: boolean, url?: string | string[]) {
    if (
      (!url && !selected.size) ||
      !output.trim() ||
      starting.current ||
      searchingRef.current ||
      updates.blocksTransfers
    )
      return;
    starting.current = true;
    setSubmitting(queue ? "queue" : "download");
    setSubmittingUrl(typeof url === "string" ? url : null);
    setSelectionError("");
    setMessage("");
    try {
      await invoke("start_download", {
        urls: url ? (Array.isArray(url) ? url : [url]) : distinctDownloadUrls(selected),
        output: outputEdited.current ? output.trim() : undefined,
        queue,
      });
      if (!url) clearSelection();
      setMessage(queue ? "Transfer added to queue" : "Transfer started");
      await refresh(true);
    } catch (error) {
      setSelectionError(String(error));
    } finally {
      starting.current = false;
      setSubmitting(null);
      setSubmittingUrl(null);
    }
  }

  async function taskAction(command: TransferCommand, id: string, position?: QueueMove, paths?: string[]) {
    if (interruptingAll || retryAllBusy.current) return;
    setTaskErrors((current) => ({ ...current, [id]: "" }));
    try {
      await act(command, id, position, paths);
    } catch (error) {
      setTaskErrors((current) => ({ ...current, [id]: String(error) }));
    }
  }

  async function retryAllFailed(items: Task[]) {
    if (retryAllBusy.current || interruptingAll || updates.blocksTransfers || pending.size) return;
    const failed = items.filter((task) => task.status === "failed");
    retryAllBusy.current = true;
    setRetryingAll(true);
    try {
      for (const task of failed) {
        setTaskErrors((current) => ({ ...current, [task.id]: "" }));
        try {
          await act("retry_failed_download_task", task.id);
        } catch (error) {
          setTaskErrors((current) => ({ ...current, [task.id]: String(error) }));
          setGroupOverrides((current) => ({ ...current, failed: false }));
        }
      }
    } finally {
      retryAllBusy.current = false;
      setRetryingAll(false);
    }
  }

  async function openOutputFolder(path: string, taskId?: string) {
    if (taskId) setTaskErrors((current) => ({ ...current, [taskId]: "" }));
    else setSelectionError("");
    try {
      if (!isDesktop()) throw new Error("Open folders from the desktop app.");
      await invoke("open_output_folder", { path });
    } catch (error) {
      if (taskId) setTaskErrors((current) => ({ ...current, [taskId]: String(error) }));
      else setSelectionError(String(error));
    }
  }

  const row = (task: Task) => (
    <TaskRow
      key={task.id}
      task={task}
      inspected={task.id === inspectedId}
      onInspect={() => {
        rememberDownloadAnchor(task.id);
        setInspectedId(task.id);
        switchView("downloads");
      }}
      queuePosition={queuePositions.get(task.id) ?? 0}
      queueTotal={queuedCount}
      pending={pending.has(task.id)}
      actionsBlocked={updates.blocksTransfers || interruptingAll || retryingAll}
      error={taskErrors[task.id]}
      onAction={(command, id, position) => void taskAction(command, id, position)}
      onOpen={() => void openOutputFolder(task.output, task.id)}
    />
  );

  return (
    <Tabs value={view} onValueChange={(value) => switchView(value as View)} render={<main />} className="app-shell">
      {reviewUrls && (
        <DownloadReview
          urls={reviewUrls}
          output={outputEdited.current ? output.trim() : undefined}
          blocked={updates.blocksTransfers}
          onClose={() => setReviewUrls(null)}
          onStarted={(queue) => {
            setReviewUrls(null);
            clearSelection();
            setMessage(queue ? "Transfer added to queue" : "Transfer started");
            void refresh(true);
          }}
        />
      )}
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" role={appIconLabel ? "img" : undefined} aria-label={appIconLabel || undefined}>
            <svg viewBox="64 64 896 896" width="100%" height="100%" aria-hidden="true" focusable="false">
              <use href={`${appIcon}#visuales-mark`} />
            </svg>
          </span>
          <h1>Visuales</h1>
        </div>
        <TabsList variant="line" aria-label="Workspace" activateOnFocus>
          <TabsTrigger value="search" id="tab-search">
            <Search size={16} />
            Search
          </TabsTrigger>
          <TabsTrigger value="downloads" id="tab-downloads">
            <Download size={16} />
            Downloads
            {activeTasks.length > 0 && (
              <Badge variant="secondary" className="tab-count">
                {activeTasks.length}
              </Badge>
            )}
            {failedCount > 0 && (
              <Badge
                variant="outline"
                className="failure-count"
                aria-label={`${failedCount} failed transfers`}
                title={`${failedCount} failed transfers`}
              >
                <AlertCircle size={12} />
                {failedCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="settings" id="tab-settings">
            <Settings size={16} /> Settings
          </TabsTrigger>
          <TabsTrigger value="about" id="tab-about" className="about-tab">
            <Info size={16} /> About
          </TabsTrigger>
        </TabsList>
      </header>

      <AppUpdatesPanel updates={updates} activeTransfers={activeTasks.length > 0} />

      {connectionError && !updates.blocksTransfers && (
        <Alert variant="destructive" className="connection-error">
          <AlertCircle size={15} />
          <AlertDescription>{messageForDisplay(connectionError)}</AlertDescription>
          <IconButton
            label="Reconnect"
            tooltip="Reconnect to download engine"
            description="Retry the local engine connection and refresh transfers."
            disabled={refreshing}
            disabledReason="Reconnecting to the download engine. Please wait."
            onClick={() => void refreshManually()}
          >
            <RefreshCw size={15} className={refreshing ? "spin" : ""} />
          </IconButton>
        </Alert>
      )}

      <TabsContent
        value="search"
        keepMounted
        hidden={view !== "search"}
        id="panel-search"
        onKeyDownCapture={(event) => {
          if (event.key !== "Escape" || event.nativeEvent.isComposing || !selected.size || submitting) return;
          // Dismiss an overlay first, without also clearing the staged downloads beneath it.
          if (hasOpenOverlay()) return;
          event.preventDefault();
          event.stopPropagation();
          clearSelection();
        }}
        className="workspace-panel search-panel"
      >
        <h2 className="sr-only">Search library</h2>
        <form className="search-container" onSubmit={runSearch}>
          <InputGroup className="search-form">
            <InputGroupInput
              ref={searchInput}
              type="search"
              value={query}
              onChange={(event) => changeQuery(event.target.value)}
              disabled={Boolean(submitting)}
              placeholder="Search titles, folders, or files"
              aria-label="Search library"
            />
            <InputGroupAddon align="inline-end" className="search-actions">
              {query && (
                <IconButton
                  label="Clear search"
                  description="Clear the search and selection to browse the full library."
                  disabled={Boolean(submitting)}
                  onClick={() => {
                    changeQuery("");
                    searchInput.current?.focus();
                  }}
                >
                  <X size={16} />
                </IconButton>
              )}
              <IconButton
                variant="primary"
                className="search-submit"
                type="submit"
                label={searching ? "Searching" : "Search"}
                tooltip="Search library"
                description="Find titles, folders, and files matching your search."
                disabledReason={
                  searching
                    ? "Searching the library. Please wait."
                    : submitting
                      ? "Wait for the transfer to start."
                      : "Enter a search term first."
                }
                disabled={!query.trim() || searching || Boolean(submitting)}
              >
                {searching ? <Spinner size={18} aria-hidden="true" /> : <Search size={18} />}
              </IconButton>
            </InputGroupAddon>
          </InputGroup>
        </form>
        {searchError && (
          <Alert variant="destructive" className="inline-error">
            <AlertCircle size={15} />
            <AlertDescription>{messageForDisplay(searchError)}</AlertDescription>
            <Button
              variant="link"
              disabled={searching || Boolean(submitting)}
              onClick={() => void loadSearch(lastRequest.current)}
            >
              Retry
            </Button>
          </Alert>
        )}
        {searchedQuery !== null && (results.length > 0 || indexing.status) && (
          <div className="results-toolbar">
            <div className="results-count">
              <span>
                {results.length} {searchedQuery === "" ? "items" : "results"}
                {searchBrowser.entries.length > results.length
                  ? ` · ${searchBrowser.entries.length - results.length} browsed`
                  : ""}
              </span>
            </div>
            <span className="secondary truncate" role="status">
              {searchedQuery === "" ? "Library" : query.trim() !== searchedQuery ? `for "${searchedQuery}"` : ""}
            </span>
            {indexing.status && (
              <div className="search-index-status">
                {newResults && (
                  <Button variant="link" onClick={applyNewResults}>
                    <RefreshCw size={13} />
                    New results
                  </Button>
                )}
                <Button
                  variant="ghost"
                  onClick={showIndexSettings}
                  aria-label={`File indexing: ${searchIndexLabel(indexing.status)}`}
                >
                  {indexing.status.phase === "indexing" && <Spinner />}
                  {searchIndexLabel(indexing.status)}
                </Button>
              </div>
            )}
            {message && (
              <Alert className="success-message" role="status">
                <Check size={14} />
                {message}
              </Alert>
            )}
            <SearchSortControl sort={sort} onChange={changeSort} dates={searchBrowser.dates} />
          </div>
        )}
        {selectionError && selected.size === 0 && (
          <Alert variant="destructive">
            <AlertCircle size={14} />
            <AlertDescription>{messageForDisplay(selectionError)}</AlertDescription>
          </Alert>
        )}
        <div
          className={`list-scroll results-list ${results.length ? "" : "is-empty"}`}
          ref={searchList}
          aria-label="Search results"
          aria-busy={searching}
        >
          {results.length > 0 ? (
            <SearchTree
              key={searchedQuery}
              browser={searchBrowser}
              tasks={tasks}
              statusesUnavailable={Boolean(connectionError)}
              selectionStates={selectionStates}
              selected={selected}
              setSelected={setSelected}
              disabled={searching || Boolean(submitting)}
              transfersBlocked={updates.blocksTransfers || !output.trim()}
              submittingUrl={submittingUrl}
              submitting={submitting}
              output={output}
              onTransfer={(url, queue) => void startDownload(queue, url)}
              onReview={(urls) => setReviewUrls(distinctDownloadUrls(new Set(urls)))}
            />
          ) : (
            <Empty className="empty-state">
              <EmptyHeader>
                <EmptyMedia>
                  <Search size={32} strokeWidth={1.3} aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>
                  {searching
                    ? lastRequest.current === ""
                      ? "Loading library"
                      : "Searching the library"
                    : searchError
                      ? "Library unavailable"
                      : searchedQuery === ""
                        ? "Library is empty"
                        : searchedQuery === null
                          ? "Loading library"
                          : "No matching results"}
                </EmptyTitle>
                {searchedQuery && !searching && <EmptyDescription>{searchedQuery}</EmptyDescription>}
              </EmptyHeader>
            </Empty>
          )}
        </div>

        {selected.size > 0 && (
          <div className="selection-bar" aria-label="Selected downloads">
            <div className="selection-count">
              <Check size={16} />
              <span>{selectedCount} selected</span>
              <IconButton
                label="Clear selection"
                description="Deselect all results without clearing your search."
                disabledReason="Wait for the transfer to start."
                disabled={Boolean(submitting)}
                onClick={clearSelection}
              >
                <X size={15} />
              </IconButton>
            </div>
            <div className="destination">
              <Label htmlFor="destination">Save to</Label>
              <InputGroup className="destination-input">
                <InputGroupInput
                  id="destination"
                  aria-label="Download destination"
                  value={output}
                  disabled={Boolean(submitting)}
                  onChange={(event) => {
                    outputEdited.current = true;
                    setOutput(event.target.value);
                  }}
                  title={output}
                />
                <InputGroupAddon align="inline-end" className="destination-actions">
                  <IconButton
                    label="Choose output folder"
                    tooltip="Choose download destination"
                    description="Pick the parent folder for new downloads. Existing tasks are unchanged."
                    disabledReason="Wait for the transfer to start."
                    disabled={Boolean(submitting)}
                    onClick={() => void chooseOutput()}
                  >
                    <FolderOpen size={17} />
                  </IconButton>
                  <IconButton
                    label="Open output folder"
                    tooltip="Open destination folder"
                    description="Show this folder in your file manager without changing the destination."
                    disabledReason="Enter a destination path first."
                    disabled={!output.trim()}
                    onClick={() => void openOutputFolder(output)}
                  >
                    <FolderOutput size={17} />
                  </IconButton>
                </InputGroupAddon>
              </InputGroup>
            </div>
            <div className="selection-actions">
              <IconButton
                label="Review download"
                disabled={!output.trim() || Boolean(submitting) || searching || updates.blocksTransfers}
                onClick={() => setReviewUrls(distinctDownloadUrls(selected))}
              >
                <ClipboardList size={17} />
              </IconButton>
              <Button
                variant="outline"
                disabled={!output.trim() || Boolean(submitting) || searching || updates.blocksTransfers}
                onClick={() => void startDownload(true)}
              >
                {submitting === "queue" ? <Spinner size={16} aria-hidden="true" /> : <ListPlus size={16} />}Queue
              </Button>
              <Button
                disabled={!output.trim() || Boolean(submitting) || searching || updates.blocksTransfers}
                onClick={() => void startDownload(false)}
              >
                {submitting === "download" ? <Spinner size={16} aria-hidden="true" /> : <Download size={16} />}
                Download
              </Button>
            </div>
            {selectionError && (
              <Alert variant="destructive" className="selection-error">
                <AlertCircle size={14} />
                <AlertDescription>{messageForDisplay(selectionError)}</AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {activeTasks.length > 0 && (
          <Collapsible
            open={expanded}
            onOpenChange={setExpanded}
            className="activity-tray"
            aria-label="Transfer activity"
          >
            <div className="activity-strip">
              <CollapsibleTrigger render={<Button variant="ghost" className="tray-toggle" />}>
                {expanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                <span className="activity-dot" />
                <span>
                  {runningCount} running{queuedCount > 0 ? ` · ${queuedCount} queued` : ""}
                </span>
              </CollapsibleTrigger>
              <span className="activity-speed">{totalSpeed > 0 ? `${formatBytes(totalSpeed)}/s` : "--"}</span>
              <Button variant="link" className="text-button" onClick={() => switchView("downloads")}>
                View downloads
              </Button>
            </div>
            <CollapsibleContent id="active-transfers" className="tray-list" aria-label="Active transfers">
              <ul className="activity-summaries">
                {activeTasks.slice(0, 3).map((task) => (
                  <li key={task.id}>
                    <ArrowDownToLine size={14} aria-hidden="true" />
                    <span className="truncate" title={taskName(task)}>
                      {taskName(task)}
                    </span>
                    <span className="secondary">
                      {task.status === "queued"
                        ? "Queued"
                        : taskProgress(task) === null
                          ? "Running"
                          : `${Math.floor(taskProgress(task)!)}%`}
                    </span>
                  </li>
                ))}
              </ul>
              {activeTasks.length > 3 && (
                <Button variant="link" className="tray-more" onClick={() => switchView("downloads")}>
                  View all {activeTasks.length} transfers
                </Button>
              )}
            </CollapsibleContent>
          </Collapsible>
        )}
      </TabsContent>

      <TabsContent
        value="downloads"
        keepMounted
        hidden={view !== "downloads"}
        id="panel-downloads"
        className="workspace-panel downloads-panel"
      >
        <div className="downloads-toolbar">
          <div className="downloads-heading">
            <h2>Downloads</h2>
            <span
              className="secondary download-count"
              role="status"
              aria-label={`Showing ${visibleTasks.length} of ${tasks.length} downloads`}
            >
              {!taskQuery ? tasks.length : `${visibleTasks.length} of ${tasks.length}`}
            </span>
          </div>
          <InputGroup className="filter-field">
            <InputGroupAddon>
              <Search size={16} />
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              value={taskQuery}
              onChange={(event) => {
                setTaskQuery(event.target.value);
                setGroupOverrides({});
              }}
              placeholder="Filter downloads"
              aria-label="Filter downloads"
            />
          </InputGroup>
          <div className="downloads-toolbar-actions">
            <InterruptAllButton
              tasks={tasks}
              disabled={updates.blocksTransfers || pending.size > 0 || retryingAll}
              onPendingChange={setInterruptingAll}
              onChanged={() => refresh(true)}
            />
            <IconButton
              label="Refresh downloads"
              className="downloads-refresh"
              description="Fetch the latest status of desktop and CLI transfers."
              disabledReason="Refreshing transfer status. Please wait."
              disabled={refreshing || updates.blocksTransfers}
              onClick={() => void refreshManually()}
            >
              <RefreshCw size={16} className={refreshing ? "spin" : ""} />
            </IconButton>
          </div>
        </div>
        <div className={`downloads-content ${inspectedTask && view === "downloads" ? "has-inspector" : ""}`}>
          <div className="list-scroll downloads-list" ref={downloadsList}>
            {visibleTasks.length > 0 ? (
              <Table aria-label="Downloads">
                <TransferTableHead />
                {taskGroups.map((group) => {
                  const items = visibleTasks.filter((task) => group.id === task.status);
                  if (!items.length) return null;
                  const collapsed = !!collapsedGroups[group.id];
                  return (
                    <React.Fragment key={group.id}>
                      <TableBody>
                        <TableRow className="download-group">
                          <TableCell colSpan={5}>
                            <div className="download-group-header">
                              <Button
                                variant="ghost"
                                className="group-toggle"
                                aria-label={`${group.label} downloads (${items.length})`}
                                aria-expanded={!collapsed}
                                aria-controls={`download-group-${group.id}`}
                                onClick={() => {
                                  saveGroup(group.id, !collapsed);
                                  setGroupOverrides((current) => {
                                    const next = { ...current };
                                    delete next[group.id];
                                    return next;
                                  });
                                }}
                              >
                                <ChevronRight size={14} className={collapsed ? "" : "group-expanded"} />
                                <span>{group.label}</span>
                                <span className="secondary">{items.length}</span>
                              </Button>
                              {group.id === "failed" && (
                                <Button
                                  variant="ghost"
                                  className="group-retry"
                                  aria-label="Retry all failed downloads"
                                  disabled={
                                    retryingAll || interruptingAll || updates.blocksTransfers || pending.size > 0
                                  }
                                  onClick={() => void retryAllFailed(items)}
                                >
                                  {retryingAll ? <Spinner size={14} /> : <RefreshCw size={14} />}
                                  Retry all
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      </TableBody>
                      <TableBody id={`download-group-${group.id}`} hidden={collapsed}>
                        {!collapsed && items.map(row)}
                      </TableBody>
                    </React.Fragment>
                  );
                })}
              </Table>
            ) : (
              <Empty className="empty-state">
                <EmptyHeader>
                  <EmptyMedia>
                    <ArrowDownToLine size={32} strokeWidth={1.3} />
                  </EmptyMedia>
                  <EmptyTitle>{tasks.length ? "No matching transfers" : "No downloads yet"}</EmptyTitle>
                </EmptyHeader>
                {tasks.length ? (
                  <Button
                    variant="link"
                    className="text-button"
                    onClick={() => {
                      setTaskQuery("");
                    }}
                  >
                    Clear filters
                  </Button>
                ) : (
                  <Button variant="link" className="text-button" onClick={() => switchView("search")}>
                    Search library
                  </Button>
                )}
              </Empty>
            )}
          </div>
          {inspectedTask && view === "downloads" && (
            <TransferInspector
              task={inspectedTask}
              pending={pending.has(inspectedTask.id)}
              blocked={updates.blocksTransfers || interruptingAll || retryingAll}
              error={taskErrors[inspectedTask.id]}
              onClose={() => {
                rememberDownloadAnchor();
                setInspectedId(null);
                const trigger = [
                  ...(downloadsList.current?.querySelectorAll<HTMLButtonElement>(".inspect-transfer") ?? []),
                ].find(
                  (button) => button.closest("[data-transfer-id]")?.getAttribute("data-transfer-id") === inspectedId
                );
                trigger?.focus({ preventScroll: true });
              }}
              onOpen={() => void openOutputFolder(inspectedTask.output, inspectedTask.id)}
              onAction={(command, id) => void taskAction(command, id)}
              onRetry={(paths) => void taskAction("retry_download_files", inspectedTask.id, undefined, paths)}
            />
          )}
        </div>
        <footer className="downloads-footer">
          <span>
            {runningCount} running · {queuedCount} queued
          </span>
          {failedCount > 0 && (
            <Button variant="link" className="failure-link" onClick={showFailures}>
              <AlertCircle size={13} />
              {failedCount} failed
            </Button>
          )}
          <span className="footer-speed">{totalSpeed > 0 ? `${formatBytes(totalSpeed)}/s` : ""}</span>
        </footer>
      </TabsContent>
      <TabsContent
        value="settings"
        keepMounted
        hidden={view !== "settings"}
        id="panel-settings"
        className="workspace-panel settings-panel"
      >
        <SettingsView controller={settings} appearance={appearance} indexing={indexing} />
      </TabsContent>
      <TabsContent
        value="about"
        keepMounted
        hidden={view !== "about"}
        id="panel-about"
        className="workspace-panel about-page"
      >
        <AboutView updates={updates} />
      </TabsContent>
    </Tabs>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <IconTooltipProvider>
      {new URLSearchParams(window.location.search).has("tray") ? (
        <TrayPopup />
      ) : new URLSearchParams(window.location.search).has("library-window") ? (
        <Suspense fallback={<Spinner aria-label="Opening window" />}>
          <LibraryWindow
            renderFolder={(resource) => <App key={`${resource.url}:${resource.revision}`} root={resource.url} />}
          />
        </Suspense>
      ) : (
        <App />
      )}
    </IconTooltipProvider>
  </React.StrictMode>
);
