/**
 * Command Runner — single persistent-cwd session.
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

let sessionCwd: string = os.homedir();
let runningProcess: ChildProcess | null = null;
let runningId: string | null = null;

const PWD_MARKER = "__RETERM_PWD__:";

// ── Public API ─────────────────────────────────────────────────────────────

export function getSessionCwd(): string {
  return sessionCwd;
}

/**
 * Execute a command in the persistent session.
 * Returns the entry id immediately; output is streamed via broadcast.
 */
export async function executeCommand(command: string): Promise<string> {
  const id = crypto.randomUUID();
  const timestamp = Date.now();
  const shell = process.env.SHELL || "/bin/zsh";

  // Record entry immediately so the frontend can track it
  const entry: CommandEntry = {
    id,
    command,
    cwd: sessionCwd,
    timestamp,
    exitCode: null,
    durationMs: null,
    source: "terminal",
    labels: [],
    saved: false,
  };

  await addEntry(entry);
  ipcMain.broadcast("history:changed", {});

  console.log("[reterm:execute]", { id, command, cwd: sessionCwd });

  // Shell invocation: cd to sessionCwd, run command, then print the new PWD
  // The trailing printf outputs the marker so we can detect cwd changes.
  // Wrapped in a subshell so `cd` inside the command is visible via $PWD.
  const shellArgs = [
    "-lc",
    `cd ${shellEscape(sessionCwd)} && ( ${command} ) ; printf "\\n${PWD_MARKER}%s" "$PWD"`,
  ];

  const child = spawn(shell, shellArgs, {
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  runningProcess = child;
  runningId = id;

  // ── stdout streaming with marker buffering ─────────────────────────────
  // We buffer the end of the stream to detect and strip the marker line.
  let stdoutRemainder = "";

  child.stdout.on("data", (chunk: Buffer) => {
    const text = stdoutRemainder + chunk.toString();
    stdoutRemainder = "";

    // The marker always appears at the end, prefixed by a newline.
    // Check if the marker may be split across chunks by buffering a tail.
    const markerIdx = text.indexOf(PWD_MARKER);
    if (markerIdx !== -1) {
      // Emit everything before the marker line (strip the leading \n too)
      const before = text.slice(0, Math.max(0, markerIdx - 1));
      if (before.length > 0) {
        ipcMain.broadcast("terminal:output", { id, chunk: before, stream: "stdout" });
      }
      // Extract path — everything after the marker until end or next newline
      const afterMarker = text.slice(markerIdx + PWD_MARKER.length);
      const newlineIdx = afterMarker.indexOf("\n");
      const detectedCwd =
        newlineIdx === -1 ? afterMarker.trim() : afterMarker.slice(0, newlineIdx).trim();
      if (detectedCwd) {
        sessionCwd = detectedCwd;
      }
      // If anything follows the marker (shouldn't normally happen), forward it
      if (newlineIdx !== -1 && afterMarker.length > newlineIdx + 1) {
        const tail = afterMarker.slice(newlineIdx + 1);
        ipcMain.broadcast("terminal:output", { id, chunk: tail, stream: "stdout" });
      }
    } else {
      // The marker could be split: keep last (PWD_MARKER.length - 1) chars buffered
      const safeLen = Math.max(0, text.length - (PWD_MARKER.length - 1));
      const safe = text.slice(0, safeLen);
      stdoutRemainder = text.slice(safeLen);
      if (safe.length > 0) {
        ipcMain.broadcast("terminal:output", { id, chunk: safe, stream: "stdout" });
      }
    }
  });

  child.stdout.on("end", () => {
    // Flush remainder — if it contains the marker strip it, otherwise emit
    if (stdoutRemainder.length > 0) {
      const markerIdx = stdoutRemainder.indexOf(PWD_MARKER);
      if (markerIdx !== -1) {
        const before = stdoutRemainder.slice(0, Math.max(0, markerIdx - 1));
        if (before.length > 0) {
          ipcMain.broadcast("terminal:output", { id, chunk: before, stream: "stdout" });
        }
        const afterMarker = stdoutRemainder.slice(markerIdx + PWD_MARKER.length).trim();
        if (afterMarker) sessionCwd = afterMarker;
      } else {
        ipcMain.broadcast("terminal:output", { id, chunk: stdoutRemainder, stream: "stdout" });
      }
      stdoutRemainder = "";
    }
  });

  // ── stderr streaming ───────────────────────────────────────────────────
  child.stderr.on("data", (chunk: Buffer) => {
    ipcMain.broadcast("terminal:output", { id, chunk: chunk.toString(), stream: "stderr" });
  });

  // ── Process close ──────────────────────────────────────────────────────
  child.on("close", async (code) => {
    const durationMs = Date.now() - timestamp;
    const exitCode = code ?? null;

    if (runningId === id) {
      runningProcess = null;
      runningId = null;
    }

    console.log("[reterm:exit]", { id, exitCode, cwd: sessionCwd, durationMs });

    ipcMain.broadcast("terminal:exit", { id, exitCode, cwd: sessionCwd, durationMs });

    await updateEntry(id, { exitCode, durationMs, cwd: sessionCwd });
    ipcMain.broadcast("history:changed", {});
  });

  child.on("error", (err) => {
    console.log("[reterm:error]", { id, error: err.message });
    ipcMain.broadcast("terminal:output", {
      id,
      chunk: `\nError spawning shell: ${err.message}\n`,
      stream: "stderr",
    });
  });

  return id;
}

/**
 * Send SIGINT to the running process if it matches the given id.
 */
export function interruptCommand(id: string): boolean {
  if (runningProcess && runningId === id) {
    runningProcess.kill("SIGINT");
    return true;
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
