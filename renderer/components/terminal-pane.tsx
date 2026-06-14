import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import {
  Button,
  Input,
  Toolbar,
  ToolbarActions,
  ToolbarContent,
  ToolbarTitle,
} from "@glaze/core/components";
import {
  SquareIcon,
  TerminalIcon,
  FolderIcon,
  XIcon,
} from "lucide-react";

function shortenPath(p: string): string {
  if (!p) return "~";
  const parts = p.split("/").filter(Boolean);
  if (parts.length === 0) return "/";
  if (parts.length <= 2) return `/${parts.join("/")}`;
  return `…/${parts.slice(-2).join("/")}`;
}

interface TerminalPaneProps {
  sessionId: string;
  cwd: string;
  running: boolean;
  onChangeCwd: (cwd: string) => void;
  executeCommand: (cmd: string, execCwd?: string) => Promise<void>;
  interruptCommand: () => void;
  pendingRerun?: { command: string; cwd: string; useOriginalCwd: boolean } | null;
  onPendingRerunConsumed?: () => void;
  onOpenPalette?: () => void;
  onOpenProjectSwitcher: () => void;
}

// xterm theme tuned to match the existing Reterm color tokens
const XTERM_THEME = {
  background: "#0d0e12",
  foreground: "#e6e6ef",
  cursor: "#7c93ff",
  cursorAccent: "#0d0e12",
  selectionBackground: "#3b4470",
  black: "#1a1c22",
  red: "#ff6b6b",
  green: "#5fd58f",
  yellow: "#ffd479",
  blue: "#7c93ff",
  magenta: "#cf8eff",
  cyan: "#7be3e3",
  white: "#cccccc",
  brightBlack: "#4a4d57",
  brightRed: "#ff8a8a",
  brightGreen: "#7fe6a8",
  brightYellow: "#ffe2a3",
  brightBlue: "#9fb1ff",
  brightMagenta: "#deaaff",
  brightCyan: "#a8eded",
  brightWhite: "#ffffff",
};

