import * as React from "react";
import { CommandEntry } from "../lib/types";
import { SearchIcon, PlayIcon, FolderSymlinkIcon, TerminalIcon, DownloadIcon } from "lucide-react";

function shortenPath(p: string): string {
  if (!p) return "~";
  const parts = p.split("/").filter(Boolean);
  if (parts.length === 0) return "/";
  if (parts.length <= 2) return `/${parts.join("/")}`;
  return `…/${parts.slice(-2).join("/")}`;
}

interface CommandPaletteProps {
  entries: CommandEntry[];
  onClose: () => void;
  onRun: (command: string, cwd: string, useOriginalCwd: boolean) => void;
}

export function CommandPalette({ entries, onClose, onRun }: CommandPaletteProps) {
  const [query, setQuery] = React.useState("");
  const [selectedIdx, setSelectedIdx] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  const filtered = React.useMemo(() => {
    if (!query.trim()) return entries.slice(0, 60);
    const lower = query.toLowerCase();
    return entries
      .filter(
        (e) =>
          e.command.toLowerCase().includes(lower) ||
          e.cwd.toLowerCase().includes(lower) ||
          e.labels.some((l) => l.toLowerCase().includes(lower))
      )
      .slice(0, 60);
  }, [query, entries]);

  React.useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Scroll selected item into view
  React.useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.children[selectedIdx] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const entry = filtered[selectedIdx];
      if (entry) {
        // Enter = run in current folder, Meta+Enter = run in original folder
        onRun(entry.command, entry.cwd, e.metaKey);
        onClose();
      }
      return;
    }
  };

  return (
    // Backdrop
    <div
      className="rt-palette-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Command search palette"
    >
      <div className="rt-palette-panel">
        {/* Search input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-a3">
          <SearchIcon className="size-4 text-gray-9 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search command history…"
            className="flex-1 bg-transparent outline-none text-callout text-gray-12 placeholder:text-gray-8 rt-mono"
            aria-label="Search commands"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          <kbd className="text-caption2 text-gray-7 border border-gray-a3 rounded px-1.5 py-0.5 shrink-0">ESC</kbd>
        </div>

        {/* Hint bar */}
        <div className="flex items-center gap-4 px-4 py-2 border-b border-gray-a3 bg-gray-a1">
          <span className="flex items-center gap-1 text-caption2 text-gray-7">
            <kbd className="border border-gray-a3 rounded px-1 py-0.5 text-caption2">↵</kbd>
            run here
          </span>
          <span className="flex items-center gap-1 text-caption2 text-gray-7">
            <kbd className="border border-gray-a3 rounded px-1 py-0.5 text-caption2">⌘↵</kbd>
            run in original folder
          </span>
          <span className="flex items-center gap-1 text-caption2 text-gray-7">
            <kbd className="border border-gray-a3 rounded px-1 py-0.5 text-caption2">↑↓</kbd>
            navigate
          </span>
        </div>

        {/* Results */}
        <div
          ref={listRef}
          className="overflow-y-auto flex-1"
          role="listbox"
          aria-label="Command results"
        >
          {filtered.length === 0 && (
            <div className="py-12 flex flex-col items-center gap-2 text-gray-8">
              <SearchIcon className="size-6" />
              <span className="text-callout">No commands found</span>
            </div>
          )}
          {filtered.map((entry, idx) => (
            <div
              key={entry.id}
              role="option"
              aria-selected={idx === selectedIdx}
              onClick={() => { onRun(entry.command, entry.cwd, false); onClose(); }}
              className={[
                "flex items-start gap-3 px-4 py-2.5 cursor-pointer border-b border-gray-a2 transition-colors group",
                idx === selectedIdx ? "bg-gray-a3" : "hover:bg-gray-a2",
              ].join(" ")}
            >
              {/* Source icon */}
              <div className="mt-0.5 shrink-0">
                {entry.source === "terminal" ? (
                  <TerminalIcon className="size-3.5" style={{ color: "var(--rt-source-terminal)" }} />
                ) : (
                  <DownloadIcon className="size-3.5" style={{ color: "var(--rt-source-import)" }} />
                )}
              </div>

              {/* Command + cwd */}
              <div className="flex flex-col min-w-0 flex-1">
                <span className="rt-mono text-callout text-gray-12 truncate">{entry.command}</span>
                {entry.cwd && (
                  <span className="rt-mono text-caption2 text-gray-8 truncate">{shortenPath(entry.cwd)}</span>
                )}
              </div>

              {/* Actions (show on hover / selected) */}
              <div className={["flex items-center gap-1 shrink-0 transition-opacity", idx === selectedIdx ? "opacity-100" : "opacity-0 group-hover:opacity-100"].join(" ")}>
                <button
                  onClick={(e) => { e.stopPropagation(); onRun(entry.command, entry.cwd, false); onClose(); }}
                  className="p-1 rounded hover:bg-gray-a4 transition-colors"
                  title="Run in current folder"
                  aria-label="Run in current folder"
                >
                  <PlayIcon className="size-3.5 text-gray-9" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onRun(entry.command, entry.cwd, true); onClose(); }}
                  className="p-1 rounded hover:bg-gray-a4 transition-colors"
                  title="Run in original folder"
                  aria-label="Run in original folder"
                >
                  <FolderSymlinkIcon className="size-3.5 text-gray-9" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
