/**
 * Terminal Runner — persistent PTY per session.
 *
 * Spawns one user shell per session via node-pty, streams the raw byte
 * stream to the renderer (which feeds it into xterm.js), and parses
 * OSC 133 / 7 / 6973 sequences emitted by our shell-integration script
 * to carve commands out of the stream and persist them as CommandEntry rows.
 */

import os from "os";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

import pty from "node-pty";
import type { IPty } from "node-pty";

import { ipcMain, logger } from "@glaze/core/backend";

import { CommandEntry } from "./types.js";
import { addEntry, updateEntry } from "./history-store.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Session state ──────────────────────────────────────────────────────────

interface PendingCommand {
  id: string;
  command: string;
  cwd: string;
  startedAt: number;
}

interface SessionState {
  id: string;
  pty: IPty;
  cwd: string;
  shellName: "zsh" | "bash" | "other";
  cols: number;
  rows: number;
  pendingCmd: string | null;     // most recent command text from OSC 6973
  active: PendingCommand | null; // command currently running (between 133;C and 133;D)
  parseBuf: string;              // OSC parser tail buffer (bytes that might be an incomplete escape)
}

export interface SessionInfo {
  id: string;
  cwd: string;
  runningId: string | null;
}

const sessions = new Map<string, SessionState>();

// ── Shell integration paths ────────────────────────────────────────────────

function findShellIntegrationDir(): string {
  // After build: build/main/index.js + build/main/shell-integration/...
  // In dev:      main/index.ts + main/services/shell-integration/...
  const candidates = [
    path.resolve(__dirname, "shell-integration"),
    path.resolve(__dirname, "services", "shell-integration"),
    path.resolve(__dirname, "..", "services", "shell-integration"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "reterm-integration.zsh"))) return c;
  }
  return candidates[0];
}

const SHELL_INTEGRATION_DIR = findShellIntegrationDir();

// ── Session lifecycle ──────────────────────────────────────────────────────

function detectShell(): { path: string; name: "zsh" | "bash" | "other" } {
  const shellPath = process.env.SHELL || "/bin/zsh";
  if (shellPath.endsWith("zsh")) return { path: shellPath, name: "zsh" };
  if (shellPath.endsWith("bash")) return { path: shellPath, name: "bash" };
  return { path: shellPath, name: "other" };
}

