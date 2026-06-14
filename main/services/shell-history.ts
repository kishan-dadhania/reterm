/**
 * Shell History Importer
 *
 * Parses ~/.zsh_history and ~/.bash_history and inserts unique entries.
 */

import fs from "fs/promises";
import os from "os";
import path from "path";
import crypto from "crypto";

import { CommandEntry } from "./types.js";
import { listEntries, bulkInsertEntries } from "./history-store.js";
import { ipcMain } from "@glaze/core/backend";

export type ShellSource = "zsh" | "bash" | "auto";

// ── Parsers ────────────────────────────────────────────────────────────────

interface ParsedLine {
  command: string;
  timestamp: number; // epoch ms; 0 when unknown
}

/** Parse zsh extended history format (`: <epoch>:<dur>;<command>`) plus plain lines. */
function parseZshHistory(raw: string): ParsedLine[] {
  const lines = raw.split("\n");
  const results: ParsedLine[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    // Extended format: `: 1234567890:0;command text`
    const extMatch = /^: (\d+):\d+;(.*)$/.exec(line);
    if (extMatch) {
      const epochSec = parseInt(extMatch[1], 10);
      let command = extMatch[2];
      // Multi-line commands are continued with a backslash
      while (command.endsWith("\\") && i + 1 < lines.length) {
        i++;
        command = command.slice(0, -1) + "\n" + lines[i];
      }
      results.push({ command: command.trim(), timestamp: epochSec * 1000 });
    } else {
      // Plain line
      results.push({ command: line.trim(), timestamp: 0 });
    }
  }
  return results.filter((l) => l.command.length > 0);
}

/** Parse bash history — plain lines, no timestamps (unless HISTTIMEFORMAT used). */
function parseBashHistory(raw: string): ParsedLine[] {
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"))
    .map((command) => ({ command, timestamp: 0 }));
}

// ── Deduplication ──────────────────────────────────────────────────────────

function dedupKey(command: string, timestamp: number): string {
  return `${timestamp}::${command}`;
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function importShellHistory(source: ShellSource): Promise<number> {
  const home = os.homedir();

  // Determine which files to parse
  const filesToParse: { filePath: string; type: "zsh" | "bash" }[] = [];

  if (source === "auto" || source === "zsh") {
    filesToParse.push({ filePath: path.join(home, ".zsh_history"), type: "zsh" });
  }
  if (source === "auto" || source === "bash") {
    filesToParse.push({ filePath: path.join(home, ".bash_history"), type: "bash" });
  }

  // Build dedup set from existing shell-import entries
  const allExisting = await listEntries({ limit: 1_000_000 });
  const existingImports = allExisting.filter((e) => e.source === "shell-import");
  const existingKeys = new Set(existingImports.map((e) => dedupKey(e.command, e.timestamp)));

  const newEntries: CommandEntry[] = [];

  for (const { filePath, type } of filesToParse) {
    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf-8");
    } catch {
      // File not found or unreadable — skip
      continue;
    }

    let fileMtime = Date.now();
    try {
      const stat = await fs.stat(filePath);
      fileMtime = stat.mtimeMs;
    } catch {
      // Ignore
    }

    const parsed = type === "zsh" ? parseZshHistory(raw) : parseBashHistory(raw);

    // Estimate timestamps for commands with timestamp 0 (plain lines/bash history)
    let currentFallback = fileMtime;
    for (let idx = parsed.length - 1; idx >= 0; idx--) {
      if (parsed[idx].timestamp === 0) {
        parsed[idx].timestamp = currentFallback;
        currentFallback -= 1000; // sequence backward by 1 second
      } else {
        currentFallback = Math.min(currentFallback, parsed[idx].timestamp - 1000);
      }
    }

    for (const { command, timestamp } of parsed) {
      const key = dedupKey(command, timestamp);
      if (existingKeys.has(key)) continue;
      existingKeys.add(key); // prevent dupes within this import batch

      newEntries.push({
        id: crypto.randomUUID(),
        command,
        cwd: "",
        timestamp,
        exitCode: null,
        durationMs: null,
        source: "shell-import",
        labels: [],
        saved: false,
      });
    }
  }

  if (newEntries.length === 0) {
    console.log("[reterm:import]", { source, imported: 0 });
    return 0;
  }

  // Sort by timestamp descending so newest-first order is preserved when prepending
  newEntries.sort((a, b) => b.timestamp - a.timestamp);

  const imported = await bulkInsertEntries(newEntries);
  ipcMain.broadcast("history:changed", {});

  console.log("[reterm:import]", { source, imported });
  return imported;
}
