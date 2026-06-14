/**
 * Command Runner — multi-session terminal runner.
 *
 * Spawns commands in the user's shell, streams output via ipcMain.broadcast,
 * strips the __RETERM_PWD__ marker, and updates the history store on close.
 */

import { spawn, ChildProcess } from "child_process";
import os from "os";
import crypto from "crypto";

import { ipcMain } from "@glaze/core/backend";

import { CommandEntry } from "./types.js";
import { addEntry, updateEntry } from "./history-store.js";

// ── Session state ──────────────────────────────────────────────────────────

export interface SessionState {
  cwd: string;
  runningProcess: ChildProcess | null;
  runningId: string | null;
}

export interface SessionInfo {
  id: string;
  cwd: string;
  runningId: string | null;
}

const sessions = new Map<string, SessionState>();

const PWD_MARKER = "__RETERM_PWD__:";

function getOrCreateSession(sessionId: string): SessionState {
  let state = sessions.get(sessionId);
  if (!state) {
    state = {
      cwd: os.homedir(),
      runningProcess: null,
      runningId: null,
    };
    sessions.set(sessionId, state);
  }
  return state;
}

// ── Public API ─────────────────────────────────────────────────────────────

export function createSession(sessionId?: string, initialCwd?: string): string {
  const id = sessionId || crypto.randomUUID();
  if (!sessions.has(id)) {
    sessions.set(id, {
      cwd: initialCwd || os.homedir(),
      runningProcess: null,
      runningId: null,
    });
  }
  return id;
}

export function destroySession(sessionId: string): void {
  const state = sessions.get(sessionId);
  if (state) {
    if (state.runningProcess) {
      state.runningProcess.kill("SIGINT");
    }
    sessions.delete(sessionId);
  }
}

export function listSessions(): SessionInfo[] {
  const list: SessionInfo[] = [];
  for (const [id, state] of sessions.entries()) {
    list.push({
      id,
      cwd: state.cwd,
      runningId: state.runningId,
    });
  }
  return list;
}

export function changeCwd(sessionId: string, cwd: string): void {
  const state = getOrCreateSession(sessionId);
  state.cwd = cwd;
}

export function getSessionCwd(sessionId: string): string {
  const state = getOrCreateSession(sessionId);
  return state.cwd;
}

/**
 * Execute a command in the specified session.
 * Returns the entry id immediately; output is streamed via broadcast.
 */
