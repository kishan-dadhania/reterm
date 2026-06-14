import * as React from "react";
import { SplitView } from "@glaze/core/components";
import { TerminalPane } from "../components/terminal-pane";
import { HistoryPane } from "../components/history-pane";

export function HomeView() {
  const [pendingRerun, setPendingRerun] = React.useState<{ command: string; cwd: string } | null>(null);

  const handleRerun = React.useCallback((command: string, cwd: string) => {
    setPendingRerun({ command, cwd });
  }, []);

  const handlePendingRerunConsumed = React.useCallback(() => {
    setPendingRerun(null);
  }, []);

  return (
    <SplitView
      storageKey="reterm-main"
      inspector={<HistoryPane onRerun={handleRerun} />}
      inspectorSize={{ default: 320, min: 260, max: 520 }}
    >
      <TerminalPane
        pendingRerun={pendingRerun}
        onPendingRerunConsumed={handlePendingRerunConsumed}
      />
    </SplitView>
  );
}
