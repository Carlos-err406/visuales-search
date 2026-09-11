import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { TrayPopup } from "./tray-popup";
import { open } from "@tauri-apps/plugin-dialog";
import { IconButton, IconTooltipProvider } from "./icon-button";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { InputGroup, InputGroupInput, InputGroupAddon } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
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
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  FolderOutput,
  FolderOpen,
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
  taskName,
  taskProgress,
  taskSize,
  taskSpeed,
  taskSpeedBytes,
  type Task,
} from "./task-view";
import { isDesktop, useTransfers } from "./use-transfers";
import { useAppUpdates } from "./use-app-updates";
import { AppUpdatesPanel } from "./app-updates";
import { useDesktopSettings } from "./use-desktop-settings";
import { SettingsView } from "./settings-view";
import { useAppearance } from "./use-appearance";
import { SearchTree, useSearchBrowser } from "./search-tree";
import { distinctDownloadUrls, treeSelectionStates } from "@visuales/core/search-tree";
import appIcon from "../app-icon.svg?no-inline";

type View = "search" | "downloads" | "settings";
type Filter = "all" | "active" | "attention" | "completed";
const statusFilters: { value: Filter; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active & queued" },
  { value: "attention", label: "Needs attention" },
  { value: "completed", label: "Completed" },
];

function SelectAll({
  count,
  total,
  disabled,
  onChange,
}: {
  count: number;
  total: number;
  disabled: boolean;
  onChange: () => void;
}) {
  return (
    <Checkbox
      aria-label="Select all results"
      indeterminate={count > 0 && count < total}
      checked={total > 0 && count === total}
      disabled={disabled || !total}
      onCheckedChange={onChange}
    />
  );
}