export function TerminalPane({
  sessionId,
  cwd,
  running,
  onChangeCwd,
  executeCommand,
  interruptCommand,
  pendingRerun,
  onPendingRerunConsumed,
  onOpenPalette,
  onOpenProjectSwitcher,
}: TerminalPaneProps) {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const termRef = React.useRef<Terminal | null>(null);
  const fitRef = React.useRef<FitAddon | null>(null);

  const [folderPickerOpen, setFolderPickerOpen] = React.useState(false);
  const [folderFilter, setFolderFilter] = React.useState("");

  const recentFoldersQuery = useQuery({
    queryKey: ["history:recentFolders"],
    queryFn: () =>
      window.glazeAPI.glaze.ipc
        .invoke<{ folders: string[] }>("history:recentFolders", { limit: 30 })
        .then((r) => r.folders),
    staleTime: 30_000,
  });
  const recentFolders = recentFoldersQuery.data ?? [];

  // ── Mount xterm once per session ────────────────────────────────────
  React.useEffect(() => {
    if (!hostRef.current) return;

    const term = new Terminal({
      theme: XTERM_THEME,
      fontFamily:
        '"SF Mono", "JetBrains Mono", "Fira Code", Menlo, Monaco, "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.25,
      letterSpacing: 0,
      cursorBlink: true,
      cursorStyle: "bar",
      scrollback: 10_000,
      allowProposedApi: true,
      macOptionIsMeta: true,
      convertEol: false,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(hostRef.current);
    termRef.current = term;
    fitRef.current = fit;

    // Initial fit and resize push to backend
    requestAnimationFrame(() => {
      try {
        fit.fit();
        void window.glazeAPI.glaze.ipc.invoke("terminal:resize", {
          sessionId,
          cols: term.cols,
          rows: term.rows,
        });
      } catch {
        /* layout not ready */
      }
      term.focus();
    });

    // Forward keystrokes to the PTY
    const dataDisp = term.onData((data) => {
      void window.glazeAPI.glaze.ipc.invoke("terminal:write", { sessionId, data });
    });

    // Subscribe to PTY data for this session
    const unsubData = window.glazeAPI.glaze.ipc.onNotification(
      "terminal:data",
      (params: unknown) => {
        const p = params as { sessionId: string; data: string };
        if (p.sessionId !== sessionId) return;
        term.write(p.data);
      },
    );

    // Resize observer
    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        void window.glazeAPI.glaze.ipc.invoke("terminal:resize", {
          sessionId,
          cols: term.cols,
          rows: term.rows,
        });
      } catch {
        /* not laid out */
      }
    });
    ro.observe(hostRef.current);

    return () => {
      unsubData();
      dataDisp.dispose();
      ro.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [sessionId]);

  // ── Pending re-run from history pane / palette ─────────────────────
  React.useEffect(() => {
    if (!pendingRerun) return;
    const { command, cwd: rerunCwd, useOriginalCwd } = pendingRerun;
    const run = async () => {
      if (useOriginalCwd && rerunCwd && rerunCwd !== cwd) {
        await new Promise((r) => setTimeout(r, 30));
        onChangeCwd(rerunCwd);
        await new Promise((r) => setTimeout(r, 80));
      }
      await executeCommand(command);
      onPendingRerunConsumed?.();
    };
    void run();
  }, [pendingRerun, cwd, onChangeCwd, executeCommand, onPendingRerunConsumed]);

  const filteredFolders = React.useMemo(() => {
    const q = folderFilter.trim().toLowerCase();
    if (!q) return recentFolders;
    return recentFolders.filter((f) => f.toLowerCase().includes(q));
  }, [recentFolders, folderFilter]);

  const handleBrowseFolder = async () => {
    setFolderPickerOpen(false);
    try {
      const result = await window.glazeAPI.glaze.ipc.invoke<{
        canceled: boolean;
        folderPaths: string[];
      }>("dialog:openFolder", {});
      if (!result.canceled && result.folderPaths.length > 0) {
        onChangeCwd(result.folderPaths[0]);
      }
    } catch (err) {
      console.error("[dialog:openFolderError]", err);
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden relative bg-[#0d0e12]">
      <Toolbar>
        <ToolbarContent>
          <div className="flex items-center gap-2 min-w-0">
            <TerminalIcon className="size-4 text-gray-9 shrink-0" />
            <ToolbarTitle>Terminal</ToolbarTitle>
            <button
              onClick={() => setFolderPickerOpen((o) => !o)}
              title="Change folder (⌘D)"
              className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-caption1 ml-1 transition-colors cursor-pointer select-none min-w-0"
              style={{
                background: folderPickerOpen
                  ? "var(--rt-accent-muted)"
                  : "var(--rt-source-terminal-muted)",
                color: folderPickerOpen
                  ? "var(--rt-accent)"
                  : "var(--rt-source-terminal)",
                border: folderPickerOpen
                  ? "1px solid var(--rt-accent)"
                  : "1px solid transparent",
              }}
            >
              <FolderIcon className="size-3 shrink-0" />
              <span className="truncate max-w-60 rt-mono">{shortenPath(cwd)}</span>
            </button>
            <button
              onClick={onOpenProjectSwitcher}
              className="text-caption1 text-gray-9 hover:text-gray-12 px-2 py-1 rounded transition-colors"
              title="Switch project (⌘P)"
            >
              Projects
            </button>
            {onOpenPalette && (
              <button
                onClick={onOpenPalette}
                className="text-caption1 text-gray-9 hover:text-gray-12 px-2 py-1 rounded transition-colors"
                title="Search history (⌘K)"
              >
                History <span className="rt-mono text-gray-7 ml-0.5">⌘K</span>
              </button>
            )}
          </div>
        </ToolbarContent>
        <ToolbarActions>
          {running && (
            <Button
              variant="glass"
              size="large"
              iconOnly
              onClick={interruptCommand}
              aria-label="Send SIGINT"
              title="Send Ctrl-C"
            >
              <SquareIcon className="size-4.5" style={{ color: "var(--rt-error)" }} />
            </Button>
          )}
        </ToolbarActions>
      </Toolbar>

      {/* xterm host fills the rest */}
      <div
        ref={hostRef}
        className="flex-1 min-h-0 px-2 py-1"
        onClick={() => termRef.current?.focus()}
      />

      {folderPickerOpen && (
        <div
          className="absolute top-13 right-3 left-3 max-w-md mx-auto border border-gray-a3 rounded-lg shadow-xl z-50 flex flex-col max-h-80 overflow-hidden"
          style={{ background: "hsl(240 12% 9% / 0.98)", backdropFilter: "blur(8px)" }}
        >
          <div className="px-3 py-2 border-b border-gray-a3 flex items-center gap-2">
            <FolderIcon className="size-3.5 text-gray-8" />
            <Input
              autoFocus
              placeholder="Filter or path…"
              value={folderFilter}
              onChange={(e) => setFolderFilter(e.target.value)}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setFolderPickerOpen(false);
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  const pick = filteredFolders[0] ?? folderFilter.trim();
                  if (pick) {
                    onChangeCwd(pick);
                    setFolderPickerOpen(false);
                    setFolderFilter("");
                  }
                }
              }}
              className="flex-1 border-0 bg-transparent shadow-none focus:ring-0 text-sm"
            />
            <button
              onClick={() => setFolderPickerOpen(false)}
              aria-label="Close"
              className="text-gray-8 hover:text-gray-12"
            >
              <XIcon className="size-3.5" />
            </button>
          </div>
          <div className="flex flex-col py-1 overflow-y-auto">
            <button
              onClick={handleBrowseFolder}
              className="flex items-center gap-2 px-3 py-2 text-left text-caption1 text-gray-12 hover:bg-gray-a2 border-b border-gray-a3"
            >
              <FolderIcon className="size-3.5 text-gray-8" />
              Browse Folder…
            </button>
            {filteredFolders.map((folder) => (
              <button
                key={folder}
                onClick={() => {
                  onChangeCwd(folder);
                  setFolderPickerOpen(false);
                  setFolderFilter("");
                }}
                className="flex flex-col px-3 py-1.5 text-left hover:bg-gray-a2 transition-colors"
              >
                <span className="rt-mono text-caption1 text-gray-12 truncate">
                  {shortenPath(folder)}
                </span>
                <span className="rt-mono text-[9px] text-gray-8 truncate">{folder}</span>
              </button>
            ))}
            {filteredFolders.length === 0 && (
              <div className="px-3 py-3 text-caption1 text-gray-9">No matches</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