function spawnPty(initialCwd: string, cols: number, rows: number): { p: IPty; name: "zsh" | "bash" | "other" } {
  const { path: shellPath, name } = detectShell();

  // For zsh: trick zsh into sourcing our integration first by setting ZDOTDIR
  // to a temp dir that contains a .zshrc which sources our script.
  // For bash: pass --rcfile.
  const env: NodeJS.ProcessEnv = { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" };

  let args: string[] = ["-i", "-l"];

  if (name === "zsh") {
    const zdotdir = setupZshDotdir(env);
    env.ZDOTDIR = zdotdir;
  } else if (name === "bash") {
    args = ["--rcfile", path.join(SHELL_INTEGRATION_DIR, "reterm-integration.bash"), "-i"];
  }

  const p = pty.spawn(shellPath, args, {
    name: "xterm-256color",
    cols,
    rows,
    cwd: initialCwd,
    env: env as { [key: string]: string },
  });

  return { p, name };
}

function setupZshDotdir(env: NodeJS.ProcessEnv): string {
  // Create a temp ZDOTDIR that sources our integration + the user's real zshrc.
  const tmp = path.join(os.tmpdir(), `reterm-zsh-${crypto.randomBytes(4).toString("hex")}`);
  fs.mkdirSync(tmp, { recursive: true });
  const userZdotdir = env.ZDOTDIR || os.homedir();
  env.RETERM_USER_ZDOTDIR = userZdotdir;
  const integrationPath = path.join(SHELL_INTEGRATION_DIR, "reterm-integration.zsh");
  fs.writeFileSync(path.join(tmp, ".zshrc"), `source ${shQuote(integrationPath)}\n`);
  return tmp;
}

function shQuote(p: string): string {
  return `'${p.replace(/'/g, "'\\''")}'`;
}

export function createSession(sessionId?: string, initialCwd?: string, cols = 80, rows = 24): string {
  const id = sessionId || crypto.randomUUID();
  if (sessions.has(id)) return id;

  const cwd = initialCwd || os.homedir();
  const { p, name } = spawnPty(cwd, cols, rows);

  const state: SessionState = {
    id,
    pty: p,
    cwd,
    shellName: name,
    cols,
    rows,
    pendingCmd: null,
    active: null,
    parseBuf: "",
  };
  sessions.set(id, state);

  p.onData((data) => {
    handlePtyData(state, data);
  });

  p.onExit(({ exitCode }) => {
    logger.info("terminal", `PTY exited`, { sessionId: id, exitCode });
    ipcMain.broadcast("terminal:closed", { sessionId: id, exitCode });
    sessions.delete(id);
  });

  return id;
}

export function destroySession(sessionId: string): void {
  const state = sessions.get(sessionId);
  if (!state) return;
  try {
    state.pty.kill();
  } catch {
    /* already gone */
  }
  sessions.delete(sessionId);
}

export function listSessions(): SessionInfo[] {
  return Array.from(sessions.values()).map((s) => ({
    id: s.id,
    cwd: s.cwd,
    runningId: s.active?.id ?? null,
  }));
}

export function getSessionCwd(sessionId: string): string {
  return sessions.get(sessionId)?.cwd ?? os.homedir();
}

// ── Write / resize / interrupt ─────────────────────────────────────────────

export function writeToPty(sessionId: string, data: string): void {
  const state = sessions.get(sessionId);
  if (!state) return;
  state.pty.write(data);
}

export function resizePty(sessionId: string, cols: number, rows: number): void {
  const state = sessions.get(sessionId);
  if (!state) return;
  state.cols = cols;
  state.rows = rows;
  try {
    state.pty.resize(cols, rows);
  } catch (err) {
    logger.warn("terminal", "resize failed", { sessionId, err });
  }
}

/** Type a command and press Enter — used by history re-run and the palette. */
export async function executeCommand(sessionId: string, command: string, _cwd?: string): Promise<string> {
  let state = sessions.get(sessionId);
  if (!state) {
    createSession(sessionId);
    state = sessions.get(sessionId)!;
  }
  // Strip trailing newlines so we send exactly one Enter.
  const stripped = command.replace(/[\r\n]+$/, "");
  state.pty.write(stripped + "\r");
  // The real entry id comes from OSC parsing; return a synthetic placeholder.
  return crypto.randomUUID();
}

/** Send Ctrl-C to the foreground process group. */
export function interruptCommand(_id: string, sessionId?: string): boolean {
  if (sessionId) {
    const s = sessions.get(sessionId);
    if (!s) return false;
    s.pty.write("\x03");
    return true;
  }
  // Best-effort: SIGINT every session that has a running command.
  for (const s of sessions.values()) {
    if (s.active) s.pty.write("\x03");
  }
  return true;
}

/** Programmatic cd via the persistent shell. */
export function changeCwd(sessionId: string, cwd: string): void {
  const state = sessions.get(sessionId);
  if (!state) return;
  state.pty.write(` cd ${shQuote(cwd)}\r`);
}

// ── OSC parser ─────────────────────────────────────────────────────────────
//
// We stream all PTY data to the renderer untouched (xterm.js handles
// rendering, including OSC 7 cwd updates if it wants). We also peek at the
// stream to extract OSC 133/7/6973 for our own bookkeeping.
//
// OSC = ESC ] ... (BEL | ESC \).

const OSC_PREFIXES = ["133;", "7;", "6973;"];

function handlePtyData(state: SessionState, data: string): void {
  // Always forward raw bytes to the renderer for xterm.
  ipcMain.broadcast("terminal:data", { sessionId: state.id, data });

  // OSC sniffing
  const buf = state.parseBuf + data;
  let i = 0;
  let lastEmit = 0;
  while (i < buf.length) {
    // Find ESC ]
    const esc = buf.indexOf("\x1b]", i);
    if (esc === -1) {
      lastEmit = buf.length;
      break;
    }
    // Find terminator: BEL or ESC \
    const bel = buf.indexOf("\x07", esc + 2);
    const st = buf.indexOf("\x1b\\", esc + 2);
    let end = -1;
    let endLen = 0;
    if (bel !== -1 && (st === -1 || bel < st)) {
      end = bel;
      endLen = 1;
    } else if (st !== -1) {
      end = st;
      endLen = 2;
    }
    if (end === -1) {
      // Incomplete OSC, stash from `esc` onward.
      lastEmit = esc;
      break;
    }
    const payload = buf.slice(esc + 2, end);
    if (OSC_PREFIXES.some((p) => payload.startsWith(p))) {
      try {
        handleOsc(state, payload);
      } catch (err) {
        logger.warn("terminal", "OSC handler failed", { payload, err });
      }
    }
    i = end + endLen;
    lastEmit = i;
  }
  state.parseBuf = buf.slice(lastEmit);
  // Bound the buffer so a stray ESC] without a terminator can't grow forever.
  if (state.parseBuf.length > 8192) {
    state.parseBuf = state.parseBuf.slice(-2048);
  }
}

async function handleOsc(state: SessionState, payload: string): Promise<void> {
  if (payload.startsWith("7;")) {
    // OSC 7 ; file://host/path
    const url = payload.slice(2);
    const m = /^file:\/\/[^/]*(\/.*)$/.exec(url);
    if (m) {
      const decoded = safeDecodeURI(m[1]);
      if (decoded && decoded !== state.cwd) {
        state.cwd = decoded;
        ipcMain.broadcast("terminal:cwd", { sessionId: state.id, cwd: decoded });
      }
    }
    return;
  }

  if (payload.startsWith("6973;cmd;")) {
    const b64 = payload.slice("6973;cmd;".length);
    try {
      state.pendingCmd = Buffer.from(b64, "base64").toString("utf-8");
    } catch {
      state.pendingCmd = null;
    }
    return;
  }

  if (payload === "133;A" || payload === "133;B") {
    // Prompt / input markers — no-op for our bookkeeping.
    return;
  }

  if (payload === "133;C") {
    // Command output start — open a new entry.
    const cmd = (state.pendingCmd ?? "").trim();
    state.pendingCmd = null;
    if (!cmd) return;
    const id = crypto.randomUUID();
    const startedAt = Date.now();
    const entry: CommandEntry = {
      id,
      command: cmd,
      cwd: state.cwd,
      timestamp: startedAt,
      exitCode: null,
      durationMs: null,
      source: "terminal",
      labels: [],
      saved: false,
    };
    state.active = { id, command: cmd, cwd: state.cwd, startedAt };
    await addEntry(entry);
    ipcMain.broadcast("terminal:commandStart", { sessionId: state.id, id, command: cmd, cwd: state.cwd });
    ipcMain.broadcast("history:changed", {});
    return;
  }

  if (payload.startsWith("133;D")) {
    const rest = payload.slice(5); // either "" or ";<exit>"
    const exitStr = rest.startsWith(";") ? rest.slice(1) : "";
    const exitCode = exitStr === "" ? null : Number.parseInt(exitStr, 10);
    if (!state.active) return;
    const { id, startedAt } = state.active;
    const durationMs = Date.now() - startedAt;
    state.active = null;
    await updateEntry(id, {
      exitCode: Number.isFinite(exitCode) ? (exitCode as number) : null,
      durationMs,
      cwd: state.cwd,
    });
    ipcMain.broadcast("terminal:commandEnd", {
      sessionId: state.id,
      id,
      exitCode: Number.isFinite(exitCode) ? exitCode : null,
      durationMs,
      cwd: state.cwd,
    });
    ipcMain.broadcast("history:changed", {});
    return;
  }
}

function safeDecodeURI(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}
