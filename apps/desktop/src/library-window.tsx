import { useEffect, useState, type ReactNode } from "react";
import { messageForDisplay } from "@visuales/core/uri-display";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FilePreview } from "./file-preview";
import { useAppearance } from "./use-appearance";
import { Spinner } from "@/components/ui/spinner";

export interface LibraryResource {
  url: string;
  name: string;
  kind: "preview" | "folder";
  revision: number;
}

export function LibraryWindow({ renderFolder }: { renderFolder: (resource: LibraryResource) => ReactNode }) {
  useAppearance();
  const [resource, setResource] = useState<LibraryResource | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let stopped = false;
    const read = async () => {
      const value = await invoke<LibraryResource | null>("library_window_context");
      if (!stopped) {
        if (!value) setError("This library window is no longer available.");
        else setResource(value);
      }
    };
    const stop = listen("library-window-changed", () => void read().catch((reason) => setError(String(reason))));
    void stop.then(read).catch((reason) => {
      if (!stopped) setError(String(reason));
    });
    return () => {
      stopped = true;
      void stop.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);
  if (error)
    return (
      <main className="auxiliary-window">
        <p role="alert">{messageForDisplay(error)}</p>
      </main>
    );
  if (!resource)
    return (
      <main className="auxiliary-window">
        <span role="status">
          <Spinner />
          Opening window
        </span>
      </main>
    );
  return resource.kind === "preview" ? <FilePreview key={resource.url} file={resource} /> : renderFolder(resource);
}
