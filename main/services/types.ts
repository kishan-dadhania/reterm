import os from "os";

/**
 * Shared types for the Reterm backend services.
 */

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

export interface RetermSettings {
  retentionDays: number;
  mountRoots: string[];
  gitDiscoveryRoots: string[];
}

export interface ProjectEntry {
  path: string;
  type: "git" | "mount" | "recent";
  name: string;
}

export const DEFAULT_SETTINGS: RetermSettings = {
  retentionDays: 60,
  mountRoots: [],
  gitDiscoveryRoots: [os.homedir()],
};


