/**
 * Reterm IPC Handlers
 *
 * Implements the full IPC contract for terminal execution, history, and settings.
 */

import { ipcMain } from "@glaze/core/backend";

import { executeCommand, getSessionCwd, interruptCommand } from "../services/command-runner.js";
import {
  listEntries,
  updateEntry,
  deleteEntry,
  getDistinctLabels,
} from "../services/history-store.js";
import { loadSettings, saveSettings } from "../services/history-store.js";
import { importShellHistory } from "../services/shell-history.js";

// ── Input type guards ──────────────────────────────────────────────────────

function assertString(value: unknown, name: string): string {
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  return value;
}

function assertOptionalString(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return assertString(value, name);
}

function assertOptionalBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw new Error(`${name} must be a boolean`);
  return value;
}

function assertOptionalNumber(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number") throw new Error(`${name} must be a number`);
  return value;
}

function assertStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
    throw new Error(`${name} must be an array of strings`);
  }
  return value as string[];
}

// ── Handler registration ───────────────────────────────────────────────────

export function registerRetermHandlers(): void {
  // ── terminal:execute ─────────────────────────────────────────────────
  ipcMain.handle("terminal:execute", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    const command = assertString(p?.command, "command");
    const id = await executeCommand(command);
    return { id };
  });

  // ── terminal:cwd ─────────────────────────────────────────────────────
  ipcMain.handle("terminal:cwd", async (_event, _params: unknown) => {
    return { cwd: getSessionCwd() };
  });

  // ── terminal:interrupt ────────────────────────────────────────────────
  ipcMain.handle("terminal:interrupt", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    const id = assertString(p?.id, "id");
    const ok = interruptCommand(id);
    return { ok };
  });

  // ── history:list ──────────────────────────────────────────────────────
  ipcMain.handle("history:list", async (_event, params: unknown) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const entries = await listEntries({
      search: assertOptionalString(p.search, "search"),
      label: assertOptionalString(p.label, "label"),
      savedOnly: assertOptionalBoolean(p.savedOnly, "savedOnly"),
      limit: assertOptionalNumber(p.limit, "limit"),
    });
    return { entries };
  });

  // ── history:save ──────────────────────────────────────────────────────
  ipcMain.handle("history:save", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    const id = assertString(p?.id, "id");
    if (typeof p?.saved !== "boolean") throw new Error("saved must be a boolean");
    const entry = await updateEntry(id, { saved: p.saved as boolean });
    if (!entry) throw new Error(`Entry not found: ${id}`);
    ipcMain.broadcast("history:changed", {});
    return { entry };
  });

  // ── history:setLabels ─────────────────────────────────────────────────
  ipcMain.handle("history:setLabels", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    const id = assertString(p?.id, "id");
    const labels = assertStringArray(p?.labels, "labels");
    const entry = await updateEntry(id, { labels });
    if (!entry) throw new Error(`Entry not found: ${id}`);
    ipcMain.broadcast("history:changed", {});
    return { entry };
  });

  // ── history:delete ────────────────────────────────────────────────────
  ipcMain.handle("history:delete", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    const id = assertString(p?.id, "id");
    const ok = await deleteEntry(id);
    if (ok) ipcMain.broadcast("history:changed", {});
    return { ok };
  });

  // ── history:labels ────────────────────────────────────────────────────
  ipcMain.handle("history:labels", async (_event, _params: unknown) => {
    const labels = await getDistinctLabels();
    return { labels };
  });

  // ── history:importShell ───────────────────────────────────────────────
  ipcMain.handle("history:importShell", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    const rawSource = assertString(p?.source, "source");
    if (rawSource !== "zsh" && rawSource !== "bash" && rawSource !== "auto") {
      throw new Error('source must be "zsh", "bash", or "auto"');
    }
    const imported = await importShellHistory(rawSource);
    return { imported };
  });

  // ── settings:get ──────────────────────────────────────────────────────
  ipcMain.handle("settings:get", async (_event, _params: unknown) => {
    const settings = await loadSettings();
    return { retentionDays: settings.retentionDays };
  });

  // ── settings:set ──────────────────────────────────────────────────────
  ipcMain.handle("settings:set", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    const retentionDays = assertOptionalNumber(p?.retentionDays, "retentionDays");
    if (retentionDays === undefined || retentionDays < 1) {
      throw new Error("retentionDays must be a positive number");
    }
    const settings = await loadSettings();
    const updated = { ...settings, retentionDays };
    await saveSettings(updated);
    ipcMain.broadcast("settings:retention-changed", { retentionDays });
    return { retentionDays };
  });
}
