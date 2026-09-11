import { isActive, type Task } from "./task-view";

export type TrayFilter = "active" | "all" | Task["status"];
export const trayFilters: { value: TrayFilter; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "all", label: "All statuses" },
  { value: "running", label: "Running" },
  { value: "queued", label: "Queued" },
  { value: "interrupted", label: "Interrupted" },
  { value: "failed", label: "Failed" },
  { value: "completed", label: "Completed" },
];

export function selectTrayTasks(tasks: Task[], filter: TrayFilter): Task[] {
  const group = (task: Task) => (task.status === "running" ? 0 : task.status === "queued" ? 1 : 2);
  return tasks
    .filter((task) => filter === "all" || (filter === "active" ? isActive(task) : task.status === filter))
    .sort(
      (a, b) =>
        group(a) - group(b) ||
        (isActive(a) ? (a.queuedAt ?? a.createdAt) - (b.queuedAt ?? b.createdAt) : b.updatedAt - a.updatedAt) ||
        a.id.localeCompare(b.id)
    );
}
