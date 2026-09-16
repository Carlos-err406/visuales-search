import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Square } from "lucide-react";
import type { CancelAllDownloadsResult } from "@visuales/core";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { IconButton } from "./icon-button";
import { isActive, type Task } from "./task-view";

export function InterruptAllButton({
  tasks,
  disabled,
  onChanged,
  onPendingChange,
  onOpenChange,
}: {
  tasks: Task[];
  disabled?: boolean;
  onChanged: () => void | Promise<void>;
  onPendingChange: (pending: boolean) => void;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
  const active = tasks.filter(isActive).length;
  function changeOpen(value: boolean) {
    if (busy.current) return;
    setOpen(value);
    onOpenChange?.(value);
    if (value) setError("");
  }
  async function interrupt() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    onPendingChange(true);
    setError("");
    try {
      const result = await invoke<CancelAllDownloadsResult>("cancel_all_downloads");
      if (result.failures.length)
        setError(
          `Could not interrupt ${result.failures.length} transfer(s). ${result.failures.map((item) => `${item.id}: ${item.message}`).join("; ")}`
        );
      else {
        setOpen(false);
        onOpenChange?.(false);
      }
    } catch (reason) {
      setError(String(reason));
    } finally {
      try {
        await onChanged();
      } finally {
        busy.current = false;
        setPending(false);
        onPendingChange(false);
      }
    }
  }
  return (
    <>
      <IconButton
        label="Interrupt all downloads"
        description="Stop all running and queued transfers, including CLI downloads. Partial files are kept."
        disabled={disabled || pending || !active}
        disabledReason={!active ? "No running or queued downloads." : "Wait for transfers to finish updating."}
        onClick={() => changeOpen(true)}
      >
        {pending ? <Spinner size={16} /> : <Square size={16} />}
      </IconButton>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent className="interrupt-dialog" aria-busy={pending}>
          <DialogTitle>Interrupt all downloads?</DialogTitle>
          <DialogDescription>
            Stop all running and queued transfers, including CLI downloads and transfers hidden by filters. Partial
            files are kept so you can resume later.
          </DialogDescription>
          <p className="secondary">
            {active} active {active === 1 ? "transfer" : "transfers"}
          </p>
          {error && (
            <p className="task-error" role="alert">
              {error}
            </p>
          )}
          <footer>
            <Button variant="outline" disabled={pending} onClick={() => changeOpen(false)}>
              Keep downloading
            </Button>
            <Button disabled={pending || !active} onClick={() => void interrupt()}>
              {pending ? <Spinner size={14} aria-hidden="true" /> : <Square size={14} />}
              {pending ? "Interrupting" : "Interrupt all"}
            </Button>
          </footer>
        </DialogContent>
      </Dialog>
    </>
  );
}
