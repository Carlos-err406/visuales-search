import { useEffect, useRef, useState, type FormEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { AlertCircle, Check, FolderOpen, Info, RefreshCw, RotateCcw, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupInput, InputGroupAddon } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { IconButton } from "./icon-button";
import { isDesktop } from "./use-transfers";
import type { useDesktopSettings } from "./use-desktop-settings";
import { desktopSettingsLimits, type DesktopSettings } from "@visuales/core/desktop-settings-types";
import { downloadDefaults } from "@visuales/core/download/defaults";
import { AppUpdatesSettings } from "./app-updates";
import type { AppUpdates } from "./use-app-updates";

type Draft = { output: string; concurrent: string; connections: string; maxRetries: string };
const toDraft = (settings: DesktopSettings): Draft => ({
  output: settings.output,
  concurrent: String(settings.concurrent),
  connections: String(settings.connections),
  maxRetries: String(settings.maxRetries),
});

export function SettingsView({
  controller,
  updates,
}: {
  controller: ReturnType<typeof useDesktopSettings>;
  updates: AppUpdates;
}) {
  const { snapshot, loading, error, saving, save, reload } = controller;
  const [draft, setDraft] = useState<Draft>(() => toDraft({ output: "", ...downloadDefaults }));
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(false);
  const [picking, setPicking] = useState(false);
  const pickerBusy = useRef(false);

  useEffect(() => {
    if (snapshot) setDraft(toDraft(snapshot.settings));
  }, [snapshot]);
  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(false), 4000);
    return () => window.clearTimeout(timer);
  }, [saved]);

  const stored = snapshot ? toDraft(snapshot.settings) : null;
  const dirty = Boolean(
    stored && Object.keys(draft).some((key) => draft[key as keyof Draft] !== stored[key as keyof Draft])
  );
  const errors: Partial<Record<keyof Draft, string>> = {};
  if (!draft.output.trim()) errors.output = "Enter an output folder.";
  else if (!/^(?:\/|[A-Za-z]:[\\/]|\\\\|~(?:[\\/]|$))/.test(draft.output.trim()))
    errors.output = "Use an absolute path or ~/Downloads/Visuales.";
  for (const key of ["concurrent", "connections", "maxRetries"] as const) {
    const { min, max } = desktopSettingsLimits[key];
    const value = Number(draft[key]);
    if (!draft[key].trim() || !Number.isInteger(value) || value < min || value > max)
      errors[key] = `Enter a whole number from ${min} to ${max}.`;
  }

  function edit(key: keyof Draft, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
    setSaved(false);
    setSaveError("");
  }

  async function chooseFolder() {
    if (pickerBusy.current) return;
    pickerBusy.current = true;
    setPicking(true);
    setSaveError("");
    try {
      if (!isDesktop()) throw new Error("Open the desktop app to choose a folder.");
      const folder = await open({ directory: true, multiple: false });
      if (typeof folder === "string") edit("output", folder);
    } catch (error) {
      setSaveError(String(error));
    } finally {
      pickerBusy.current = false;
      setPicking(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!dirty || Object.keys(errors).length || saving || picking) return;
    setSaveError("");
    try {
      await save({
        output: draft.output.trim(),
        concurrent: Number(draft.concurrent),
        maxRetries: Number(draft.maxRetries),
        connections: Number(draft.connections),
      });
      setSaved(true);
    } catch (error) {
      setSaveError(String(error));
    }
  }

  if (loading)
    return (
      <div className="settings-loading">
        <span role="status">
          <Spinner /> Loading settings
        </span>
        <AppUpdatesSettings updates={updates} />
      </div>
    );
  if (error || !snapshot)
    return (
      <div className="settings-loading">
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{error || "Settings are unavailable."}</AlertDescription>
        </Alert>
        <Button variant="outline" onClick={reload}>
          <RefreshCw /> Retry
        </Button>
        <AppUpdatesSettings updates={updates} />
      </div>
    );

  return (
    <form className="settings-form" onSubmit={(event) => void submit(event)} noValidate>
      <div className="settings-heading">
        <h2>Settings</h2>
        <span className="secondary">Desktop download defaults</span>
      </div>
      <div className="settings-scroll">
        <fieldset disabled={saving || picking} className="settings-fields">
          <section className="settings-section" aria-labelledby="destination-heading">
            <h3 id="destination-heading">Destination</h3>
            <div className="settings-row settings-output-row">
              <Label htmlFor="settings-output">Default output folder</Label>
              <div className="settings-control">
                <InputGroup>
                  <InputGroupInput
                    id="settings-output"
                    value={draft.output}
                    onChange={(event) => edit("output", event.target.value)}
                    aria-invalid={Boolean(errors.output)}
                    aria-describedby={errors.output ? "settings-output-error" : undefined}
                  />
                  <InputGroupAddon align="inline-end">
                    <IconButton
                      label="Choose default output folder"
                      disabled={saving || picking}
                      disabledReason="Wait for the current settings operation to finish."
                      description="Choose the parent folder for new desktop downloads."
                      onClick={() => void chooseFolder()}
                    >
                      {picking ? <Spinner /> : <FolderOpen size={16} />}
                    </IconButton>
                  </InputGroupAddon>
                </InputGroup>
                {errors.output && (
                  <span className="settings-field-error" id="settings-output-error">
                    {errors.output}
                  </span>
                )}
              </div>
            </div>
          </section>
          <section className="settings-section" aria-labelledby="transfers-heading">
            <h3 id="transfers-heading">Transfers</h3>
            <div className="settings-row">
              <Label htmlFor="settings-concurrent">Concurrent files</Label>
              <div className="settings-control settings-number">
                <Input
                  id="settings-concurrent"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={32}
                  step={1}
                  value={draft.concurrent}
                  onChange={(event) => edit("concurrent", event.target.value)}
                  aria-invalid={Boolean(errors.concurrent)}
                  aria-describedby={errors.concurrent ? "settings-concurrent-error" : undefined}
                />
                {errors.concurrent && (
                  <span className="settings-field-error" id="settings-concurrent-error">
                    {errors.concurrent}
                  </span>
                )}
              </div>
            </div>
            <div className="settings-row">
              <div className="settings-label">
                <Label htmlFor="settings-connections">Connections per file</Label>
                <IconButton
                  label="About connections per file"
                  description="Maximum parallel connections for each file. Small files, legacy partial files, and servers without reliable byte ranges use one connection."
                >
                  <Info size={14} />
                </IconButton>
              </div>
              <div className="settings-control settings-number">
                <Input
                  id="settings-connections"
                  type="number"
                  inputMode="numeric"
                  min={desktopSettingsLimits.connections.min}
                  max={desktopSettingsLimits.connections.max}
                  step={1}
                  value={draft.connections}
                  onChange={(event) => edit("connections", event.target.value)}
                  aria-invalid={Boolean(errors.connections)}
                  aria-describedby={errors.connections ? "settings-connections-error" : undefined}
                />
                {errors.connections && (
                  <span className="settings-field-error" id="settings-connections-error">
                    {errors.connections}
                  </span>
                )}
              </div>
            </div>
            <div className="settings-row">
              <Label htmlFor="settings-retries">Retries per file</Label>
              <div className="settings-control settings-number">
                <Input
                  id="settings-retries"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={20}
                  step={1}
                  value={draft.maxRetries}
                  onChange={(event) => edit("maxRetries", event.target.value)}
                  aria-invalid={Boolean(errors.maxRetries)}
                  aria-describedby={errors.maxRetries ? "settings-retries-error" : undefined}
                />
                {errors.maxRetries && (
                  <span className="settings-field-error" id="settings-retries-error">
                    {errors.maxRetries}
                  </span>
                )}
              </div>
            </div>
          </section>
        </fieldset>
        <AppUpdatesSettings updates={updates} />
        {saveError && (
          <Alert variant="destructive" className="settings-save-error">
            <AlertCircle />
            <AlertDescription>{saveError}</AlertDescription>
          </Alert>
        )}
      </div>
      <footer className="settings-footer">
        <Button
          type="button"
          variant="ghost"
          disabled={saving || picking}
          onClick={() => {
            setDraft(toDraft(snapshot.defaults));
            setSaveError("");
            setSaved(false);
          }}
        >
          <RotateCcw size={15} /> Restore defaults
        </Button>
        <span className="settings-save-status" role="status">
          {saving ? (
            "Saving..."
          ) : saved ? (
            <>
              <Check size={14} /> Saved
            </>
          ) : dirty ? (
            "Unsaved changes"
          ) : (
            ""
          )}
        </span>
        <div className="settings-actions">
          <Button
            type="button"
            variant="outline"
            disabled={!dirty || saving || picking}
            onClick={() => {
              setDraft(toDraft(snapshot.settings));
              setSaveError("");
              setSaved(false);
            }}
          >
            <X size={15} /> Discard
          </Button>
          <Button
            type="submit"
            disabled={!dirty || saving || picking || Boolean(Object.keys(errors).length) || !isDesktop()}
          >
            {saving ? <Spinner /> : <Save size={15} />} Save changes
          </Button>
        </div>
      </footer>
    </form>
  );
}
