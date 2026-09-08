import { execFileSync } from "node:child_process";
import { win32 } from "node:path";

export interface ProcessRow {
  pid: number;
  command: string;
}

export function getProcessRows(
  platform: NodeJS.Platform = process.platform,
  execute: typeof execFileSync = execFileSync
): ProcessRow[] {
  const options = {
    encoding: "utf8",
    timeout: 5000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
    stdio: "pipe",
  } as const;
  try {
    if (platform === "win32") {
      const powershell = win32.join(
        process.env.SystemRoot || "C:\\Windows",
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe"
      );
      // Fixed script only: never interpolate task URLs into executable commands.
      const script =
        "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); Get-CimInstance -ClassName Win32_Process -ErrorAction Stop | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress";
      const output = execute(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], options);
      const value: unknown = JSON.parse(output.trim() || "[]");
      return (Array.isArray(value) ? value : [value]).flatMap((item: unknown) => {
        if (!item || typeof item !== "object") return [];
        const row = item as Record<string, unknown>;
        if (
          typeof row.ProcessId !== "number" ||
          !Number.isSafeInteger(row.ProcessId) ||
          row.ProcessId <= 0 ||
          typeof row.CommandLine !== "string" ||
          !row.CommandLine.trim()
        )
          return [];
        return [{ pid: row.ProcessId, command: row.CommandLine }];
      });
    }
    return execute("ps", ["-ww", "-axo", "pid=,command="], options)
      .split("\n")
      .flatMap((line) => {
        const match = /^(\d+)\s+(.+)$/.exec(line.trim());
        return match ? [{ pid: Number(match[1]), command: match[2] }] : [];
      });
  } catch {
    return [];
  }
}
