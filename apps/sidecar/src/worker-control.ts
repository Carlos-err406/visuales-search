import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";

export type ConcurrencyUpdate = { type: "concurrency"; requestId: string; concurrent: number };
export type ConcurrencyReply = { type: "concurrency-updated"; requestId: string; error?: string };

export function setWorkerConcurrency(child: ChildProcess, concurrent: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const requestId = randomUUID();
    let settled = false;
    const timer = setTimeout(() => finish(new Error("Download worker did not acknowledge the new file limit.")), 5000);
    function finish(error?: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener("message", onMessage);
      child.removeListener("exit", onExit);
      child.removeListener("error", onError);
      if (error) reject(error);
      else resolve();
    }
    function onMessage(message: ConcurrencyReply) {
      if (message?.type === "concurrency-updated" && message.requestId === requestId)
        finish(message.error ? new Error(message.error) : undefined);
    }
    function onExit() {
      // A transfer finishing during Settings save no longer needs a runtime update.
      finish();
    }
    function onError(error: Error) {
      finish(error);
    }
    child.on("message", onMessage);
    child.once("exit", onExit);
    child.once("error", onError);
    if (!child.connected) return finish(new Error("Download worker control channel is disconnected."));
    try {
      child.send({ type: "concurrency", requestId, concurrent } satisfies ConcurrencyUpdate, (error) => {
        if (error) finish(error);
      });
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
