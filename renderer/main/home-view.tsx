import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SplitView } from "@glaze/core/components";
import { TerminalPane } from "../components/terminal-pane";
import { HistoryPane } from "../components/history-pane";
import { CommandPalette } from "../components/command-palette";
import { TabBar } from "../components/tab-bar";
import { ProjectSwitcher } from "../components/project-switcher";
import type { CommandEntry, ProjectEntry } from "../lib/types";

interface Tab {
  id: string;
  cwd: string;
  running: boolean;
}

export function HomeView() {
  const [tabs, setTabs] = React.useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = React.useState<string>("");
  const [pendingRerun, setPendingRerun] = React.useState<{
    command: string;
    cwd: string;
    useOriginalCwd: boolean;
  } | null>(null);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [projectSwitcherOpen, setProjectSwitcherOpen] = React.useState(false);

  const queryClient = useQueryClient();

  const allEntriesQuery = useQuery({
    queryKey: ["history:list:all"],
    queryFn: () =>
      window.glazeAPI.glaze.ipc
        .invoke<{ entries: CommandEntry[] }>("history:list", { limit: 2000 })
        .then((r) => r.entries),
    staleTime: 30_000,
  });
  const allEntries = allEntriesQuery.data ?? [];

  const projectsQuery = useQuery({
    queryKey: ["projects:index"],
    queryFn: () =>
      window.glazeAPI.glaze.ipc
        .invoke<{ projects: ProjectEntry[] }>("projects:index", {})
        .then((r) => r.projects),
    staleTime: 5 * 60 * 1000,
  });
  const projects = projectsQuery.data ?? [];

  const handleRerun = React.useCallback((command: string, cwd: string, useOriginalCwd: boolean) => {
    setPendingRerun({ command, cwd, useOriginalCwd });
  }, []);

  const handlePendingRerunConsumed = React.useCallback(() => {
    setPendingRerun(null);
  }, []);

  const handleOpenPalette = React.useCallback(() => {
    setPaletteOpen(true);
  }, []);

  const handleCreateTab = React.useCallback(async (initialCwd?: string) => {
    try {
      const result = await window.glazeAPI.glaze.ipc.invoke<{ id: string }>(
        "terminal:createSession",
        { initialCwd, cols: 80, rows: 24 },
      );
      const newTab: Tab = {
        id: result.id,
        cwd: initialCwd || "~",
        running: false,
      };
      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(result.id);
    } catch (err) {
      console.error("[HomeView:createTabError]", err);
    }
  }, []);

  const handleCloseTab = React.useCallback(
    async (idToClose: string) => {
      if (tabs.length <= 1) return;
      try {
        await window.glazeAPI.glaze.ipc.invoke("terminal:destroySession", {
          sessionId: idToClose,
        });
        const idx = tabs.findIndex((t) => t.id === idToClose);
        const newTabs = tabs.filter((t) => t.id !== idToClose);
        setTabs(newTabs);
        if (activeTabId === idToClose) {
          setActiveTabId(newTabs[Math.max(0, idx - 1)].id);
        }
      } catch (err) {
        console.error("[HomeView:closeTabError]", err);
      }
    },
    [tabs, activeTabId],
  );

  // Type a command into the active PTY (used by rerun, palette).
  const handleExecuteCommand = React.useCallback(
    async (cmd: string, _execCwd?: string) => {
      if (!cmd || !activeTabId) return;
      try {
        await window.glazeAPI.glaze.ipc.invoke("terminal:execute", {
          sessionId: activeTabId,
          command: cmd,
        });
      } catch (err) {
        console.error("[Terminal:error]", err);
      }
    },
    [activeTabId],
  );

  const handleInterruptCommand = React.useCallback(async () => {
    if (!activeTabId) return;
    try {
      await window.glazeAPI.glaze.ipc.invoke("terminal:interrupt", {
        id: "",
        sessionId: activeTabId,
      });
    } catch (err) {
      console.error("[Terminal:interruptError]", err);
    }
  }, [activeTabId]);

  // Programmatic cd via the persistent shell.
  const handleChangeCwd = React.useCallback(
    async (newCwd: string) => {
      if (!activeTabId) return;
      try {
        await window.glazeAPI.glaze.ipc.invoke("terminal:changeCwd", {
          sessionId: activeTabId,
          cwd: newCwd,
        });
        // Optimistic: real cwd comes back via terminal:cwd OSC 7 event.
        setTabs((prev) => prev.map((t) => (t.id === activeTabId ? { ...t, cwd: newCwd } : t)));
        queryClient.invalidateQueries({ queryKey: ["history:recentFolders"] });
      } catch (err) {
        console.error("[Terminal:changeCwdError]", err);
      }
    },
    [activeTabId, queryClient],
  );

  // Restore sessions or create the first one.
  React.useEffect(() => {
    let cancelled = false;
    const init = async () => {
      try {
        const result = await window.glazeAPI.glaze.ipc.invoke<{
          sessions: { id: string; cwd: string; runningId: string | null }[];
        }>("terminal:listSessions", {});
        if (cancelled) return;
        if (result.sessions && result.sessions.length > 0) {
          const mapped: Tab[] = result.sessions.map((s) => ({
            id: s.id,
            cwd: s.cwd,
            running: s.runningId !== null,
          }));
          setTabs(mapped);
          setActiveTabId(mapped[0].id);
        } else {
          void handleCreateTab();
        }
      } catch (err) {
        console.error("[HomeView:initError]", err);
        void handleCreateTab();
      }
    };
    void init();
    return () => {
      cancelled = true;
    };
  }, [handleCreateTab]);

  // Listen for command boundaries + cwd updates to drive running/cwd state
  // and to invalidate the history queries.
  React.useEffect(() => {
    const unsubStart = window.glazeAPI.glaze.ipc.onNotification(
      "terminal:commandStart",
      (params: unknown) => {
        const p = params as { sessionId: string; cwd: string };
        setTabs((prev) =>
          prev.map((t) => (t.id === p.sessionId ? { ...t, running: true, cwd: p.cwd } : t)),
        );
        queryClient.invalidateQueries({ queryKey: ["history:list:all"] });
        queryClient.invalidateQueries({ queryKey: ["history:list"] });
      },
    );
    const unsubEnd = window.glazeAPI.glaze.ipc.onNotification(
      "terminal:commandEnd",
      (params: unknown) => {
        const p = params as { sessionId: string; cwd: string };
        setTabs((prev) =>
          prev.map((t) => (t.id === p.sessionId ? { ...t, running: false, cwd: p.cwd } : t)),
        );
        queryClient.invalidateQueries({ queryKey: ["history:list:all"] });
        queryClient.invalidateQueries({ queryKey: ["history:list"] });
        queryClient.invalidateQueries({ queryKey: ["history:recentFolders"] });
      },
    );
    const unsubCwd = window.glazeAPI.glaze.ipc.onNotification(
      "terminal:cwd",
      (params: unknown) => {
        const p = params as { sessionId: string; cwd: string };
        setTabs((prev) => prev.map((t) => (t.id === p.sessionId ? { ...t, cwd: p.cwd } : t)));
      },
    );
    const unsubClosed = window.glazeAPI.glaze.ipc.onNotification(
      "terminal:closed",
      (params: unknown) => {
        const p = params as { sessionId: string };
        setTabs((prev) => prev.filter((t) => t.id !== p.sessionId));
      },
    );
    return () => {
      unsubStart();
      unsubEnd();
      unsubCwd();
      unsubClosed();
    };
  }, [queryClient]);

  React.useEffect(() => {
    const unsubIndexReady = window.glazeAPI.glaze.ipc.onNotification(
      "projects:indexReady",
      () => {
        queryClient.invalidateQueries({ queryKey: ["projects:index"] });
      },
    );
    return () => {
      unsubIndexReady();
    };
  }, [queryClient]);

  // Global shortcuts. xterm consumes most keystrokes when focused, so these
  // only fire when chrome (toolbar, dialogs) has focus — which is fine for
  // ⌘K/⌘P/⌘T/⌘W since those are command-key combos that should work anywhere.
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const cmd = e.metaKey || e.ctrlKey;
      if (cmd && e.key === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if ((cmd && e.key === "p") || (e.altKey && (e.key === "p" || e.key === "π"))) {
        e.preventDefault();
        setProjectSwitcherOpen((v) => !v);
        return;
      }
      if (cmd && e.key === "t") {
        e.preventDefault();
        void handleCreateTab();
        return;
      }
      if (cmd && e.key === "w") {
        e.preventDefault();
        void handleCloseTab(activeTabId);
        return;
      }
      if (cmd && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const idx = parseInt(e.key, 10) - 1;
        if (tabs[idx]) setActiveTabId(tabs[idx].id);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [tabs, activeTabId, handleCreateTab, handleCloseTab]);

  const activeTab = React.useMemo(
    () => tabs.find((t) => t.id === activeTabId),
    [tabs, activeTabId],
  );

  return (
    <>
      <SplitView
        storageKey="reterm-main"
        inspector={<HistoryPane onRerun={handleRerun} />}
        inspectorSize={{ default: 340, min: 280, max: 540 }}
      >
        <div className="h-full flex flex-col overflow-hidden">
          {tabs.length > 0 && (
            <TabBar
              tabs={tabs.map((t, idx) => ({
                id: t.id,
                cwd: t.cwd,
                label: `Tab ${idx + 1}`,
              }))}
              activeTabId={activeTabId}
              onSelect={setActiveTabId}
              onCreate={() => void handleCreateTab()}
              onClose={(id) => void handleCloseTab(id)}
            />
          )}
          {activeTab ? (
            <TerminalPane
              key={activeTab.id}
              sessionId={activeTab.id}
              cwd={activeTab.cwd}
              running={activeTab.running}
              onChangeCwd={handleChangeCwd}
              executeCommand={handleExecuteCommand}
              interruptCommand={handleInterruptCommand}
              pendingRerun={pendingRerun}
              onPendingRerunConsumed={handlePendingRerunConsumed}
              onOpenPalette={handleOpenPalette}
              onOpenProjectSwitcher={() => setProjectSwitcherOpen(true)}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-9 bg-gray-a1">
              Loading sessions...
            </div>
          )}
        </div>
      </SplitView>
      {paletteOpen && (
        <CommandPalette
          entries={allEntries}
          onClose={() => setPaletteOpen(false)}
          onRun={handleRerun}
        />
      )}
      {projectSwitcherOpen && (
        <ProjectSwitcher
          projects={projects}
          isLoading={projectsQuery.isLoading}
          onClose={() => setProjectSwitcherOpen(false)}
          onSelect={(selectedPath) => {
            void handleChangeCwd(selectedPath);
            setProjectSwitcherOpen(false);
          }}
        />
      )}
    </>
  );
}
