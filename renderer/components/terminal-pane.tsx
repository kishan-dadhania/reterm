import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  SearchIcon,
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

function CwdPill({ cwd }: { cwd: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-caption1 shrink-0 min-w-0"
      style={{ background: "var(--rt-source-terminal-muted)", color: "var(--rt-source-terminal)" }}
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
  pendingRerun?: { command: string; cwd: string; useOriginalCwd: boolean } | null;
  onPendingRerunConsumed?: () => void;
  onOpenPalette?: () => void;
  historyCommands?: string[];
}

export function TerminalPane({
  pendingRerun,
  onPendingRerunConsumed,
  onOpenPalette,
  historyCommands = [],
}: TerminalPaneProps) {
  const [input, setInput] = React.useState("");
  const [localHistoryIdx, setLocalHistoryIdx] = React.useState<number>(-1);
  const [savedInput, setSavedInput] = React.useState("");
  const scrollAreaRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const cwdQuery = useQuery({
    queryKey: ["terminal:cwd"],
    queryFn: () =>
      window.glazeAPI.glaze.ipc.invoke<{ cwd: string }>("terminal:cwd", {}).then((r) => r.cwd),
    staleTime: Infinity,
  });

  const cwd = cwdQuery.data ?? "~";
  const cwdRef = React.useRef(cwd);
  React.useEffect(() => { cwdRef.current = cwd; }, [cwd]);

  const [blocks, setBlocks] = React.useState<TerminalBlock[]>([]);
  const [runningId, setRunningId] = React.useState<string | null>(null);
  const runningIdRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    const unsubOutput = window.glazeAPI.glaze.ipc.onNotification(
      "terminal:output",
      (params: unknown) => {
        const { id, chunk, stream } = params as { id: string; chunk: string; stream: "stdout" | "stderr" };
        setBlocks((prev) =>
          prev.map((b) => (b.id === id ? { ...b, chunks: [...b.chunks, { text: chunk, stream }] } : b))
        );
      }
    );

    const unsubExit = window.glazeAPI.glaze.ipc.onNotification(
      "terminal:exit",
      (params: unknown) => {
        const { id, exitCode, cwd: newCwd, durationMs } = params as {
          id: string;
          exitCode: number;
          cwd: string;
          durationMs: number;
        };
        setBlocks((prev) =>
          prev.map((b) => (b.id === id ? { ...b, exitCode, durationMs, running: false } : b))
        );
        setRunningId(null);
        runningIdRef.current = null;
        queryClient.setQueryData(["terminal:cwd"], newCwd);
        cwdRef.current = newCwd;
      }
    );

    return () => {
      unsubOutput();
      unsubExit();
    };
  }, [queryClient]);

  React.useEffect(() => {
    if (scrollAreaRef.current) {
      const viewport = scrollAreaRef.current.querySelector("[data-radix-scroll-area-viewport]");
      if (viewport) {
        viewport.scrollTop = viewport.scrollHeight;
      }
    }
  }, [blocks]);

  const executeCommand = React.useCallback(
    async (cmd: string, execCwd?: string) => {
      if (!cmd || runningIdRef.current !== null) return;
      // Use the passed cwd if provided, else fall back to the always-fresh ref
      const targetCwd = execCwd ?? cwdRef.current;
      setInput("");
      setLocalHistoryIdx(-1);
      try {
        const result = await window.glazeAPI.glaze.ipc.invoke<{ id: string }>("terminal:execute", {
          command: cmd,
          cwd: targetCwd,
        });
        const newBlock: TerminalBlock = {
          id: result.id,
          command: cmd,
          cwd: targetCwd,
          chunks: [],
          exitCode: null,
          durationMs: null,
          running: true,
        };
        setBlocks((prev) => [...prev, newBlock]);
        runningIdRef.current = result.id;
        setRunningId(result.id);
      } catch (err) {
        console.log("[Terminal:error]", { error: err });
      }
    },
    [] // No deps — uses refs for cwd and runningId so it's always fresh
  );

  React.useEffect(() => {
    if (!pendingRerun || runningId !== null) return;

    const { command, cwd: rerunCwd, useOriginalCwd } = pendingRerun;
    const targetCwd = useOriginalCwd ? rerunCwd : cwd;

    // Consume the pending rerun immediately — before any async work — so this
    // effect does not fire again when the cwd query cache updates after execution.
    onPendingRerunConsumed?.();

    if (useOriginalCwd) {
      // Optimistically update the displayed cwd pill in the input bar.
      queryClient.setQueryData(["terminal:cwd"], targetCwd);
    }

    setInput(command);
    void executeCommand(command, targetCwd);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRerun]);

  const handleInterrupt = async () => {
    if (!runningId) return;
    try {
      await window.glazeAPI.glaze.ipc.invoke("terminal:interrupt", { id: runningId });
    } catch (err) {
      console.log("[Terminal:interruptError]", { error: err });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void executeCommand(input.trim());
      return;
    }
    // History navigation via ↑ / ↓
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
    // ⌘K to open palette
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      onOpenPalette?.();
    }
  };


  return (
    <div className="h-full flex flex-col overflow-hidden">
      <ScrollArea
        ref={scrollAreaRef}
        toolbar={
          <Toolbar>
            <ToolbarContent>
              <ToolbarTitle>Terminal</ToolbarTitle>
            </ToolbarContent>
            <ToolbarActions>
              {onOpenPalette && (
                <Button
                  variant="glass"
                  size="large"
                  iconOnly
                  onClick={onOpenPalette}
                  aria-label="Open command palette"
                  title="Search history (⌘K)"
                >
                  <SearchIcon className="size-4 text-gray-10" />
                </Button>
              )}
              {runningId && (
                <Button
                  variant="glass"
                  size="large"
                  iconOnly
                  onClick={() => void handleInterrupt()}
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
        <div className="pb-2 pt-1">
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
        </div>
      </ScrollArea>

      {/* Glowing Input Bar */}
      <div
        className="border-t border-gray-a3 px-3 py-2.5 flex items-center gap-2 shrink-0 rt-input-glow"
        style={{ background: "hsl(0 0% 0% / 0.15)" }}
      >
        <CwdPill cwd={cwd} />
        <ChevronRightIcon className="size-3 text-gray-8 shrink-0" />
        <Input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter command… (↑↓ history, ⌘K search)"
          disabled={runningId !== null}
          className="flex-1 rt-mono min-w-0 border-0 bg-transparent shadow-none focus:ring-0 text-sm"
          autoFocus
        />
        {runningId ? (
          <Button variant="filled" size="small" onClick={() => void handleInterrupt()}>
            <SquareIcon className="size-3 shrink-0" style={{ color: "var(--rt-error)" }} />
            Stop
          </Button>
        ) : (
          <Button
            variant="filled"
            size="small"
            onClick={() => void executeCommand(input.trim())}
            disabled={!input.trim()}
            style={input.trim() ? { background: "var(--rt-accent)" } : {}}
          >
            Run
          </Button>
        )}
      </div>
    </div>
  );
}
