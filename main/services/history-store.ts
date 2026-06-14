/**
 * History Store — JSON persistence for CommandEntry records.
 *
 * Persists to userData/reterm-history.json.
 * Settings (retentionDays) persisted to userData/reterm-settings.json.
 */

import fs from "fs/promises";
import path from "path";

import { app } from "@glaze/core/backend";

import { CommandEntry, RetermSettings, DEFAULT_SETTINGS } from "./types.js";

// ── Internals ──────────────────────────────────────────────────────────────

let historyCache: CommandEntry[] | null = null;
let settingsCache: RetermSettings | null = null;
let dataDir: string | null = null;

async function getDataDir(): Promise<string> {
  if (dataDir) return dataDir;
  const userData = await app.getPath("userData");
  await fs.mkdir(userData, { recursive: true });
  dataDir = userData;
  return dataDir;
}

async function historyPath(): Promise<string> {
  return path.join(await getDataDir(), "reterm-history.json");
}

async function settingsPath(): Promise<string> {
  return path.join(await getDataDir(), "reterm-settings.json");
}

// ── Settings ───────────────────────────────────────────────────────────────

export async function loadSettings(): Promise<RetermSettings> {
  if (settingsCache) return settingsCache;
  try {
    const raw = await fs.readFile(await settingsPath(), "utf-8");
    settingsCache = { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<RetermSettings>) };
  } catch {
    settingsCache = { ...DEFAULT_SETTINGS };
  }
  return settingsCache;
}

export async function saveSettings(settings: RetermSettings): Promise<void> {
  settingsCache = settings;
  await fs.writeFile(await settingsPath(), JSON.stringify(settings, null, 2));
}

// ── History ────────────────────────────────────────────────────────────────

async function loadHistory(): Promise<CommandEntry[]> {
  if (historyCache) return historyCache;
  try {
    const raw = await fs.readFile(await historyPath(), "utf-8");
    historyCache = JSON.parse(raw) as CommandEntry[];
  } catch {
    historyCache = [];
  }
  return historyCache;
}

async function persistHistory(): Promise<void> {
  if (!historyCache) return;
  await fs.writeFile(await historyPath(), JSON.stringify(historyCache, null, 2));
}

/** Remove entries older than retentionDays that are not saved. */
async function runRetentionCleanup(): Promise<void> {
  const settings = await loadSettings();
  const entries = await loadHistory();
  const cutoff = Date.now() - settings.retentionDays * 24 * 60 * 60 * 1000;
  const before = entries.length;
  historyCache = entries.filter((e) => e.saved || e.timestamp >= cutoff);
  if (historyCache.length !== before) {
    await persistHistory();
  }
}

/** Call once at startup. */
export async function initHistoryStore(): Promise<void> {
  await loadHistory();
  await runRetentionCleanup();
}

// ── CRUD ───────────────────────────────────────────────────────────────────

export async function addEntry(entry: CommandEntry): Promise<void> {
  const entries = await loadHistory();
  entries.unshift(entry);
  await persistHistory();
}

export async function updateEntry(
  id: string,
  patch: Partial<CommandEntry>,
): Promise<CommandEntry | null> {
  const entries = await loadHistory();
  const idx = entries.findIndex((e) => e.id === id);
  if (idx === -1) return null;
  entries[idx] = { ...entries[idx], ...patch };
  await persistHistory();
  await runRetentionCleanup();
  return entries.find((e) => e.id === id) ?? null;
}

export async function deleteEntry(id: string): Promise<boolean> {
  const entries = await loadHistory();
  const before = entries.length;
  historyCache = entries.filter((e) => e.id !== id);
  if (historyCache.length === before) return false;
  await persistHistory();
  return true;
}

export interface ListOptions {
  search?: string;
  label?: string;
  savedOnly?: boolean;
  limit?: number;
}

export async function listEntries(options: ListOptions = {}): Promise<CommandEntry[]> {
  const entries = await loadHistory();
  const { search, label, savedOnly, limit = 200 } = options;

  let result = entries;

  if (savedOnly) {
    result = result.filter((e) => e.saved);
  }

  if (label) {
    result = result.filter((e) => e.labels.includes(label));
  }

  if (search) {
    const lower = search.toLowerCase();
    result = result.filter(
      (e) =>
        e.command.toLowerCase().includes(lower) ||
        e.cwd.toLowerCase().includes(lower) ||
        e.labels.some((l) => l.toLowerCase().includes(lower)),
    );
  }

  // Already newest-first (entries are unshifted on insert)
  return result.slice(0, limit);
}

export async function getDistinctLabels(): Promise<string[]> {
  const entries = await loadHistory();
  const set = new Set<string>();
  for (const e of entries) {
    for (const l of e.labels) set.add(l);
  }
  return Array.from(set).sort();
}

/** Bulk-insert entries (used by shell import). Returns number actually inserted. */
export async function bulkInsertEntries(entries: CommandEntry[]): Promise<number> {
  if (entries.length === 0) return 0;
  await loadHistory();
  historyCache = [...entries, ...historyCache!];
  await persistHistory();
  await runRetentionCleanup();
  return entries.length;
}
