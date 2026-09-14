import { isActive, type Task } from "./task-view";
import { compareTransferOrder } from "@visuales/core/download/queue-order";

export type TrayFilter = "active" | "all" | Task["status"];
export const trayFilters: { value: TrayFilter; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "running", label: "Running" },
  { value: "queued", label: "Queued" },
  { value: "interrupted", label: "Interrupted" },
  { value: "failed", label: "Failed" },
  { value: "completed", label: "Completed" },
];

export function selectTrayTasks(tasks: Task[], filter: TrayFilter): Task[] {
  return tasks
    .filter((task) => filter === "all" || (filter === "active" ? isActive(task) : task.status === filter))
    .sort(compareTransferOrder);
}