function TaskRow({
  task,
  pending,
  actionsBlocked,
  error,
  onAction,
  onOpen,
}: {
  task: Task;
  pending: boolean;
  actionsBlocked: boolean;
  error?: string;
  onAction: (command: "resume_download_task" | "cancel_download_task" | "delete_download_task", id: string) => void;
  onOpen: () => void;
}) {
  const percent = taskProgress(task);
  const name = taskName(task);
  return (
    <>
      <TableRow className={`transfer-row ${task.status}`}>
        <TableCell className="transfer-name">
          <div className="file-symbol">
            <ArrowDownToLine size={17} aria-hidden="true" />
          </div>
          <div className="file-copy">
            <span className="file-title" title={name}>
              {name}
            </span>
            <span className="secondary truncate" title={`${task.output} · ${task.id}`}>
              {task.output} <span className="task-id">· {task.id}</span>
            </span>
          </div>
        </TableCell>
        <TableCell className="transfer-progress">
          <div className="progress-label">
            <span>
              {task.status === "queued" ? "Waiting" : percent === null ? "Size unknown" : `${Math.floor(percent)}%`}
            </span>
            <span className="secondary">{taskSize(task)}</span>
          </div>
          <Progress
            aria-label={`Progress for ${name}`}
            max={100}
            value={percent === null && task.status === "running" ? null : (percent ?? 0)}
          />
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
                  label={`Resume ${name}`}
                  disabled={actionsBlocked}
                  disabledReason="Restart Visuales to finish the app update before resuming transfers."
                  tooltip="Resume download"
                  description="Continue this task using existing partial files where possible."
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
              <AlertDescription>{error || task.lastError}</AlertDescription>
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

function App() {
  const appearance = useAppearance();
  const [view, setView] = useState<View>("search");
  const [query, setQuery] = useState("");
  const [searchedQuery, setSearchedQuery] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult[]>([]);
  const searchBrowser = useSearchBrowser(results, searchedQuery !== "");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const selectionStates = useMemo(
    () => treeSelectionStates(searchBrowser.tree, selected),
    [searchBrowser.tree, selected]
  );
  const selectedCount = searchBrowser.entries.filter((entry) => selectionStates.get(entry.encodedUrl) === true).length;
  const [output, setOutput] = useState("~/Downloads/Visuales");
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState<"download" | "queue" | null>(null);
  const [searchError, setSearchError] = useState("");
  const [selectionError, setSelectionError] = useState("");
  const [message, setMessage] = useState("");
  const [taskErrors, setTaskErrors] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [taskQuery, setTaskQuery] = useState("");
  const updates = useAppUpdates();
  const settings = useDesktopSettings();
  const { tasks, refresh, refreshManually, refreshing, connectionError, pending, act } = useTransfers(
    updates.blocksTransfers
  );
  const outputEdited = useRef(false);
  const starting = useRef(false);
  const searchingRef = useRef(false);
  const searchRequest = useRef(0);
  const libraryIndex = useRef<Promise<SearchResult[]> | null>(null);
  const lastRequest = useRef("");
  const searchInput = useRef<HTMLInputElement>(null);
  const searchList = useRef<HTMLDivElement>(null);
  const downloadsList = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef({ search: 0, downloads: 0 });

  useEffect(() => {
    if (!isDesktop()) return;
    let stopped = false;
    const navigate = async () => {
      const id = await invoke<string | null>("take_download_navigation");
      if (stopped || typeof id !== "string") return;
      setFilter("all");
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
    if (view === "settings") return;
    const element = view === "search" ? searchList.current : downloadsList.current;
    if (element) element.scrollTop = scrollPositions.current[view];
  }, [view]);

  const activeTasks = tasks.filter(isActive);
  const runningCount = tasks.filter((task) => task.status === "running").length;
  const queuedCount = tasks.filter((task) => task.status === "queued").length;
  const failedCount = tasks.filter((task) => task.status === "failed").length;
  const totalSpeed = activeTasks.reduce((total, task) => total + (taskSpeedBytes(task) ?? 0), 0);
  const visibleTasks = useMemo(
    () =>
      tasks.filter((task) => {
        const matches =
          filter === "all" ||
          (filter === "active" && isActive(task)) ||
          (filter === "attention" && ["failed", "interrupted"].includes(task.status)) ||
          (filter === "completed" && task.status === "completed");
        return matches && `${taskName(task)} ${task.output} ${task.id}`.toLowerCase().includes(taskQuery.toLowerCase());
      }),
    [tasks, filter, taskQuery]
  );

  function switchView(next: View) {
    const element = view === "search" ? searchList.current : downloadsList.current;
    if (element && view !== "settings") scrollPositions.current[view] = element.scrollTop;
    setView(next);
  }

  function showFailures() {
    setFilter("attention");
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
          invoke<{ results: SearchResult[] }>("search_content", { terms: [], noCache: false }).then(
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
        response = (await invoke<{ results: SearchResult[] }>("search_content", { terms, noCache: false })).results;
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
    searchList.current?.querySelector<HTMLElement>('[role="checkbox"]')?.focus({ preventScroll: true });
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

  async function startDownload(queue: boolean) {
    if (!selected.size || !output.trim() || starting.current || searchingRef.current || updates.blocksTransfers) return;
    starting.current = true;
    setSubmitting(queue ? "queue" : "download");
    setSelectionError("");
    setMessage("");
    try {
      await invoke("start_download", {
        urls: distinctDownloadUrls(selected),
        output: outputEdited.current ? output.trim() : undefined,
        queue,
      });
      clearSelection();
      setMessage(queue ? "Transfer added to queue" : "Transfer started");
      await refresh(true);
    } catch (error) {
      setSelectionError(String(error));
    } finally {
      starting.current = false;
      setSubmitting(null);
    }
  }

  async function taskAction(
    command: "resume_download_task" | "cancel_download_task" | "delete_download_task",
    id: string
  ) {
    setTaskErrors((current) => ({ ...current, [id]: "" }));
    try {
      await act(command, id);
    } catch (error) {
      setTaskErrors((current) => ({ ...current, [id]: String(error) }));
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
      pending={pending.has(task.id)}
      actionsBlocked={updates.blocksTransfers}
      error={taskErrors[task.id]}
      onAction={(command, id) => void taskAction(command, id)}
      onOpen={() => void openOutputFolder(task.output, task.id)}
    />
  );

  return (
    <Tabs value={view} onValueChange={(value) => switchView(value as View)} render={<main />} className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">
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
        </TabsList>
      </header>

      <AppUpdatesPanel updates={updates} activeTransfers={activeTasks.length > 0} />

      {connectionError && !updates.blocksTransfers && (
        <Alert variant="destructive" className="connection-error">
          <AlertCircle size={15} />
          <AlertDescription>{connectionError}</AlertDescription>
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
            <AlertDescription>{searchError}</AlertDescription>
            <Button
              variant="link"
              disabled={searching || Boolean(submitting)}
              onClick={() => void loadSearch(lastRequest.current)}
            >
              Retry
            </Button>
          </Alert>
        )}
        {searchedQuery !== null && results.length > 0 && (
          <div className="results-toolbar">
            <Label className="select-all">
              <SelectAll
                count={selectedCount}
                total={searchBrowser.entries.length}
                disabled={searching || Boolean(submitting)}
                onChange={() => {
                  setSelected(
                    selectedCount === searchBrowser.entries.length
                      ? new Set()
                      : new Set(searchBrowser.entries.map((result) => result.encodedUrl))
                  );
                }}
              />
              <span>
                {results.length} {searchedQuery === "" ? "items" : "results"}
                {searchBrowser.entries.length > results.length
                  ? ` · ${searchBrowser.entries.length - results.length} browsed`
                  : ""}
              </span>
            </Label>
            <span className="secondary truncate" role="status">
              {searchedQuery === "" ? "Library" : query.trim() !== searchedQuery ? `for "${searchedQuery}"` : ""}
            </span>
            {message && (
              <Alert className="success-message" role="status">
                <Check size={14} />
                {message}
              </Alert>
            )}
          </div>
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
              setSelected={setSelected}
              disabled={searching || Boolean(submitting)}
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
                <AlertDescription>{selectionError}</AlertDescription>
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
              {filter === "all" && !taskQuery ? tasks.length : `${visibleTasks.length} of ${tasks.length}`}
            </span>
          </div>
          <InputGroup className="filter-field">
            <InputGroupAddon>
              <Search size={16} />
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              value={taskQuery}
              onChange={(event) => setTaskQuery(event.target.value)}
              placeholder="Filter downloads"
              aria-label="Filter downloads"
            />
          </InputGroup>
          <Select
            items={statusFilters}
            value={filter}
            onValueChange={(value) => {
              if (value) setFilter(value);
            }}
          >
            <SelectTrigger aria-label="Download status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false} align="start">
              {statusFilters.map(({ value, label }) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
        <div className="list-scroll downloads-list" ref={downloadsList}>
          {visibleTasks.length > 0 ? (
            <Table aria-label="Downloads">
              <TransferTableHead />
              <TableBody>{visibleTasks.map(row)}</TableBody>
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
                    setFilter("all");
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
        <SettingsView controller={settings} updates={updates} appearance={appearance} />
      </TabsContent>
    </Tabs>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <IconTooltipProvider>
      {new URLSearchParams(window.location.search).has("tray") ? <TrayPopup /> : <App />}
    </IconTooltipProvider>
  </React.StrictMode>
);
