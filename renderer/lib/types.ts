export interface CommandEntry {
  id: string;
  command: string;
  cwd: string;
  timestamp: number;
  exitCode: number | null;
  durationMs: number | null;
  source: "terminal" | "shell-import";
  labels: string[];
  saved: boolean;
}

export interface TerminalBlock {
  id: string;
  command: string;
  cwd: string;
  chunks: { text: string; stream: "stdout" | "stderr" }[];
  exitCode: number | null;
  durationMs: number | null;
  running: boolean;
}

export interface ProjectEntry {
  path: string;
  type: "git" | "mount" | "recent";
  name: string;
}

