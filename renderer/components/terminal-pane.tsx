import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Button,
  Input,
  ScrollArea,
  Toolbar,
  ToolbarActions,
  ToolbarContent,
  ToolbarTitle,
} from "@glaze/core/components";
import {
  CheckCircle2Icon,
  CircleXIcon,
  SquareIcon,
  ChevronRightIcon,
  TerminalIcon,
  Loader2Icon,
  FolderIcon,
  XIcon,
} from "lucide-react";
import type { TerminalBlock } from "../lib/types";


function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function shortenPath(p: string): string {
  if (!p) return "~";
  const parts = p.split("/").filter(Boolean);
  if (parts.length === 0) return "/";
  if (parts.length <= 2) return `/${parts.join("/")}`;
  return `…/${parts.slice(-2).join("/")}`;
}

function StatusStripe({ block }: { block: TerminalBlock }) {
  if (block.running) return <div className="w-1 self-stretch rounded-l-md shrink-0" style={{ background: "var(--rt-amber)" }} />;
  if (block.exitCode === 0) return <div className="w-1 self-stretch rounded-l-md shrink-0" style={{ background: "var(--rt-success)" }} />;
  if (block.exitCode !== null) return <div className="w-1 self-stretch rounded-l-md shrink-0" style={{ background: "var(--rt-error)" }} />;
  return <div className="w-1 self-stretch rounded-l-md shrink-0 bg-gray-a3" />;
}

function ExitBadge({ exitCode, durationMs }: { exitCode: number | null; durationMs: number | null }) {
  if (exitCode === null) return null;
  return (
    <div className="flex items-center gap-2 mt-2">
      {exitCode === 0 ? (
        <span className="inline-flex items-center gap-1 text-caption1 tabular-nums px-2 py-0.5 rounded-full" style={{ background: "var(--rt-success-muted)", color: "var(--rt-success)" }}>
          <CheckCircle2Icon className="size-3 shrink-0" />
          exit 0
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-caption1 tabular-nums px-2 py-0.5 rounded-full" style={{ background: "var(--rt-error-muted)", color: "var(--rt-error)" }}>
          <CircleXIcon className="size-3 shrink-0" />
          exit {exitCode}
        </span>
      )}
      {durationMs !== null && (
        <span className="text-caption1 text-gray-9 tabular-nums">{formatDuration(durationMs)}</span>
      )}
    </div>
  );
}

function CwdPill({ cwd, active }: { cwd: string; active?: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-caption1 shrink-0 min-w-0 transition-colors cursor-pointer select-none"
      style={{
        background: active ? "var(--rt-accent-muted)" : "var(--rt-source-terminal-muted)",
        color: active ? "var(--rt-accent)" : "var(--rt-source-terminal)",
        border: active ? "1px solid var(--rt-accent)" : "1px solid transparent",
      }}
      title={cwd}
    >
      <FolderIcon className="size-3 shrink-0" />
      <span className="truncate max-w-40 rt-mono">{shortenPath(cwd)}</span>
    </span>
  );
}

function CommandBlock({ block }: { block: TerminalBlock }) {
  return (
    <div className="rt-slide-in flex gap-0 mx-3 my-2 rounded-lg overflow-hidden border border-gray-a3 bg-gray-a1">
      <StatusStripe block={block} />
      <div className="flex flex-col flex-1 min-w-0 p-3">
        {/* Prompt line */}
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <CwdPill cwd={block.cwd} />
          <ChevronRightIcon className="size-3 text-gray-8 shrink-0" />
          <span className="rt-mono text-callout text-gray-12 min-w-0 break-all">{block.command}</span>
        </div>

        {/* Output */}
        {block.chunks.length > 0 && (
          <pre className="rt-mono text-caption1 whitespace-pre-wrap break-words leading-relaxed mt-2 text-gray-11">
            {block.chunks.map((chunk, i) => (
              <span key={i} style={{ color: chunk.stream === "stderr" ? "var(--rt-error)" : undefined }}>
                {chunk.text}
              </span>
            ))}
          </pre>
        )}

        {/* Footer */}
        {block.running ? (
          <div className="flex items-center gap-1.5 mt-2">
            <Loader2Icon className="size-3 animate-spin" style={{ color: "var(--rt-amber)" }} />
            <span className="text-caption1 tabular-nums" style={{ color: "var(--rt-amber)" }}>Running…</span>
          </div>
        ) : (
          <ExitBadge exitCode={block.exitCode} durationMs={block.durationMs} />
        )}
      </div>
    </div>
  );
}

