import { useState, type MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowUpRight } from "lucide-react";
import { AppUpdatesSettings } from "./app-updates";
import type { AppUpdates } from "./use-app-updates";
import { isDesktop } from "./use-transfers";
import appIcon from "../app-icon.svg?no-inline";
import license from "../../../LICENSE?raw";

export function AboutView({ updates }: { updates: AppUpdates }) {
  const [linkError, setLinkError] = useState("");
  async function openProject(event: MouseEvent<HTMLAnchorElement>) {
    if (!isDesktop()) return;
    event.preventDefault();
    setLinkError("");
    try {
      await invoke("open_project_page");
    } catch (error) {
      setLinkError(`Could not open GitHub: ${String(error)}`);
    }
  }

  return (
    <section className="about-panel" aria-labelledby="about-title">
      <div className="about-identity">
        <img src={appIcon} alt="" width={64} height={64} />
        <h2 id="about-title">Visuales</h2>
        <div className="about-author">
          <span>Created by</span>
          <p>Carlos Daniel Vilaseca Illnait</p>
        </div>
        <a
          className="about-project-link"
          href="https://github.com/Carlos-err406/visuales-search"
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => void openProject(event)}
        >
          View on GitHub <ArrowUpRight size={16} aria-hidden="true" />
        </a>
        {linkError && (
          <p className="app-update-error" role="alert">
            {linkError}
          </p>
        )}
      </div>
      <details className="about-license">
        <summary>MIT License</summary>
        <pre>{license}</pre>
      </details>
      <AppUpdatesSettings updates={updates} />
    </section>
  );
}
