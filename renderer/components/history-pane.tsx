import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Input,
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
  XIcon,
  CheckCircle2Icon,
  CircleXIcon,
} from "lucide-react";
import type { CommandEntry } from "../lib/types";

function relativeTime(timestamp: number): string {
  const delta = Date.now() - timestamp;
  const s = Math.floor(delta / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function ExitBadge({ exitCode }: { exitCode: number | null }) {
  if (exitCode === null) return null;
  if (exitCode === 0) {
    return <CheckCircle2Icon className="size-3.5 text-green-10 shrink-0" />;
  }
  return <CircleXIcon className="size-3.5 text-red-10 shrink-0" />;
}

interface HistoryEntryRowProps {
  entry: CommandEntry;
  onRerun: (entry: CommandEntry) => void;
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
    <div className="px-3 py-2 border-b border-gray-a3 flex flex-col gap-1 group">
      {/* Row 1: command + exit badge */}
      <div className="flex items-center gap-2 min-w-0">
        <ExitBadge exitCode={entry.exitCode} />
        <span className="text-caption1 font-mono text-gray-12 truncate flex-1 min-w-0">{entry.command}</span>
      </div>

      {/* Row 2: cwd + time + actions */}
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-caption2 text-gray-9 truncate flex-1 min-w-0 font-mono">{entry.cwd}</span>
        <span className="text-caption2 text-gray-9 tabular-nums shrink-0">{relativeTime(entry.timestamp)}</span>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <Button
            variant="transparent"
            size="small"
            iconOnly
            onClick={() => onRerun(entry)}
            aria-label="Rerun command"
          >
            <PlayIcon className="size-3.5 text-gray-10" />
          </Button>
          <Button
            variant="transparent"
            size="small"
            iconOnly
            onClick={() => onToggleSave(entry)}
            aria-label={entry.saved ? "Unsave command" : "Save command"}
          >
            <StarIcon
              className={entry.saved ? "size-3.5 text-yellow-10" : "size-3.5 text-gray-10"}
              fill={entry.saved ? "currentColor" : "none"}
            />
          </Button>
          <Button
            variant="transparent"
            size="small"
            iconOnly
            onClick={() => setShowLabelEditor((v) => !v)}
            aria-label="Edit labels"
          >
            <TagIcon className="size-3.5 text-gray-10" />
          </Button>
        </div>
      </div>

      {/* Labels */}
      {entry.labels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {entry.labels.map((label) => (
            <span
              key={label}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-caption2 bg-gray-a3 text-gray-11"
            >
              {label}
              <button
                onClick={() => handleRemoveLabel(label)}
                className="ml-0.5 hover:text-red-10 transition-colors"
                aria-label={`Remove label ${label}`}
              >
                <XIcon className="size-2.5 text-gray-9" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Label editor */}
      {showLabelEditor && (
        <div className="flex items-center gap-1 mt-1">
          <Input
            value={labelInput}
            onChange={(e) => setLabelInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAddLabel();
              }
            }}
            placeholder="Add label…"
            className="flex-1 text-caption1 h-6"
          />
          {/* Quick-add from known labels */}
          {allLabels
            .filter((l) => !entry.labels.includes(l))
            .slice(0, 5)
            .map((label) => (
              <Button
                key={label}
                variant="transparent"
                size="small"
                onClick={() => onUpdateLabels(entry, [...entry.labels, label])}
              >
                {label}
              </Button>
            ))}
        </div>
      )}
    </div>
  );
}

interface HistoryPaneProps {
  onRerun: (command: string, cwd: string) => void;
}

export function HistoryPane({ onRerun }: HistoryPaneProps) {
  const queryClient = useQueryClient();
  const [search, setSearch] = React.useState("");
  const [savedOnly, setSavedOnly] = React.useState(false);
  const [labelFilter, setLabelFilter] = React.useState<string>("all");

  // Notifications from backend → refetch
  React.useEffect(() => {
    const unsub = window.glazeAPI.glaze.ipc.onNotification("history:changed", () => {
      console.log("[History:changed]", {});
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
        limit: 200,
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
    onError: (err) => {
      console.log("[History:saveError]", { error: err });
      toast.error("Failed to update saved state");
    },
  });

  const labelsMutation = useMutation({
    mutationFn: ({ id, labels }: { id: string; labels: string[] }) =>
      window.glazeAPI.glaze.ipc.invoke<{ entry: CommandEntry }>("history:setLabels", { id, labels }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["history:list"] });
      void queryClient.invalidateQueries({ queryKey: ["history:labels"] });
    },
    onError: (err) => {
      console.log("[History:labelsError]", { error: err });
      toast.error("Failed to update labels");
    },
  });

  const importMutation = useMutation({
    mutationFn: () =>
      window.glazeAPI.glaze.ipc.invoke<{ imported: number }>("history:importShell", { source: "auto" }),
    onSuccess: (data) => {
      console.log("[History:import]", { imported: data.imported });
      toast.success(`Imported ${data.imported} commands`);
      void queryClient.invalidateQueries({ queryKey: ["history:list"] });
    },
    onError: (err) => {
      console.log("[History:importError]", { error: err });
      toast.error("Failed to import shell history");
    },
  });

  const handleRerun = (entry: CommandEntry) => {
    onRerun(entry.command, entry.cwd);
  };

  const handleToggleSave = (entry: CommandEntry) => {
    saveMutation.mutate({ id: entry.id, saved: !entry.saved });
  };

  const handleUpdateLabels = (entry: CommandEntry, labels: string[]) => {
    labelsMutation.mutate({ id: entry.id, labels });
  };

  const allLabels = labelsQuery.data ?? [];
  const entries = historyQuery.data ?? [];

  return (
    <ScrollArea
      toolbar={
        <Toolbar>
          <ToolbarContent>
            <ToolbarTitle>History</ToolbarTitle>
          </ToolbarContent>
          <ToolbarActions>
            <Button
              variant="glass"
              size="large"
              iconOnly
              onClick={() => importMutation.mutate()}
              disabled={importMutation.isPending}
              aria-label="Import shell history"
            >
              <DownloadIcon className="size-4.5 text-gray-11" />
            </Button>
          </ToolbarActions>
        </Toolbar>
      }
      className="h-full"
    >
      {/* Search + filters */}
      <div className="px-3 pt-2 pb-2 flex flex-col gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search commands…"
          className="w-full"
        />
        <div className="flex items-center gap-2">
          {/* Filter chips: All / Saved */}
          <div className="flex items-center gap-1">
            <Button
              variant={!savedOnly ? "filled" : "transparent"}
              size="small"
              onClick={() => setSavedOnly(false)}
            >
              All
            </Button>
            <Button
              variant={savedOnly ? "filled" : "transparent"}
              size="small"
              onClick={() => setSavedOnly(true)}
            >
              <StarIcon
                className={savedOnly ? "size-3.5 text-yellow-10 shrink-0" : "size-3.5 text-gray-10 shrink-0"}
                fill={savedOnly ? "currentColor" : "none"}
              />
              Saved
            </Button>
          </div>
          {/* Label filter */}
          {allLabels.length > 0 && (
            <Select value={labelFilter} onValueChange={setLabelFilter}>
              <SelectTrigger size="small" variant="transparent" className="min-w-0 max-w-32">
                <SelectValue placeholder="All labels" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All labels</SelectItem>
                {allLabels.map((label) => (
                  <SelectItem key={label} value={label}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>
      <Separator />

      {/* Entry list */}
      {historyQuery.isLoading && (
        <div className="px-3 py-4 text-callout text-gray-9">Loading…</div>
      )}
      {!historyQuery.isLoading && entries.length === 0 && (
        <div className="px-3 py-10 flex flex-col items-center gap-1 text-gray-9">
          <span className="text-callout">No commands found</span>
          <span className="text-caption1 text-gray-8">
            {search ? "Try a different search" : "Run some commands to see history"}
          </span>
        </div>
      )}
      {entries.map((entry) => (
        <HistoryEntryRow
          key={entry.id}
          entry={entry}
          onRerun={handleRerun}
          onToggleSave={handleToggleSave}
          onUpdateLabels={handleUpdateLabels}
          allLabels={allLabels}
        />
      ))}
    </ScrollArea>
  );
}
