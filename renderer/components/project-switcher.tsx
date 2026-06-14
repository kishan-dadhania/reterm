import * as React from "react";
import { ProjectEntry } from "../lib/types";
import { SearchIcon, GitBranchIcon, ClockIcon, HardDriveIcon, Loader2Icon } from "lucide-react";

interface ProjectSwitcherProps {
  projects: ProjectEntry[];
  isLoading: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
}

function shortenPath(p: string): string {
  if (!p) return "~";
  const parts = p.split("/").filter(Boolean);
  if (parts.length === 0) return "/";
  if (parts.length <= 2) return `/${parts.join("/")}`;
  return `…/${parts.slice(-2).join("/")}`;
}

export function ProjectSwitcher({ projects, isLoading, onClose, onSelect }: ProjectSwitcherProps) {
  const [query, setQuery] = React.useState("");
  const [selectedIdx, setSelectedIdx] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = React.useMemo(() => {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    let results = projects;

    if (tokens.length > 0) {
      results = projects.filter((p) => {
        const nameLower = p.name.toLowerCase();
        const pathLower = p.path.toLowerCase();
        return tokens.every((tok) => nameLower.includes(tok) || pathLower.includes(tok));
      });
    }

    // Grouped by type badge (mount > git > recent) then alphabetically
    const typeOrder = { mount: 1, git: 2, recent: 3 };
    return [...results].sort((a, b) => {
      if (typeOrder[a.type] !== typeOrder[b.type]) {
        return typeOrder[a.type] - typeOrder[b.type];
      }
      return a.name.localeCompare(b.name);
    });
  }, [query, projects]);

  React.useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

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
      const project = filtered[selectedIdx];
      if (project) {
        onSelect(project.path);
      }
      return;
    }
  };

  const getBadgeStyle = (type: ProjectEntry["type"]) => {
    switch (type) {
      case "git":
        return {
          background: "var(--rt-success-muted)",
          color: "var(--rt-success)",
          borderColor: "rgba(16, 185, 129, 0.2)",
        };
      case "mount":
        return {
          background: "var(--rt-amber-muted)",
          color: "var(--rt-amber)",
          borderColor: "rgba(245, 158, 11, 0.2)",
        };
      case "recent":
      default:
        return {
          background: "var(--rt-source-terminal-muted)",
          color: "var(--rt-source-terminal)",
          borderColor: "rgba(59, 130, 246, 0.2)",
        };
    }
  };

  const getIcon = (type: ProjectEntry["type"]) => {
    switch (type) {
      case "git":
        return <GitBranchIcon className="size-3 shrink-0" />;
      case "mount":
        return <HardDriveIcon className="size-3 shrink-0" />;
      case "recent":
      default:
        return <ClockIcon className="size-3 shrink-0" />;
    }
  };

  return (
    <div
      className="rt-palette-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Project Switcher"
    >
      <div className="rt-palette-panel w-[600px] max-h-[500px]">
        {/* Search input with slash indicator */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-a3">
          <span className="text-xl font-bold text-gray-7 rt-mono select-none mr-1">/</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search projects by name or path…"
            className="flex-1 bg-transparent outline-none text-callout text-gray-12 placeholder:text-gray-8 rt-mono"
            aria-label="Search projects"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          <kbd className="text-caption2 text-gray-7 border border-gray-a3 rounded px-1.5 py-0.5 shrink-0">ESC</kbd>
        </div>

        {/* Info / Hint bar */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-a3 bg-gray-a1 text-caption2 text-gray-7">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <kbd className="border border-gray-a3 rounded px-1 py-0.5">↵</kbd> Switch to folder
            </span>
            <span className="flex items-center gap-1">
              <kbd className="border border-gray-a3 rounded px-1 py-0.5">↑↓</kbd> Navigate
            </span>
          </div>
          {isLoading && (
            <div className="flex items-center gap-1 text-gray-8">
              <Loader2Icon className="size-3 animate-spin" />
              <span>Scanning...</span>
            </div>
          )}
        </div>

        {/* Results */}
        <div ref={listRef} className="overflow-y-auto flex-1" role="listbox" aria-label="Project list">
          {isLoading && filtered.length === 0 ? (
            <div className="py-16 flex flex-col items-center gap-3 text-gray-8">
              <Loader2Icon className="size-8 animate-spin text-gray-6" />
              <span className="text-callout">Discovering projects under roots...</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 flex flex-col items-center gap-2 text-gray-8">
              <SearchIcon className="size-8 text-gray-6" />
              <span className="text-callout">No projects found</span>
              <span className="text-caption2 text-gray-6 text-center px-8">
                Try adding more Mount Roots or Git Discovery Roots in Settings.
              </span>
            </div>
          ) : (
            filtered.map((proj, idx) => {
              const badgeStyle = getBadgeStyle(proj.type);
              const isActive = idx === selectedIdx;
              return (
                <div
                  key={proj.path}
                  role="option"
                  aria-selected={isActive}
                  onClick={() => onSelect(proj.path)}
                  className={[
                    "flex items-center gap-3 px-4 py-3 cursor-pointer border-b border-gray-a2 transition-colors",
                    isActive
                      ? "bg-[var(--rt-accent-muted)] border-l-2 border-l-[var(--rt-accent)] pl-[14px]"
                      : "hover:bg-gray-a2 border-l-2 border-l-transparent pl-[14px]",
                  ].join(" ")}
                >
                  {/* Type badge */}
                  <span
                    className="inline-flex items-center gap-1 text-[10px] uppercase font-semibold tracking-wider px-2 py-0.5 rounded-full border shrink-0"
                    style={badgeStyle}
                  >
                    {getIcon(proj.type)}
                    {proj.type}
                  </span>

                  {/* Project info */}
                  <div className="flex flex-col min-w-0 flex-1 gap-0.5">
                    <span className="text-[14px] font-bold text-gray-12 truncate">{proj.name}</span>
                    <span className="rt-mono text-caption2 text-gray-8 truncate">{shortenPath(proj.path)}</span>
                  </div>

                  {/* Selected indicator */}
                  {isActive && (
                    <span className="text-caption2 text-[var(--rt-accent)] font-semibold uppercase tracking-wider shrink-0 bg-[rgba(139,92,246,0.1)] px-2 py-0.5 rounded border border-[rgba(139,92,246,0.2)]">
                      active
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
