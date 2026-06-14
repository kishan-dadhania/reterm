/**
 * Reterm IPC Handlers
 *
 * Implements the full IPC contract for terminal execution, history, and settings.
 */

import { ipcMain, dialog } from "@glaze/core/backend";

import {
  executeCommand,
  getSessionCwd,
  interruptCommand,
  createSession,
  destroySession,
  listSessions,
  changeCwd,
} from "../services/command-runner.js";
import {
  listEntries,
  updateEntry,
  deleteEntry,
  getDistinctLabels,
  getRecentFolders,
} from "../services/history-store.js";
import { loadSettings, saveSettings } from "../services/history-store.js";
import { importShellHistory } from "../services/shell-history.js";
import { getProjectIndex, invalidateProjectCache } from "../services/project-discovery.js";


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
    const cwd = assertOptionalString(p?.cwd, "cwd");
    const sessionId = assertString(p?.sessionId, "sessionId");
    const id = await executeCommand(sessionId, command, cwd);
    return { id };
  });

  // ── terminal:cwd ─────────────────────────────────────────────────────
  ipcMain.handle("terminal:cwd", async (_event, params: unknown) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const sessionId = assertString(p?.sessionId, "sessionId");
    return { cwd: getSessionCwd(sessionId) };
  });

  // ── terminal:interrupt ────────────────────────────────────────────────
  ipcMain.handle("terminal:interrupt", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    const id = assertString(p?.id, "id");
    const sessionId = assertOptionalString(p?.sessionId, "sessionId");
    const ok = interruptCommand(id, sessionId);
    return { ok };
  });

  // ── terminal:createSession ───────────────────────────────────────────
  ipcMain.handle("terminal:createSession", async (_event, params: unknown) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const sessionId = assertOptionalString(p?.sessionId, "sessionId");
    const initialCwd = assertOptionalString(p?.initialCwd, "initialCwd");
    const id = createSession(sessionId, initialCwd);
    return { id };
  });

  // ── terminal:destroySession ──────────────────────────────────────────
  ipcMain.handle("terminal:destroySession", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    const sessionId = assertString(p?.sessionId, "sessionId");
    destroySession(sessionId);
    return { ok: true };
  });

  // ── terminal:listSessions ────────────────────────────────────────────
  ipcMain.handle("terminal:listSessions", async (_event, _params: unknown) => {
    const list = listSessions();
    return { sessions: list };
  });

  // ── terminal:changeCwd ───────────────────────────────────────────────
  ipcMain.handle("terminal:changeCwd", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    const sessionId = assertString(p?.sessionId, "sessionId");
    const cwd = assertString(p?.cwd, "cwd");
    changeCwd(sessionId, cwd);
    return { ok: true };
  });

  // ── dialog:openFolder ────────────────────────────────────────────────
  ipcMain.handle("dialog:openFolder", async (_event, _params: unknown) => {
    const result = await dialog.showOpenDialog({
      title: "Select Folder",
      properties: ["openDirectory", "createDirectory"],
    });
    return { canceled: result.canceled, folderPaths: result.filePaths };
  });

  // ── history:recentFolders ────────────────────────────────────────────
  ipcMain.handle("history:recentFolders", async (_event, params: unknown) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const limit = assertOptionalNumber(p?.limit, "limit") ?? 20;
    const folders = await getRecentFolders(limit);
    return { folders };
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

  // ── settings:addMountRoot ────────────────────────────────────────────
  ipcMain.handle("settings:addMountRoot", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    const folderPath = assertString(p?.path, "path");
    const settings = await loadSettings();
    const roots = settings.mountRoots || [];
    if (!roots.includes(folderPath)) {
      const updated = { ...settings, mountRoots: [...roots, folderPath] };
      await saveSettings(updated);
      invalidateProjectCache();
      ipcMain.broadcast("settings:roots-changed", {});
      getProjectIndex(true).then(() => {
        ipcMain.broadcast("projects:indexReady", {});
      }).catch(err => console.error(err));
    }
    return { mountRoots: (await loadSettings()).mountRoots || [] };
  });

  // ── settings:removeMountRoot ─────────────────────────────────────────
  ipcMain.handle("settings:removeMountRoot", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    const folderPath = assertString(p?.path, "path");
    const settings = await loadSettings();
    const roots = settings.mountRoots || [];
    const updated = { ...settings, mountRoots: roots.filter(r => r !== folderPath) };
    await saveSettings(updated);
    invalidateProjectCache();
    ipcMain.broadcast("settings:roots-changed", {});
    getProjectIndex(true).then(() => {
      ipcMain.broadcast("projects:indexReady", {});
    }).catch(err => console.error(err));
    return { mountRoots: (await loadSettings()).mountRoots || [] };
  });

  // ── settings:addGitRoot ──────────────────────────────────────────────
  ipcMain.handle("settings:addGitRoot", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    const folderPath = assertString(p?.path, "path");
    const settings = await loadSettings();
    const roots = settings.gitDiscoveryRoots || [];
    if (!roots.includes(folderPath)) {
      const updated = { ...settings, gitDiscoveryRoots: [...roots, folderPath] };
      await saveSettings(updated);
      invalidateProjectCache();
      ipcMain.broadcast("settings:roots-changed", {});
      getProjectIndex(true).then(() => {
        ipcMain.broadcast("projects:indexReady", {});
      }).catch(err => console.error(err));
    }
    return { gitDiscoveryRoots: (await loadSettings()).gitDiscoveryRoots || [] };
  });

  // ── settings:removeGitRoot ───────────────────────────────────────────
  ipcMain.handle("settings:removeGitRoot", async (_event, params: unknown) => {
    const p = params as Record<string, unknown>;
    const folderPath = assertString(p?.path, "path");
    const settings = await loadSettings();
    const roots = settings.gitDiscoveryRoots || [];
    const updated = { ...settings, gitDiscoveryRoots: roots.filter(r => r !== folderPath) };
    await saveSettings(updated);
    invalidateProjectCache();
    ipcMain.broadcast("settings:roots-changed", {});
    getProjectIndex(true).then(() => {
      ipcMain.broadcast("projects:indexReady", {});
    }).catch(err => console.error(err));
    return { gitDiscoveryRoots: (await loadSettings()).gitDiscoveryRoots || [] };
  });

  // ── settings:getProjectRoots ─────────────────────────────────────────
  ipcMain.handle("settings:getProjectRoots", async (_event, _params: unknown) => {
    const settings = await loadSettings();
    return {
      mountRoots: settings.mountRoots || [],
      gitDiscoveryRoots: settings.gitDiscoveryRoots || [],
    };
  });

  // ── projects:index ───────────────────────────────────────────────────
  ipcMain.handle("projects:index", async (_event, params: unknown) => {
    const p = (params ?? {}) as Record<string, unknown>;
    const forceRefresh = assertOptionalBoolean(p?.forceRefresh, "forceRefresh") ?? false;
    const projects = await getProjectIndex(forceRefresh);
    return { projects };
  });


  // Warm up project index cache in the background on startup
  getProjectIndex()
    .then(() => {
      ipcMain.broadcast("projects:indexReady", {});
    })
    .catch((err) => {
      console.error("[projects:index-warmup] Failed", err);
    });

  // Trigger auto-import on startup asynchronously
  importShellHistory("auto")
    .then((imported) => {
      if (imported > 0) {
        console.log(`[reterm:auto-import] Startup imported ${imported} commands`);
      }
    })
    .catch((err) => {
      console.error("[reterm:auto-import] Startup import failed", err);
    });

  // Schedule periodic auto-import every 5 minutes
  setInterval(() => {
    importShellHistory("auto")
      .then((imported) => {
        if (imported > 0) {
          console.log(`[reterm:auto-import] Periodic imported ${imported} commands`);
        }
      })
      .catch((err) => {
        console.error("[reterm:auto-import] Periodic import failed", err);
      });
  }, 5 * 60 * 1000);
}

