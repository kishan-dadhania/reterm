import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  ScrollArea,
  Separator,
  Toolbar,
  ToolbarActions,
  ToolbarContent,
  ToolbarTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from "@glaze/core/components";
import {
  PlayIcon,
  StarIcon,
  TagIcon,
  DownloadIcon,
  UploadIcon,
  XIcon,
  CheckCircle2Icon,
  CircleXIcon,
  CopyIcon,
  FolderSymlinkIcon,
  FolderIcon,
  HistoryIcon,
  ChevronDownIcon,
} from "lucide-react";
import type { CommandEntry } from "../lib/types";

// ── Utilities ──────────────────────────────────────────────────────────────

function relativeTime(timestamp: number): string {
  if (!timestamp) return "";
  const delta = Date.now() - timestamp;
  const s = Math.floor(delta / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function shortenPath(p: string): string {
  if (!p) return "~";
  const parts = p.split("/").filter(Boolean);
  if (parts.length === 0) return "/";
  if (parts.length <= 2) return `/${parts.join("/")}`;
  return `…/${parts.slice(-2).join("/")}`;
}

function sessionLabel(timestamp: number): string {
  if (!timestamp) return "Imported";
  const d = new Date(timestamp);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (diffDays === 0) return `Today, ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  if (diffDays === 1) return `Yesterday, ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  return d.toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function labelColor(label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = label.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 70% 55%)`;
}

// ── Sub-components ─────────────────────────────────────────────────────────

function ExitBadge({ exitCode }: { exitCode: number | null }) {
  if (exitCode === null) return null;
  if (exitCode === 0)
    return <CheckCircle2Icon className="size-3.5 shrink-0" style={{ color: "var(--rt-success)" }} />;
  return <CircleXIcon className="size-3.5 shrink-0" style={{ color: "var(--rt-error)" }} />;
}

function SourceBadge({ source }: { source: "terminal" | "shell-import" }) {
  if (source === "terminal") {
    return (
      <span
        className="w-0.5 self-stretch rounded-full shrink-0 mr-1"
        style={{ background: "var(--rt-source-terminal)" }}
      />
    );
  }
  return (
    <span
      className="w-0.5 self-stretch rounded-full shrink-0 mr-1"
      style={{ background: "var(--rt-source-import)" }}
    />
  );
}

function FolderChip({ cwd }: { cwd: string }) {
  if (!cwd) return null;
  return (
    <span
      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-caption2 shrink-0 max-w-28 truncate"
      style={{ background: "hsl(0 0% 100% / 0.06)", color: "hsl(0 0% 100% / 0.45)" }}
      title={cwd}
    >
      <FolderIcon className="size-2.5 shrink-0" />
      <span className="rt-mono truncate">{shortenPath(cwd)}</span>
    </span>
  );
}

interface HistoryEntryRowProps {
  entry: CommandEntry;
  onRerun: (entry: CommandEntry, useOriginalCwd: boolean) => void;
  onToggleSave: (entry: CommandEntry) => void;
  onUpdateLabels: (entry: CommandEntry, labels: string[]) => void;
  allLabels: string[];
}

function HistoryEntryRow({ entry, onRerun, onToggleSave, onUpdateLabels, allLabels }: HistoryEntryRowProps) {
  const [labelInput, setLabelInput] = React.useState("");
  const [showLabelEditor, setShowLabelEditor] = React.useState(false);

  const handleAddLabel = () => {
    const trimmed = labelInput.trim();
    if (!trimmed || entry.labels.includes(trimmed)) {
      setLabelInput("");
      return;
    }
    onUpdateLabels(entry, [...entry.labels, trimmed]);
    setLabelInput("");
  };

  const handleRemoveLabel = (label: string) => {
    onUpdateLabels(entry, entry.labels.filter((l) => l !== label));
  };

  return (
    <div className="rt-fade-in flex gap-0 px-2 py-1.5 border-b border-gray-a2 hover:bg-gray-a2 transition-colors group">
      <SourceBadge source={entry.source} />
      <div className="flex flex-col flex-1 min-w-0 gap-1">
        {/* Row 1: command */}
        <div className="flex items-start gap-1.5 min-w-0">
          <ExitBadge exitCode={entry.exitCode} />
          <span className="rt-mono text-caption1 text-gray-12 min-w-0 break-all leading-snug flex-1">{entry.command}</span>
          {entry.saved && (
            <StarIcon className="size-3 shrink-0 mt-0.5" style={{ color: "var(--rt-amber)", fill: "var(--rt-amber)" }} />
          )}
        </div>

        {/* Row 2: folder chip + time + actions */}
        <div className="flex items-center gap-1.5 min-w-0">
          {entry.cwd ? (
            <FolderChip cwd={entry.cwd} />
          ) : (
            <span
              className="text-caption2 shrink-0 italic"
              style={{ color: "hsl(0 0% 100% / 0.25)" }}
              title="Folder not recorded — shell history doesn't store working directories"
            >
              no folder
            </span>
          )}
          <span className="text-caption2 text-gray-8 tabular-nums shrink-0 flex-1 text-right">{relativeTime(entry.timestamp)}</span>
          {/* Hover actions */}
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
            <button
              onClick={() => onRerun(entry, false)}
              className="p-1 rounded hover:bg-gray-a4 transition-colors"
              title="Rerun in current folder"
              aria-label="Rerun in current folder"
            >
              <PlayIcon className="size-3 text-gray-9" />
            </button>
            {/* Only show "run in original folder" when cwd is known */}
            {entry.cwd && (
              <button
                onClick={() => onRerun(entry, true)}
                className="p-1 rounded hover:bg-gray-a4 transition-colors"
                title={`Rerun in original folder (${entry.cwd})`}
                aria-label="Rerun in original folder"
              >
                <FolderSymlinkIcon className="size-3 text-gray-9" />
              </button>
            )}
            <button
              onClick={() => {
                navigator.clipboard.writeText(entry.command)
                  .then(() => toast.success("Copied"))
                  .catch(() => toast.error("Copy failed"));
              }}
              className="p-1 rounded hover:bg-gray-a4 transition-colors"
              title="Copy command"
              aria-label="Copy command"
            >
              <CopyIcon className="size-3 text-gray-9" />
            </button>
            <button
              onClick={() => onToggleSave(entry)}
              className="p-1 rounded hover:bg-gray-a4 transition-colors"
              title={entry.saved ? "Unsave" : "Save"}
              aria-label={entry.saved ? "Unsave" : "Save"}
            >
              <StarIcon
                className="size-3"
                style={entry.saved ? { color: "var(--rt-amber)", fill: "var(--rt-amber)" } : { color: "hsl(0 0% 100% / 0.4)" }}
              />
            </button>
            <button
              onClick={() => setShowLabelEditor((v) => !v)}
              className="p-1 rounded hover:bg-gray-a4 transition-colors"
              title="Edit labels"
              aria-label="Edit labels"
            >
              <TagIcon className="size-3 text-gray-9" />
            </button>
          </div>
        </div>

        {/* Labels */}
        {entry.labels.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {entry.labels.map((label) => (
              <span
                key={label}
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-caption2"
                style={{ background: `${labelColor(label)}22`, color: labelColor(label) }}
              >
                <span className="size-1.5 rounded-full shrink-0" style={{ background: labelColor(label) }} />
                {label}
                <button
                  onClick={() => handleRemoveLabel(label)}
                  className="ml-0.5 opacity-60 hover:opacity-100 transition-opacity"
                  aria-label={`Remove ${label}`}
                >
                  <XIcon className="size-2" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Label editor */}
        {showLabelEditor && (
          <div className="flex items-center gap-1 mt-0.5 flex-wrap">
            <input
              value={labelInput}
              onChange={(e) => setLabelInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); handleAddLabel(); }
              }}
              placeholder="Add label…"
              className="flex-1 min-w-20 h-6 text-caption1 bg-gray-a3 border border-gray-a4 rounded px-2 outline-none focus:border-gray-a6 rt-mono"
              aria-label="Add label"
            />
            {allLabels
              .filter((l) => !entry.labels.includes(l))
              .slice(0, 4)
              .map((label) => (
                <button
                  key={label}
                  onClick={() => onUpdateLabels(entry, [...entry.labels, label])}
                  className="h-6 px-2 text-caption2 rounded border border-gray-a3 hover:bg-gray-a3 transition-colors"
                  style={{ color: labelColor(label) }}
                >
                  {label}
                </button>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Session grouping ────────────────────────────────────────────────────────

const SESSION_GAP_MS = 5 * 60 * 1000; // 5 min

interface SessionGroup {
  label: string;
  entries: CommandEntry[];
}

function groupBySession(entries: CommandEntry[]): SessionGroup[] {
  if (entries.length === 0) return [];
  const groups: SessionGroup[] = [];
  let currentGroup: SessionGroup | null = null;
  let lastTimestamp = 0;

  for (const e of entries) {
    const ts = e.timestamp;
    if (!currentGroup || (lastTimestamp - ts) > SESSION_GAP_MS) {
      currentGroup = { label: sessionLabel(ts), entries: [] };
      groups.push(currentGroup);
    }
    currentGroup.entries.push(e);
    lastTimestamp = ts;
  }
  return groups;
}

function SessionHeader({ label, count, collapsed, onToggle }: { label: string; count: number; collapsed: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-gray-a2 transition-colors group text-left"
    >
      <ChevronDownIcon
        className="size-3 text-gray-8 shrink-0 transition-transform duration-150"
        style={{ transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)" }}
      />
      <span className="text-caption2 text-gray-8 flex-1">{label}</span>
      <span className="text-caption2 text-gray-7 tabular-nums">{count}</span>
    </button>
  );
}

// ── History Pane export ─────────────────────────────────────────────────────

type SourceFilter = "all" | "terminal" | "shell-import";

interface HistoryPaneProps {
  onRerun: (command: string, cwd: string, useOriginalCwd: boolean) => void;
}

export function HistoryPane({ onRerun }: HistoryPaneProps) {
  const queryClient = useQueryClient();
  const [search, setSearch] = React.useState("");
  const [savedOnly, setSavedOnly] = React.useState(false);
  const [labelFilter, setLabelFilter] = React.useState<string>("all");
  const [sourceFilter, setSourceFilter] = React.useState<SourceFilter>("all");
  const [collapsedSessions, setCollapsedSessions] = React.useState<Set<string>>(new Set());
  const [showStats, setShowStats] = React.useState(false);

  React.useEffect(() => {
    const unsub = window.glazeAPI.glaze.ipc.onNotification("history:changed", () => {
      void queryClient.invalidateQueries({ queryKey: ["history:list"] });
      void queryClient.invalidateQueries({ queryKey: ["history:labels"] });
    });
    return unsub;
  }, [queryClient]);

  const historyQuery = useQuery({
    queryKey: ["history:list", search, labelFilter, savedOnly],
    queryFn: () =>
      window.glazeAPI.glaze.ipc.invoke<{ entries: CommandEntry[] }>("history:list", {
        search: search || undefined,
        label: labelFilter !== "all" ? labelFilter : undefined,
        savedOnly: savedOnly || undefined,
        limit: 500,
      }).then((r) => r.entries),
    staleTime: 10_000,
  });

  const labelsQuery = useQuery({
    queryKey: ["history:labels"],
    queryFn: () =>
      window.glazeAPI.glaze.ipc.invoke<{ labels: string[] }>("history:labels", {}).then((r) => r.labels),
    staleTime: 30_000,
  });

  const saveMutation = useMutation({
    mutationFn: ({ id, saved }: { id: string; saved: boolean }) =>
      window.glazeAPI.glaze.ipc.invoke<{ entry: CommandEntry }>("history:save", { id, saved }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["history:list"] });
    },
    onError: () => toast.error("Failed to update saved state"),
  });

  const labelsMutation = useMutation({
    mutationFn: ({ id, labels }: { id: string; labels: string[] }) =>
      window.glazeAPI.glaze.ipc.invoke<{ entry: CommandEntry }>("history:setLabels", { id, labels }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["history:list"] });
      void queryClient.invalidateQueries({ queryKey: ["history:labels"] });
    },
    onError: () => toast.error("Failed to update labels"),
  });

  const importMutation = useMutation({
    mutationFn: () =>
      window.glazeAPI.glaze.ipc.invoke<{ imported: number }>("history:importShell", { source: "auto" }),
    onSuccess: (data) => {
      toast.success(`Imported ${data.imported} commands`);
      void queryClient.invalidateQueries({ queryKey: ["history:list"] });
    },
    onError: () => toast.error("Failed to import shell history"),
  });

  const handleRerun = (entry: CommandEntry, useOriginalCwd: boolean) => {
    onRerun(entry.command, entry.cwd, useOriginalCwd);
  };

  const handleToggleSave = (entry: CommandEntry) => {
    saveMutation.mutate({ id: entry.id, saved: !entry.saved });
  };

  const handleUpdateLabels = (entry: CommandEntry, labels: string[]) => {
    labelsMutation.mutate({ id: entry.id, labels });
  };

  const handleExport = () => {
    const rawEntries = historyQuery.data ?? [];
    const filtered = sourceFilter !== "all" ? rawEntries.filter((e) => e.source === sourceFilter) : rawEntries;
    const script = [
      "#!/usr/bin/env bash",
      `# Reterm export — ${new Date().toISOString()}`,
      "",
      ...filtered.map((e) => {
        const lines = [];
        if (e.cwd) lines.push(`cd ${JSON.stringify(e.cwd)}`);
        lines.push(e.command);
        return lines.join("\n");
      }),
    ].join("\n");
    const blob = new Blob([script], { type: "text/x-sh" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reterm-history-${Date.now()}.sh`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Exported history as shell script");
  };

  const allLabels = labelsQuery.data ?? [];
  const rawEntries = historyQuery.data ?? [];

  // Apply source filter
  const entries = sourceFilter !== "all"
    ? rawEntries.filter((e) => e.source === sourceFilter)
    : rawEntries;

  // Pinned entries at top
  const pinned = entries.filter((e) => e.saved);
  const unpinned = entries.filter((e) => !e.saved);

  // Session groups for unpinned
  const groups = React.useMemo(() => groupBySession(unpinned), [unpinned]);

  // Stats
  const terminalCount = rawEntries.filter((e) => e.source === "terminal").length;
  const importedCount = rawEntries.filter((e) => e.source === "shell-import").length;
  const failedCount = rawEntries.filter((e) => e.exitCode !== null && e.exitCode !== 0).length;
  const totalCount = rawEntries.length;

  const toggleSession = (label: string) => {
    setCollapsedSessions((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  return (
    <ScrollArea
      toolbar={
        <Toolbar>
          <ToolbarContent>
            <div className="flex items-center gap-1.5">
              <HistoryIcon className="size-3.5 text-gray-9" />
              <ToolbarTitle>History</ToolbarTitle>
              <span className="text-caption2 text-gray-8 tabular-nums ml-1">{totalCount > 0 ? `· ${totalCount}` : ""}</span>
            </div>
          </ToolbarContent>
          <ToolbarActions>
            <Button
              variant="glass"
              size="large"
              iconOnly
              onClick={handleExport}
              aria-label="Export history"
              title="Export as shell script"
            >
              <UploadIcon className="size-4 text-gray-10" />
            </Button>
            <Button
              variant="glass"
              size="large"
              iconOnly
              onClick={() => importMutation.mutate()}
              disabled={importMutation.isPending}
              aria-label="Import shell history"
              title="Import from shell history"
            >
              <DownloadIcon className="size-4 text-gray-10" />
            </Button>
          </ToolbarActions>
        </Toolbar>
      }
      className="h-full"
    >
      {/* Search + filters */}
      <div className="px-2 pt-2 pb-1.5 flex flex-col gap-1.5">
        <div className="relative">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search commands, folders, labels…"
            className="w-full h-8 pl-8 pr-3 text-caption1 bg-gray-a2 border border-gray-a3 rounded-lg outline-none focus:border-gray-a5 rt-mono transition-colors"
            aria-label="Search history"
          />
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-8">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
          </span>
        </div>

        {/* Filter row */}
        <div className="flex items-center gap-1 flex-wrap">
          {/* All / Saved */}
          <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-gray-a2">
            <button
              onClick={() => setSavedOnly(false)}
              className={["px-2.5 py-0.5 rounded-md text-caption1 transition-colors", !savedOnly ? "bg-gray-a4 text-gray-12" : "text-gray-9 hover:text-gray-11"].join(" ")}
            >
              All
            </button>
            <button
              onClick={() => setSavedOnly(true)}
              className={["flex items-center gap-1 px-2.5 py-0.5 rounded-md text-caption1 transition-colors", savedOnly ? "bg-gray-a4 text-gray-12" : "text-gray-9 hover:text-gray-11"].join(" ")}
            >
              <StarIcon className="size-2.5" style={savedOnly ? { color: "var(--rt-amber)", fill: "var(--rt-amber)" } : {}} />
              Saved
            </button>
          </div>

          {/* Source filter */}
          <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-gray-a2">
            {(["all", "terminal", "shell-import"] as SourceFilter[]).map((s) => (
              <button
                key={s}
                onClick={() => setSourceFilter(s)}
                className={["px-2.5 py-0.5 rounded-md text-caption1 transition-colors capitalize", sourceFilter === s ? "bg-gray-a4 text-gray-12" : "text-gray-9 hover:text-gray-11"].join(" ")}
              >
                {s === "shell-import" ? "Imported" : s === "all" ? "All" : "Terminal"}
              </button>
            ))}
          </div>

          {/* Label filter */}
          {allLabels.length > 0 && (
            <Select value={labelFilter} onValueChange={setLabelFilter}>
              <SelectTrigger size="small" variant="transparent" className="min-w-0 max-w-28 h-6">
                <SelectValue placeholder="Label" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All labels</SelectItem>
                {allLabels.map((label) => (
                  <SelectItem key={label} value={label}>
                    <span className="flex items-center gap-1">
                      <span className="size-2 rounded-full shrink-0" style={{ background: labelColor(label) }} />
                      {label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>
      <Separator />

      {/* Stats bar */}
      {showStats && (
        <div className="grid grid-cols-3 divide-x divide-gray-a3 border-b border-gray-a3 text-center">
          <div className="py-2">
            <div className="text-callout tabular-nums" style={{ color: "var(--rt-source-terminal)" }}>{terminalCount}</div>
            <div className="text-caption2 text-gray-8">Terminal</div>
          </div>
          <div className="py-2">
            <div className="text-callout tabular-nums" style={{ color: "var(--rt-source-import)" }}>{importedCount}</div>
            <div className="text-caption2 text-gray-8">Imported</div>
          </div>
          <div className="py-2">
            <div className="text-callout tabular-nums" style={{ color: "var(--rt-error)" }}>{failedCount}</div>
            <div className="text-caption2 text-gray-8">Failed</div>
          </div>
        </div>
      )}

      {/* Loading */}
      {historyQuery.isLoading && (
        <div className="px-3 py-4 text-callout text-gray-8">Loading…</div>
      )}

      {/* Empty state */}
      {!historyQuery.isLoading && entries.length === 0 && (
        <div className="px-3 py-12 flex flex-col items-center gap-3 text-gray-8">
          <div className="p-3 rounded-2xl" style={{ background: "hsl(0 0% 100% / 0.04)" }}>
            <HistoryIcon className="size-7 text-gray-8" />
          </div>
          <div className="flex flex-col items-center gap-1">
            <span className="text-callout">No commands found</span>
            <span className="text-caption1 text-gray-7">
              {search ? "Try a different search" : "Run some commands or import shell history"}
            </span>
          </div>
          {!search && (
            <button
              onClick={() => importMutation.mutate()}
              className="mt-1 text-caption1 px-3 py-1.5 rounded-lg border border-gray-a3 text-gray-9 hover:text-gray-11 hover:border-gray-a5 transition-colors flex items-center gap-1.5"
            >
              <DownloadIcon className="size-3" />
              Import from shell
            </button>
          )}
        </div>
      )}

      {/* Pinned section */}
      {pinned.length > 0 && (
        <div>
          <div className="flex items-center gap-2 px-3 py-1.5">
            <StarIcon className="size-3 shrink-0" style={{ color: "var(--rt-amber)", fill: "var(--rt-amber)" }} />
            <span className="text-caption2 text-gray-8">Pinned</span>
            <span className="text-caption2 text-gray-7">{pinned.length}</span>
          </div>
          {pinned.map((entry) => (
            <HistoryEntryRow
              key={entry.id}
              entry={entry}
              onRerun={handleRerun}
              onToggleSave={handleToggleSave}
              onUpdateLabels={handleUpdateLabels}
              allLabels={allLabels}
            />
          ))}
          <Separator />
        </div>
      )}

      {/* Session groups */}
      {groups.map((group) => (
        <div key={group.label}>
          <SessionHeader
            label={group.label}
            count={group.entries.length}
            collapsed={collapsedSessions.has(group.label)}
            onToggle={() => toggleSession(group.label)}
          />
          {!collapsedSessions.has(group.label) &&
            group.entries.map((entry) => (
              <HistoryEntryRow
                key={entry.id}
                entry={entry}
                onRerun={handleRerun}
                onToggleSave={handleToggleSave}
                onUpdateLabels={handleUpdateLabels}
                allLabels={allLabels}
              />
            ))}
        </div>
      ))}

      {/* Stats toggle at bottom */}
      <div className="border-t border-gray-a2 px-3 py-2">
        <button
          onClick={() => setShowStats((v) => !v)}
          className="text-caption2 text-gray-7 hover:text-gray-9 transition-colors flex items-center gap-1"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
            <rect x="3" y="12" width="4" height="9" rx="1"/>
            <rect x="10" y="7" width="4" height="14" rx="1"/>
            <rect x="17" y="3" width="4" height="18" rx="1"/>
          </svg>
          {showStats ? "Hide stats" : "Show stats"}
        </button>
      </div>
    </ScrollArea>
  );
}
