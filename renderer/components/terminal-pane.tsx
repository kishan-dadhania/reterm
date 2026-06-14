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
import { CheckCircle2Icon, CircleXIcon, SquareIcon, ChevronRightIcon } from "lucide-react";
import type { TerminalBlock } from "../lib/types";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function ExitBadge({ exitCode }: { exitCode: number | null }) {
  if (exitCode === null) return null;
  if (exitCode === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-callout text-green-10 tabular-nums">
        <CheckCircle2Icon className="size-3.5 text-green-10 shrink-0" />
        exit 0
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-callout text-red-10 tabular-nums">
      <CircleXIcon className="size-3.5 text-red-10 shrink-0" />
      exit {exitCode}
    </span>
  );
}

function CommandBlock({ block }: { block: TerminalBlock }) {
  return (
    <div className="flex flex-col py-3 px-4 border-b border-gray-a3">
      {/* Prompt line */}
      <div className="flex items-center gap-1 mb-1">
        <span className="text-caption1 text-blue-10 font-mono shrink-0 truncate max-w-48" title={block.cwd}>
          {block.cwd}
        </span>
        <ChevronRightIcon className="size-3 text-gray-9 shrink-0" />
        <span className="text-callout font-mono text-gray-12 min-w-0 break-all">{block.command}</span>
      </div>

      {/* Output */}
      {block.chunks.length > 0 && (
        <pre className="text-caption1 font-mono whitespace-pre-wrap break-words leading-relaxed mt-1 mb-2">
          {block.chunks.map((chunk, i) => (
            <span key={i} className={chunk.stream === "stderr" ? "text-red-10" : "text-gray-11"}>
              {chunk.text}
            </span>
          ))}
        </pre>
      )}

      {/* Footer */}
      {(block.exitCode !== null || block.running) && (
        <div className="flex items-center gap-3 mt-1">
          {block.running ? (
            <span className="text-caption1 text-gray-10">Running…</span>
          ) : (
            <>
              <ExitBadge exitCode={block.exitCode} />
              {block.durationMs !== null && (
                <span className="text-caption1 text-gray-9 tabular-nums">{formatDuration(block.durationMs)}</span>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

interface TerminalPaneProps {
  pendingRerun?: { command: string; cwd: string } | null;
  onPendingRerunConsumed?: () => void;
}

export function TerminalPane({ pendingRerun, onPendingRerunConsumed }: TerminalPaneProps) {
  const [input, setInput] = React.useState("");
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

  const [blocks, setBlocks] = React.useState<TerminalBlock[]>([]);
  const [runningId, setRunningId] = React.useState<string | null>(null);

  // Subscribe to terminal output/exit notifications
  React.useEffect(() => {
    const unsubOutput = window.glazeAPI.glaze.ipc.onNotification(
      "terminal:output",
      (params: unknown) => {
        const { id, chunk, stream } = params as { id: string; chunk: string; stream: "stdout" | "stderr" };
        console.log("[Terminal:output]", { id, chunkLen: chunk.length, stream });
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
        console.log("[Terminal:exit]", { id, exitCode, cwd: newCwd, durationMs });
        setBlocks((prev) =>
          prev.map((b) => (b.id === id ? { ...b, exitCode, durationMs, running: false } : b))
        );
        setRunningId(null);
        queryClient.setQueryData(["terminal:cwd"], newCwd);
      }
    );

    return () => {
      unsubOutput();
      unsubExit();
    };
  }, [queryClient]);

  // Auto-scroll to bottom on new output
  React.useEffect(() => {
    if (scrollAreaRef.current) {
      const viewport = scrollAreaRef.current.querySelector("[data-radix-scroll-area-viewport]");
      if (viewport) {
        viewport.scrollTop = viewport.scrollHeight;
      }
    }
  }, [blocks]);

  const executeCommand = React.useCallback(
    async (cmd: string) => {
      if (!cmd || runningId !== null) return;
      console.log("[Terminal:execute]", { command: cmd, cwd });
      setInput("");
      try {
        const result = await window.glazeAPI.glaze.ipc.invoke<{ id: string }>("terminal:execute", {
          command: cmd,
        });
        const newBlock: TerminalBlock = {
          id: result.id,
          command: cmd,
          cwd,
          chunks: [],
          exitCode: null,
          durationMs: null,
          running: true,
        };
        setBlocks((prev) => [...prev, newBlock]);
        setRunningId(result.id);
      } catch (err) {
        console.log("[Terminal:error]", { error: err });
      }
    },
    [cwd, runningId]
  );

  // Handle rerun from history pane
  React.useEffect(() => {
    if (pendingRerun && runningId === null) {
      const { command, cwd: rerunCwd } = pendingRerun;
      queryClient.setQueryData(["terminal:cwd"], rerunCwd);
      // Small defer so cwd cache update propagates before execution
      const timer = setTimeout(() => {
        setInput(command);
        void executeCommand(command);
        onPendingRerunConsumed?.();
      }, 50);
      return () => clearTimeout(timer);
    }
    return undefined;
    // executeCommand excluded intentionally — it changes on every cwd update; use stable deps
  }, [pendingRerun, queryClient, onPendingRerunConsumed]);

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
              {runningId && (
                <Button
                  variant="glass"
                  size="large"
                  iconOnly
                  onClick={() => void handleInterrupt()}
                  aria-label="Stop running command"
                >
                  <SquareIcon className="size-4.5 text-red-10" />
                </Button>
              )}
            </ToolbarActions>
          </Toolbar>
        }
        className="flex-1 min-h-0"
      >
        <div className="pb-2">
          {blocks.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-callout text-gray-9">
              Run a command to get started
            </div>
          )}
          {blocks.map((block) => (
            <CommandBlock key={block.id} block={block} />
          ))}
        </div>
      </ScrollArea>

      {/* Input row */}
      <div className="border-t border-gray-a3 px-3 py-2 flex items-center gap-2 shrink-0">
        <span className="text-caption1 text-blue-10 font-mono shrink-0 truncate max-w-36" title={cwd}>
          {cwd}
        </span>
        <ChevronRightIcon className="size-3 text-gray-9 shrink-0" />
        <Input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter command…"
          disabled={runningId !== null}
          className="flex-1 font-mono min-w-0"
          autoFocus
        />
        {runningId ? (
          <Button variant="filled" size="small" onClick={() => void handleInterrupt()}>
            <SquareIcon className="size-3.5 text-red-10 shrink-0" />
            Stop
          </Button>
        ) : (
          <Button
            variant="filled"
            size="small"
            onClick={() => void executeCommand(input.trim())}
            disabled={!input.trim()}
          >
            Run
          </Button>
        )}
      </div>
    </div>
  );
}
