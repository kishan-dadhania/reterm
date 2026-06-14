import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { SplitView } from "@glaze/core/components";
import { TerminalPane } from "../components/terminal-pane";
import { HistoryPane } from "../components/history-pane";
import { CommandPalette } from "../components/command-palette";
import type { CommandEntry } from "../lib/types";

export function HomeView() {
  const [pendingRerun, setPendingRerun] = React.useState<{ command: string; cwd: string; useOriginalCwd: boolean } | null>(null);
  const [paletteOpen, setPaletteOpen] = React.useState(false);

  // Fetch all entries for palette (no limit)
  const allEntriesQuery = useQuery({
    queryKey: ["history:list:all"],
    queryFn: () =>
      window.glazeAPI.glaze.ipc.invoke<{ entries: CommandEntry[] }>("history:list", {
        limit: 2000,
      }).then((r) => r.entries),
    staleTime: 30_000,
  });

  const allEntries = allEntriesQuery.data ?? [];

  const handleRerun = React.useCallback((command: string, cwd: string, useOriginalCwd: boolean) => {
    setPendingRerun({ command, cwd, useOriginalCwd });
  }, []);

  const handlePendingRerunConsumed = React.useCallback(() => {
    setPendingRerun(null);
  }, []);

  const handleOpenPalette = React.useCallback(() => {
    setPaletteOpen(true);
  }, []);

  // Global ⌘K shortcut
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // The ordered list of commands for ↑↓ history in the input
  const historyCommands = React.useMemo(
    () => allEntries.map((e) => e.command),
    [allEntries]
  );

  return (
    <>
      <SplitView
        storageKey="reterm-main"
        inspector={
          <HistoryPane
            onRerun={handleRerun}
          />
        }
        inspectorSize={{ default: 340, min: 280, max: 540 }}
      >
        <TerminalPane
          pendingRerun={pendingRerun}
          onPendingRerunConsumed={handlePendingRerunConsumed}
          onOpenPalette={handleOpenPalette}
          historyCommands={historyCommands}
        />
      </SplitView>
      {paletteOpen && (
        <CommandPalette
          entries={allEntries}
          onClose={() => setPaletteOpen(false)}
          onRun={handleRerun}
        />
      )}
    </>
  );
}
