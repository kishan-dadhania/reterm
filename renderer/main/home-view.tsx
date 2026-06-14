import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SplitView } from "@glaze/core/components";
import { TerminalPane } from "../components/terminal-pane";
import { HistoryPane } from "../components/history-pane";
import { CommandPalette } from "../components/command-palette";
import { TabBar } from "../components/tab-bar";
import { ProjectSwitcher } from "../components/project-switcher";
import type { CommandEntry, TerminalBlock, ProjectEntry } from "../lib/types";


interface Tab {
  id: string;
  cwd: string;
  blocks: TerminalBlock[];
  runningId: string | null;
}

export function HomeView() {
  const [tabs, setTabs] = React.useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = React.useState<string>("");
  const [pendingRerun, setPendingRerun] = React.useState<{ command: string; cwd: string; useOriginalCwd: boolean } | null>(null);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [projectSwitcherOpen, setProjectSwitcherOpen] = React.useState(false);


  const queryClient = useQueryClient();

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

  // Fetch projects list
  const projectsQuery = useQuery({
    queryKey: ["projects:index"],
    queryFn: () =>
      window.glazeAPI.glaze.ipc.invoke<{ projects: ProjectEntry[] }>("projects:index", {}).then((r) => r.projects),
    staleTime: 5 * 60 * 1000,
  });

  const projects = projectsQuery.data ?? [];
  const projectsLoading = projectsQuery.isLoading;


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
      const result = await window.glazeAPI.glaze.ipc.invoke<{ id: string }>("terminal:createSession", {
        initialCwd,
      });
      const newTab: Tab = {
        id: result.id,
        cwd: initialCwd || "~",
        blocks: [],
        runningId: null,
      };
      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(result.id);
    } catch (err) {
      console.error("[HomeView:createTabError]", err);
    }
  }, []);

  const handleCloseTab = React.useCallback(async (idToClose: string) => {
    if (tabs.length <= 1) return;
    try {
      await window.glazeAPI.glaze.ipc.invoke("terminal:destroySession", { sessionId: idToClose });
      const idx = tabs.findIndex((t) => t.id === idToClose);
      const newTabs = tabs.filter((t) => t.id !== idToClose);
      setTabs(newTabs);
      if (activeTabId === idToClose) {
        const nextActiveIdx = Math.max(0, idx - 1);
        setActiveTabId(newTabs[nextActiveIdx].id);
      }
    } catch (err) {
      console.error("[HomeView:closeTabError]", err);
    }
  }, [tabs, activeTabId]);

  const handleExecuteCommand = React.useCallback(
    async (cmd: string, execCwd?: string) => {
      if (!cmd || !activeTabId) return;
      const tab = tabs.find((t) => t.id === activeTabId);
      if (!tab || tab.runningId !== null) return;
      const targetCwd = execCwd ?? tab.cwd;

      try {
        const result = await window.glazeAPI.glaze.ipc.invoke<{ id: string }>("terminal:execute", {
          sessionId: activeTabId,
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

        setTabs((prev) =>
          prev.map((t) =>
            t.id === activeTabId
              ? {
                  ...t,
                  runningId: result.id,
                  blocks: [...t.blocks, newBlock],
                }
              : t
          )
        );

        queryClient.invalidateQueries({ queryKey: ["history:list:all"] });
        queryClient.invalidateQueries({ queryKey: ["history:list"] });
      } catch (err) {
        console.error("[Terminal:error]", err);
      }
    },
    [activeTabId, tabs, queryClient]
  );

  const handleInterruptCommand = React.useCallback(async () => {
    if (!activeTabId) return;
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab || !tab.runningId) return;
    try {
      await window.glazeAPI.glaze.ipc.invoke("terminal:interrupt", {
        id: tab.runningId,
        sessionId: activeTabId,
      });
    } catch (err) {
      console.error("[Terminal:interruptError]", err);
    }
  }, [activeTabId, tabs]);

  const handleChangeCwd = React.useCallback(
    async (newCwd: string) => {
      if (!activeTabId) return;
      const tab = tabs.find((t) => t.id === activeTabId);
      if (tab && tab.runningId !== null) {
        void handleCreateTab(newCwd);
        return;
      }
      try {
        await window.glazeAPI.glaze.ipc.invoke("terminal:changeCwd", {
          sessionId: activeTabId,
          cwd: newCwd,
        });
        setTabs((prev) =>
          prev.map((t) => (t.id === activeTabId ? { ...t, cwd: newCwd } : t))
        );
        queryClient.invalidateQueries({ queryKey: ["history:recentFolders"] });
      } catch (err) {
        console.error("[Terminal:changeCwdError]", err);
      }
    },
    [activeTabId, tabs, handleCreateTab, queryClient]
  );


  // Initialize tabs from backend or create first tab
  React.useEffect(() => {
    const init = async () => {
      try {
        const result = await window.glazeAPI.glaze.ipc.invoke<{
          sessions: { id: string; cwd: string; runningId: string | null }[];
        }>("terminal:listSessions", {});

        if (result.sessions && result.sessions.length > 0) {
          const mappedTabs: Tab[] = result.sessions.map((s) => ({
            id: s.id,
            cwd: s.cwd,
            blocks: [],
            runningId: s.runningId,
          }));
          setTabs(mappedTabs);
          setActiveTabId(mappedTabs[0].id);
        } else {
          void handleCreateTab();
        }
      } catch (err) {
        console.error("[HomeView:initError]", err);
        void handleCreateTab();
      }
    };
    void init();
  }, []);

  // Listen to output and exit notifications globally
  React.useEffect(() => {
    const unsubOutput = window.glazeAPI.glaze.ipc.onNotification(
      "terminal:output",
      (params: unknown) => {
        const { sessionId, id, chunk, stream } = params as {
          sessionId: string;
          id: string;
          chunk: string;
          stream: "stdout" | "stderr";
        };
        setTabs((prev) =>
          prev.map((t) =>
            t.id === sessionId
              ? {
                  ...t,
                  blocks: t.blocks.map((b) =>
                    b.id === id
                      ? { ...b, chunks: [...b.chunks, { text: chunk, stream }] }
                      : b
                  ),
                }
              : t
          )
        );
      }
    );

    const unsubExit = window.glazeAPI.glaze.ipc.onNotification(
      "terminal:exit",
      (params: unknown) => {
        const { sessionId, id, exitCode, cwd: newCwd, durationMs } = params as {
          sessionId: string;
          id: string;
          exitCode: number;
          cwd: string;
          durationMs: number;
        };
        setTabs((prev) =>
          prev.map((t) =>
            t.id === sessionId
              ? {
                  ...t,
                  cwd: newCwd,
                  runningId: t.runningId === id ? null : t.runningId,
                  blocks: t.blocks.map((b) =>
                    b.id === id
                      ? { ...b, exitCode, durationMs, running: false, cwd: newCwd }
                      : b
                  ),
                }
              : t
          )
        );
        queryClient.invalidateQueries({ queryKey: ["history:list:all"] });
        queryClient.invalidateQueries({ queryKey: ["history:list"] });
        queryClient.invalidateQueries({ queryKey: ["history:recentFolders"] });
      }
    );

    return () => {
      unsubOutput();
      unsubExit();
    };
  }, [queryClient]);

  // Listen to projects rescan updates
  React.useEffect(() => {
    const unsubIndexReady = window.glazeAPI.glaze.ipc.onNotification(
      "projects:indexReady",
      () => {
        queryClient.invalidateQueries({ queryKey: ["projects:index"] });
      }
    );
    return () => {
      unsubIndexReady();
    };
  }, [queryClient]);


  // Global keyboard shortcuts
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // ⌘K to search history
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      // ⌘P or ⌥P to open project switcher
      if (((e.metaKey || e.ctrlKey) && e.key === "p") || (e.altKey && e.key === "p") || (e.altKey && e.key === "π")) {
        e.preventDefault();
        setProjectSwitcherOpen((v) => !v);
        return;
      }

      // ⌘T to create tab
      if ((e.metaKey || e.ctrlKey) && e.key === "t") {
        e.preventDefault();
        void handleCreateTab();
        return;
      }
      // ⌘W to close tab
      if ((e.metaKey || e.ctrlKey) && e.key === "w") {
        e.preventDefault();
        void handleCloseTab(activeTabId);
        return;
      }
      // ⌘1 to ⌘9 to switch tabs
      if ((e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const tabIdx = parseInt(e.key, 10) - 1;
        if (tabs[tabIdx]) {
          setActiveTabId(tabs[tabIdx].id);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [tabs, activeTabId, handleCreateTab, handleCloseTab]);

  // The ordered list of commands for ↑↓ history in the input
  const historyCommands = React.useMemo(
    () => allEntries.map((e) => e.command),
    [allEntries]
  );

  const activeTab = React.useMemo(
    () => tabs.find((t) => t.id === activeTabId),
    [tabs, activeTabId]
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
              blocks={activeTab.blocks}
              runningId={activeTab.runningId}
              onChangeCwd={handleChangeCwd}
              executeCommand={handleExecuteCommand}
              interruptCommand={handleInterruptCommand}
              pendingRerun={pendingRerun}
              onPendingRerunConsumed={handlePendingRerunConsumed}
              onOpenPalette={handleOpenPalette}
              historyCommands={historyCommands}
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
          isLoading={projectsLoading}
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