export async function executeCommand(sessionId: string, command: string, cwd?: string): Promise<string> {
  const state = getOrCreateSession(sessionId);
  if (cwd) {
    state.cwd = cwd;
  }
  const id = crypto.randomUUID();
  const timestamp = Date.now();
  const shell = process.env.SHELL || "/bin/zsh";

  // Record entry immediately so the frontend can track it
  const entry: CommandEntry = {
    id,
    command,
    cwd: state.cwd,
    timestamp,
    exitCode: null,
    durationMs: null,
    source: "terminal",
    labels: [],
    saved: false,
  };

  await addEntry(entry);
  ipcMain.broadcast("history:changed", {});

  console.log("[reterm:execute]", { sessionId, id, command, cwd: state.cwd });

  let isStreaming = false;
  let bufferedStdout = "";
  let bufferedStderr = "";
  let timeoutId: NodeJS.Timeout | null = null;
  let stdoutRemainder = "";

  const emitStdout = (chunk: string) => {
    ipcMain.broadcast("terminal:output", { sessionId, id, chunk, stream: "stdout" });
  };

  const processStdout = (chunk: string, flush = false) => {
    const text = stdoutRemainder + chunk;
    stdoutRemainder = "";

    const markerIdx = text.indexOf(PWD_MARKER);
    if (markerIdx !== -1) {
      const before = text.slice(0, Math.max(0, markerIdx - 1));
      if (before.length > 0) {
        emitStdout(before);
      }
      const afterMarker = text.slice(markerIdx + PWD_MARKER.length);
      const newlineIdx = afterMarker.indexOf("\n");
      const detectedCwd =
        newlineIdx === -1 ? afterMarker.trim() : afterMarker.slice(0, newlineIdx).trim();
      if (detectedCwd) {
        state.cwd = detectedCwd;
      }
      if (newlineIdx !== -1 && afterMarker.length > newlineIdx + 1) {
        const tail = afterMarker.slice(newlineIdx + 1);
        emitStdout(tail);
      }
    } else if (flush) {
      if (text.length > 0) {
        emitStdout(text);
      }
    } else {
      const safeLen = Math.max(0, text.length - (PWD_MARKER.length - 1));
      const safe = text.slice(0, safeLen);
      stdoutRemainder = text.slice(safeLen);
      if (safe.length > 0) {
        emitStdout(safe);
      }
    }
  };

  const finishExecution = async (exitCode: number | null, durationMs: number) => {
    if (state.runningId === id) {
      state.runningProcess = null;
      state.runningId = null;
    }

    console.log("[reterm:exit]", { sessionId, id, exitCode, cwd: state.cwd, durationMs });

    ipcMain.broadcast("terminal:exit", { sessionId, id, exitCode, cwd: state.cwd, durationMs });

    await updateEntry(id, { exitCode, durationMs, cwd: state.cwd });
    ipcMain.broadcast("history:changed", {});
  };

  const rcSource = shell.endsWith("zsh")
    ? `[ -f ~/.zshrc ] && source ~/.zshrc ; `
    : shell.endsWith("bash")
    ? `[ -f ~/.bashrc ] && source ~/.bashrc ; [ -f ~/.bash_profile ] && source ~/.bash_profile ; `
    : "";

  const runFallback = () => {
    console.log("[reterm:execute] Fast run failed with command not found. Falling back to interactive login shell...");
    const fallbackArgs = [
      "-ilc",
      `${rcSource}cd ${shellEscape(state.cwd)} && ( ${command} ) ; printf "\\n${PWD_MARKER}%s" "$PWD"`,
    ];

    const child = spawn(shell, fallbackArgs, {
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    state.runningProcess = child;
    state.runningId = id;

    child.stdout.on("data", (chunk: Buffer) => {
      processStdout(chunk.toString());
    });

    child.stderr.on("data", (chunk: Buffer) => {
      ipcMain.broadcast("terminal:output", { sessionId, id, chunk: chunk.toString(), stream: "stderr" });
    });

    child.on("close", async (code) => {
      processStdout("", true); // flush remainder
      const durationMs = Date.now() - timestamp;
      const exitCode = code ?? null;
      await finishExecution(exitCode, durationMs);
    });

    child.on("error", (err) => {
      ipcMain.broadcast("terminal:output", {
        sessionId,
        id,
        chunk: `\nError spawning fallback shell: ${err.message}\n`,
        stream: "stderr",
      });
      const durationMs = Date.now() - timestamp;
      void finishExecution(null, durationMs);
    });
  };

  const runFast = () => {
    const fastArgs = [
      "-c",
      `cd ${shellEscape(state.cwd)} && ( ${command} ) ; printf "\\n${PWD_MARKER}%s" "$PWD"`,
    ];

    const child = spawn(shell, fastArgs, {
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    state.runningProcess = child;
    state.runningId = id;

    const startStreaming = () => {
      if (isStreaming) return;
      isStreaming = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }

      // Flush buffered stdout
      if (bufferedStdout) {
        processStdout(bufferedStdout);
        bufferedStdout = "";
      }

      // Flush buffered stderr
      if (bufferedStderr) {
        ipcMain.broadcast("terminal:output", { sessionId, id, chunk: bufferedStderr, stream: "stderr" });
        bufferedStderr = "";
      }
    };

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      if (isStreaming) {
        processStdout(text);
      } else {
        bufferedStdout += text;
        startStreaming();
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      if (isStreaming) {
        ipcMain.broadcast("terminal:output", { sessionId, id, chunk: text, stream: "stderr" });
      } else {
        bufferedStderr += text;
        const isCmdNotFound = text.includes("command not found") || text.includes("No such file or directory");
        if (!isCmdNotFound) {
          startStreaming();
        }
      }
    });

    timeoutId = setTimeout(() => {
      startStreaming();
    }, 45); // 45ms timeout: if it hasn't exited, the command exists!

    child.on("close", async (code) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }

      if (!isStreaming && code === 127) {
        // Clear buffers and trigger fallback
        bufferedStdout = "";
        bufferedStderr = "";
        runFallback();
      } else {
        startStreaming(); // Ensure any remaining is flushed
        processStdout("", true); // flush remainder
        const durationMs = Date.now() - timestamp;
        const exitCode = code ?? null;
        await finishExecution(exitCode, durationMs);
      }
    });

    child.on("error", (err) => {
      if (isStreaming) {
        ipcMain.broadcast("terminal:output", { sessionId, id, chunk: `\nError spawning shell: ${err.message}\n`, stream: "stderr" });
        const durationMs = Date.now() - timestamp;
        void finishExecution(null, durationMs);
      } else {
        bufferedStderr += `\nError spawning shell: ${err.message}\n`;
        startStreaming();
      }
    });
  };

  runFast();

  return id;
}

/**
 * Send SIGINT to the running process in the specified session if its runningId matches the given id.
 */
export function interruptCommand(id: string, sessionId?: string): boolean {
  if (sessionId) {
    const state = sessions.get(sessionId);
    if (state && state.runningProcess && state.runningId === id) {
      state.runningProcess.kill("SIGINT");
      return true;
    }
  } else {
    // If sessionId is not provided, look up all sessions to find the matching runningId
    for (const state of sessions.values()) {
      if (state.runningProcess && state.runningId === id) {
        state.runningProcess.kill("SIGINT");
        return true;
      }
    }
  }
  return false;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Shell-escape a path for use in a `cd` argument.
 * Wraps in single quotes and escapes any single quotes in the path.
 */
function shellEscape(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
