import { useEffect, useRef, useState, type FormEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { AlertCircle, Check, FolderOpen, Info, RefreshCw, RotateCcw, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { InputGroup, InputGroupInput, InputGroupAddon } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { IconButton } from "./icon-button";
import { HelpButton, HelpPopover, createHelpHandle } from "./help-button";
import { isDesktop } from "./use-transfers";
import type { useDesktopSettings } from "./use-desktop-settings";
import {
  desktopSettingsLimits,
  normalizeDesktopExclusions,
  type DesktopSettings,
} from "@visuales/core/desktop-settings-types";
import { downloadDefaults } from "@visuales/core/download/defaults";
import { AppUpdatesSettings } from "./app-updates";
import type { AppUpdates } from "./use-app-updates";
import { AppearanceSettings } from "./appearance-settings";
import type { AppearanceController } from "./use-appearance";

type Draft = { output: string; concurrent: string; connections: string; maxRetries: string; exclude: string };
const toDraft = (settings: DesktopSettings): Draft => ({
  output: settings.output,
  concurrent: String(settings.concurrent),
  connections: String(settings.connections),
  maxRetries: String(settings.maxRetries),
  exclude: (settings.exclude ?? []).join("\n"),
});

export function SettingsView({
  controller,
  updates,
  appearance,
}: {
  controller: ReturnType<typeof useDesktopSettings>;
  updates: AppUpdates;
  appearance: AppearanceController;
}) {
  const { snapshot, loading, error, saving, save, reload } = controller;
  const desktop = isDesktop();
  const [draft, setDraft] = useState<Draft>(() => toDraft({ output: "", exclude: [], ...downloadDefaults }));
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(false);
  const [picking, setPicking] = useState(false);
  const [helpHandle] = useState(createHelpHandle);
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
  let exclusions: string[] = [];
  try {
    exclusions = normalizeDesktopExclusions(draft.exclude.split(/\r?\n/).filter((line) => line.trim()));
  } catch (error) {
    errors.exclude = error instanceof Error ? error.message : String(error);
  }
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
    if (!desktop || !dirty || Object.keys(errors).length || saving || picking) return;
    setSaveError("");
    try {
      await save({
        output: draft.output.trim(),
        concurrent: Number(draft.concurrent),
        maxRetries: Number(draft.maxRetries),
        connections: Number(draft.connections),
        exclude: exclusions,
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
        <AppearanceSettings controller={appearance} />
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
        <AppearanceSettings controller={appearance} />
        <AppUpdatesSettings updates={updates} />
      </div>
    );

  return (
    <form className="settings-form" onSubmit={(event) => void submit(event)} noValidate>
      <div className="settings-heading">
        <h2>Settings</h2>
        <span className="settings-save-status" role="status">
          {saved && (
            <>
              <Check size={14} /> Saved
            </>
          )}
        </span>
        <Button
          type="button"
          variant="ghost"
          className="settings-restore"
          disabled={!desktop || saving || picking}
          onClick={() => {
            setDraft(toDraft(snapshot.defaults));
            setSaveError("");
            setSaved(false);
          }}
        >
          <RotateCcw size={15} /> Restore defaults
        </Button>
      </div>
      <div className="settings-scroll">
        <AppearanceSettings controller={appearance} />
        {!desktop && (
          <Alert className="settings-save-error">
            <Info />
            <AlertDescription>Transfer settings are read-only in browser preview.</AlertDescription>
          </Alert>
        )}
        <fieldset disabled={!desktop || saving || picking} className="settings-fields">
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
                      disabled={!desktop || saving || picking}
                      disabledReason={
                        desktop
                          ? "Wait for the current settings operation to finish."
                          : "Folder selection requires the desktop app."
                      }
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
                <HelpButton
                  handle={helpHandle}
                  label="About connections per file"
                  description="Maximum parallel connections for each file. Small files, legacy partial files, and servers without reliable byte ranges use one connection."
                />
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
            <div className="settings-row settings-exclusions-row">
              <div className="settings-label">
                <Label htmlFor="settings-exclude">Ignore rules</Label>
                <HelpButton
                  handle={helpHandle}
                  label="About ignore rules"
                  description="One rule per line, in order. !poster.jpg includes a file again; # starts a comment. Paths are relative to each downloaded folder. To keep a file inside an ignored directory, include its parent first. Explicitly selected files are still downloaded."
                />
              </div>
              <div className="settings-control">
                <Textarea
                  id="settings-exclude"
                  rows={3}
                  spellCheck={false}
                  autoCapitalize="none"
                  autoCorrect="off"
                  placeholder={"*.jpg\n!poster.jpg\n# Keep cover artwork"}
                  value={draft.exclude}
                  onChange={(event) => edit("exclude", event.target.value)}
                  aria-invalid={Boolean(errors.exclude)}
                  aria-describedby={errors.exclude ? "settings-exclude-error" : undefined}
                />
                {errors.exclude && (
                  <span className="settings-field-error" id="settings-exclude-error">
                    {errors.exclude}
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
      {desktop && dirty && (
        <footer className="settings-footer">
          <span className="settings-save-status" role="status">
            {saving ? "Saving..." : "Unsaved changes"}
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
            <Button type="submit" disabled={!dirty || saving || picking || Boolean(Object.keys(errors).length)}>
              {saving ? <Spinner /> : <Save size={15} />} Save changes
            </Button>
          </div>
        </footer>
      )}
      <HelpPopover handle={helpHandle} />
    </form>
  );
}
