import { useState, type ReactElement } from "react";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { invoke } from "@tauri-apps/api/core";
import {
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  Image,
  ListPlus,
  RefreshCw,
  SquareArrowOutUpRight,
} from "lucide-react";
import { previewKind } from "@visuales/core/library-types";

export function LibraryContextMenu({
  children,
  url,
  directory,
  targets,
  disabled,
  transfersBlocked,
  onTransfer,
  onRefresh,
  onError,
}: {
  children: ReactElement;
  url: string;
  directory: boolean;
  targets: () => string[];
  disabled: boolean;
  transfersBlocked: boolean;
  onTransfer: (urls: string[], queue: boolean) => void;
  onRefresh: () => void;
  onError: (message: string) => void;
}) {
  const [selection, setSelection] = useState([url]);
  const [local, setLocal] = useState(false);
  const [opened, setOpened] = useState(false);
  const preview = !directory && previewKind(url);
  const multiple = selection.length > 1;
  function action(operation: () => Promise<unknown>) {
    void operation().catch((error) => onError(String(error)));
  }
  return (
    <ContextMenu
      onOpenChange={(open) => {
        setOpened(open);
        if (!open) return;
        setSelection(targets());
        setLocal(false);
        if (!directory) action(async () => setLocal(await invoke<boolean>("has_downloaded_library_file", { url })));
      }}
    >
      <ContextMenuTrigger render={children} />
      <ContextMenuContent
        className="library-menu"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        {!multiple && preview && (
          <>
            <ContextMenuItem disabled={disabled} onClick={() => action(() => invoke("open_library_window", { url }))}>
              <Image size={16} />
              Open Preview
            </ContextMenuItem>
            <ContextMenuItem
              disabled={disabled}
              onClick={() => action(() => invoke("open_library_window", { url, background: true }))}
            >
              <SquareArrowOutUpRight size={16} />
              Open Preview in Background
            </ContextMenuItem>
          </>
        )}
        {!multiple && directory && (
          <ContextMenuItem disabled={disabled} onClick={() => action(() => invoke("open_library_window", { url }))}>
            <ExternalLink size={16} />
            Open Folder in New Window
          </ContextMenuItem>
        )}
        {!multiple && (preview || directory) && <ContextMenuSeparator />}
        <ContextMenuItem disabled={disabled || transfersBlocked} onClick={() => onTransfer(selection, false)}>
          <Download size={16} />
          {multiple ? `Download ${selection.length} Items` : "Download Now"}
        </ContextMenuItem>
        <ContextMenuItem disabled={disabled || transfersBlocked} onClick={() => onTransfer(selection, true)}>
          <ListPlus size={16} />
          {multiple ? `Queue ${selection.length} Items` : "Add to Queue"}
        </ContextMenuItem>
        <ContextMenuSeparator />
        {!multiple && directory && (
          <ContextMenuItem disabled={disabled} onClick={onRefresh}>
            <RefreshCw size={16} />
            Refresh Folder Contents
          </ContextMenuItem>
        )}
        {!multiple && preview && (
          <ContextMenuItem
            disabled={disabled}
            onClick={() => action(() => invoke("open_library_window", { url, refresh: true }))}
          >
            <RefreshCw size={16} />
            Reload Preview
          </ContextMenuItem>
        )}
        <ContextMenuItem onClick={() => action(() => navigator.clipboard.writeText(selection.join("\n")))}>
          <Copy size={16} />
          {multiple ? "Copy Links" : "Copy Link"}
        </ContextMenuItem>
        {opened && local && !multiple && (
          <ContextMenuItem onClick={() => action(() => invoke("reveal_library_file", { url }))}>
            <FolderOpen size={16} />
            Show Downloaded File
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