interface TerminalPaneProps {
  sessionId: string;
  cwd: string;
  blocks: TerminalBlock[];
  runningId: string | null;
  onChangeCwd: (cwd: string) => void;
  executeCommand: (cmd: string, execCwd?: string) => Promise<void>;
  interruptCommand: () => void;
  pendingRerun?: { command: string; cwd: string; useOriginalCwd: boolean } | null;
  onPendingRerunConsumed?: () => void;
  onOpenPalette?: () => void;
  historyCommands?: string[];
  onOpenProjectSwitcher: () => void;
}



export function TerminalPane({
  sessionId,
  cwd,
  blocks,
  runningId,
  onChangeCwd,
  executeCommand,
  interruptCommand,
  pendingRerun,
  onPendingRerunConsumed,
  onOpenPalette,
  historyCommands = [],
  onOpenProjectSwitcher,
}: TerminalPaneProps) {
  const [input, setInput] = React.useState("");
  const [localHistoryIdx, setLocalHistoryIdx] = React.useState<number>(-1);
  const [savedInput, setSavedInput] = React.useState("");



  const [folderPickerOpen, setFolderPickerOpen] = React.useState(false);
  const [dropdownIdx, setDropdownIdx] = React.useState(0);

  const scrollAreaRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Fetch 20 recent folders for picker/autocomplete
  const recentFoldersQuery = useQuery({
    queryKey: ["history:recentFolders"],
    queryFn: () =>
      window.glazeAPI.glaze.ipc.invoke<{ folders: string[] }>("history:recentFolders", {
        limit: 20,
      }).then((r) => r.folders),
    staleTime: 30_000,
  });

  const recentFolders = recentFoldersQuery.data ?? [];

  // Autocomplete matching: filter folders if command starts with "cd "
  const cdPrefix = "cd ";
  const cdQuery = input.toLowerCase().startsWith(cdPrefix)
    ? input.slice(cdPrefix.length).trim().toLowerCase()
    : "";

  const autocompleteSuggestions = React.useMemo(() => {
    if (!input.toLowerCase().startsWith(cdPrefix)) return [];
    return recentFolders.filter((f) => f.toLowerCase().includes(cdQuery));
  }, [input, recentFolders, cdQuery]);

  // Combined dropdown items for arrow navigation
  const dropdownItems = React.useMemo(() => {
    if (autocompleteSuggestions.length > 0) {
      return autocompleteSuggestions;
    }
    if (folderPickerOpen) {
      return ["__browse__", ...recentFolders];
    }
    return [];
  }, [autocompleteSuggestions, folderPickerOpen, recentFolders]);

  const isDropdownOpen = dropdownItems.length > 0;

  // Reset selected item index when list changes
  React.useEffect(() => {
    setDropdownIdx(0);
  }, [dropdownItems]);

  React.useEffect(() => {
    if (scrollAreaRef.current) {
      const viewport = scrollAreaRef.current.querySelector("[data-radix-scroll-area-viewport]");
      if (viewport) {
        setTimeout(() => {
          viewport.scrollTop = viewport.scrollHeight;
        }, 30);
      }
    }
  }, [blocks, runningId, sessionId]);


  // Auto-scroll input into focus when sessionId changes
  React.useEffect(() => {
    setInput("");
    setLocalHistoryIdx(-1);
    inputRef.current?.focus();
  }, [sessionId]);

  React.useEffect(() => {
    if (pendingRerun && runningId === null) {
      const { command, cwd: rerunCwd, useOriginalCwd } = pendingRerun;
      const targetCwd = useOriginalCwd ? rerunCwd : cwd;
      if (useOriginalCwd) {
        void onChangeCwd(targetCwd);
      }
      const timer = setTimeout(() => {
        setInput(command);
        void executeCommand(command, targetCwd);
        onPendingRerunConsumed?.();
      }, 50);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [pendingRerun, runningId, cwd, onChangeCwd, executeCommand, onPendingRerunConsumed]);

  const handleBrowseFolder = async () => {
    setFolderPickerOpen(false);
    try {
      const result = await window.glazeAPI.glaze.ipc.invoke<{ canceled: boolean; folderPaths: string[] }>(
        "dialog:openFolder",
        {}
      );
      if (!result.canceled && result.folderPaths.length > 0) {
        const selectedPath = result.folderPaths[0];
        void onChangeCwd(selectedPath);
      }
    } catch (err) {
      console.error("[dialog:openFolderError]", err);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Dropdown Navigation
    if (isDropdownOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setDropdownIdx((idx) => Math.min(idx + 1, dropdownItems.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setDropdownIdx((idx) => Math.max(idx - 1, 0));
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setFolderPickerOpen(false);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const selectedItem = dropdownItems[dropdownIdx];
        if (selectedItem) {
          if (selectedItem === "__browse__") {
            void handleBrowseFolder();
          } else if (autocompleteSuggestions.length > 0) {
            setInput(`cd ${selectedItem}`);
          } else {
            void onChangeCwd(selectedItem);
            setFolderPickerOpen(false);
          }
        }
        return;
      }
    }

    // Standard Terminal Keydown Handling
    if (e.key === "Enter") {
      e.preventDefault();
      const trimmed = input.trim();
      if (trimmed) {
        void executeCommand(trimmed);
      }
      return;
    }
    // Command History navigation via ↑ / ↓
    if (e.key === "ArrowUp" && historyCommands.length > 0) {
      e.preventDefault();
      if (localHistoryIdx === -1) setSavedInput(input);
      const nextIdx = Math.min(localHistoryIdx + 1, historyCommands.length - 1);
      setLocalHistoryIdx(nextIdx);
      setInput(historyCommands[nextIdx] ?? "");
      return;
    }
    if (e.key === "ArrowDown" && historyCommands.length > 0) {
      e.preventDefault();
      if (localHistoryIdx <= 0) {
        setLocalHistoryIdx(-1);
        setInput(savedInput);
        return;
      }
      const nextIdx = localHistoryIdx - 1;
      setLocalHistoryIdx(nextIdx);
      setInput(historyCommands[nextIdx] ?? savedInput);
      return;
    }
    // ⌘K to open command search palette
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      onOpenPalette?.();
      return;
    }
    // "/" to open project switcher when input is empty
    if (e.key === "/" && input === "") {
      e.preventDefault();
      onOpenProjectSwitcher();
      return;
    }
    // ⌘D to toggle folder picker
    if ((e.metaKey || e.ctrlKey) && e.key === "d") {
      e.preventDefault();
      setFolderPickerOpen((o) => !o);
      return;
    }
  };


  return (
    <div className="h-full flex flex-col overflow-hidden relative">
      <ScrollArea
        ref={scrollAreaRef}
        toolbar={
          <Toolbar>
            <ToolbarContent>
              <div className="flex items-center gap-2">
                <TerminalIcon className="size-4 text-gray-9" />
                <ToolbarTitle>Terminal</ToolbarTitle>
              </div>
            </ToolbarContent>
            <ToolbarActions>
              {runningId && (
                <Button
                  variant="glass"
                  size="large"
                  iconOnly
                  onClick={() => interruptCommand()}
                  aria-label="Stop running command"
                >
                  <SquareIcon className="size-4.5" style={{ color: "var(--rt-error)" }} />
                </Button>
              )}
            </ToolbarActions>
          </Toolbar>
        }
        className="flex-1 min-h-0"
      >
        <div
          className="pb-6 pt-1 cursor-text"
          onClick={(e) => {
            const target = e.target as HTMLElement;
            if (
              !target.closest("button") &&
              !target.closest("input") &&
              !target.closest("[role=option]") &&
              !target.closest("a")
            ) {
              inputRef.current?.focus();
            }
          }}
        >
          {blocks.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 gap-3 select-none">
              <div className="p-4 rounded-2xl" style={{ background: "var(--rt-accent-muted)" }}>
                <TerminalIcon className="size-8" style={{ color: "var(--rt-accent)" }} />
              </div>
              <div className="flex flex-col items-center gap-1">
                <span className="text-callout text-gray-10">Ready</span>
                <span className="text-caption1 text-gray-8">Type a command below to get started</span>
                {onOpenPalette && (
                  <button
                    onClick={onOpenPalette}
                    className="mt-2 text-caption1 px-3 py-1 rounded-full border border-gray-a4 text-gray-9 hover:text-gray-11 hover:border-gray-a6 transition-colors"
                  >
                    Search history <span className="rt-mono ml-1 text-gray-7">⌘K</span>
                  </button>
                )}
              </div>
            </div>
          )}
          {blocks.map((block) => (
            <CommandBlock key={block.id} block={block} />
          ))}

          {/* Inline Input Prompt Box */}
          <div
            className="mx-3 my-2 px-3 py-2 flex items-center gap-2 rounded-lg border border-gray-a3 rt-input-glow relative bg-gray-a1"
            style={{ background: "hsl(240 12% 9% / 0.4)" }}
          >
            <button
              onClick={() => setFolderPickerOpen((o) => !o)}
              title="Toggle Folder Picker (⌘D)"
              className="outline-none shrink-0 animate-none"
            >
              <CwdPill cwd={cwd} active={folderPickerOpen || autocompleteSuggestions.length > 0} />
            </button>
            <ChevronRightIcon className="size-3 text-gray-8 shrink-0" />
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={runningId ? "Running command..." : "Enter command… (↑↓ history, ⌘K search, ⌘D folders)"}
              disabled={runningId !== null}
              className="flex-1 rt-mono min-w-0 border-0 bg-transparent shadow-none focus:ring-0 text-sm py-1"
              autoFocus
            />
            {runningId ? (
              <Button
                variant="glass"
                size="small"
                onClick={() => interruptCommand()}
                className="flex items-center gap-1.5 px-3 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 border border-red-500/20 rounded"
              >
                <SquareIcon className="size-3 shrink-0" />
                Stop
              </Button>
            ) : (
              <Button
                variant="filled"
                size="small"
                onClick={() => {
                  const trimmed = input.trim();
                  if (trimmed) void executeCommand(trimmed);
                }}
                disabled={!input.trim()}
                style={input.trim() ? { background: "var(--rt-accent)" } : {}}
              >
                Run
              </Button>
            )}

            {/* Autocomplete / Folder Picker Dropdown (renders absolute above the input prompt) */}
            {isDropdownOpen && (
              <div
                className="absolute bottom-full left-0 mb-1.5 w-96 border border-gray-a3 rounded-lg shadow-xl z-50 flex flex-col max-h-60 overflow-y-auto"
                style={{ background: "hsl(240 12% 9% / 0.96)", backdropFilter: "blur(8px)" }}
              >
                {/* Header */}
                <div className="px-3 py-1.5 border-b border-gray-a3 flex justify-between items-center text-caption2 text-gray-9 bg-gray-a2">
                  <span>{autocompleteSuggestions.length > 0 ? "Folder Suggestions" : "Recent Folders (⌘D)"}</span>
                  <button onClick={() => setFolderPickerOpen(false)} aria-label="Close panel">
                    <XIcon className="size-3 text-gray-8 hover:text-gray-12" />
                  </button>
                </div>

                {/* List items */}
                <div className="flex flex-col py-1">
                  {dropdownItems.map((item, idx) => {
                    const isSelected = idx === dropdownIdx;
                    if (item === "__browse__") {
                      return (
                        <button
                          key="__browse__"
                          onClick={handleBrowseFolder}
                          className={[
                            "flex items-center gap-2 px-3 py-2 text-left text-caption1 transition-colors font-medium border-b border-gray-a3",
                            isSelected ? "bg-gray-a3 text-gray-12" : "text-gray-12 hover:bg-gray-a2",
                          ].join(" ")}
                          style={isSelected ? { background: "var(--rt-accent-muted)" } : {}}
                        >
                          <FolderIcon className="size-3.5 text-gray-8" />
                          Browse Folder...
                        </button>
                      );
                    }

                    return (
                      <button
                        key={item}
                        onClick={() => {
                          if (autocompleteSuggestions.length > 0) {
                            setInput(`cd ${item}`);
                          } else {
                            void onChangeCwd(item);
                            setFolderPickerOpen(false);
                          }
                        }}
                        className={[
                          "flex flex-col px-3 py-1.5 text-left transition-colors group",
                          isSelected ? "bg-gray-a3 text-gray-12" : "hover:bg-gray-a2 text-gray-11 hover:text-gray-12",
                        ].join(" ")}
                        style={isSelected ? { background: "var(--rt-accent-muted)" } : {}}
                      >
                        <span className="rt-mono text-caption1 truncate" title={item}>
                          {shortenPath(item)}
                        </span>
                        <span className="rt-mono text-[9px] text-gray-8 truncate">
                          {item}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>

  );
}

