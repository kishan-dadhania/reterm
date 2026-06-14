import { PlusIcon, XIcon, FolderIcon } from "lucide-react";

function shortenPath(p: string): string {
  if (!p) return "~";
  const parts = p.split("/").filter(Boolean);
  if (parts.length === 0) return "/";
  if (parts.length <= 2) return `/${parts.join("/")}`;
  return `…/${parts.slice(-2).join("/")}`;
}

interface TabBarProps {
  tabs: { id: string; cwd: string; label: string }[];
  activeTabId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onClose: (id: string) => void;
}

export function TabBar({ tabs, activeTabId, onSelect, onCreate, onClose }: TabBarProps) {
  return (
    <div
      className="flex items-center border-b border-gray-a3 pl-[76px] pr-2 py-1 gap-1 shrink-0 select-none overflow-x-auto"
      style={{ background: "hsl(0 0% 0% / 0.12)" }}
    >
      {tabs.map((tab, idx) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            onClick={() => onSelect(tab.id)}
            className={[
              "group flex items-center gap-1.5 px-3 py-1.5 rounded-md text-caption1 cursor-pointer transition-all border border-transparent min-w-0 max-w-44 shrink-0",
              isActive
                ? "bg-gray-a3 text-gray-12 border-gray-a4 font-medium"
                : "text-gray-9 hover:bg-gray-a2 hover:text-gray-11",
            ].join(" ")}
            style={isActive ? { borderBottom: "2px solid var(--rt-accent)", borderRadius: "6px 6px 0 0" } : {}}
          >
            <FolderIcon className="size-3 text-gray-8 shrink-0" />
            <span className="truncate rt-mono text-[11px]" title={tab.cwd}>
              {shortenPath(tab.cwd)}
            </span>
            <span className="text-[10px] text-gray-6 group-hover:hidden ml-1">⌘{idx + 1}</span>
            {tabs.length > 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.id);
                }}
                className="hidden group-hover:inline-flex items-center justify-center p-0.5 rounded-full hover:bg-gray-a4 text-gray-8 hover:text-gray-12 transition-colors ml-1 shrink-0"
                aria-label="Close tab"
              >
                <XIcon className="size-3" />
              </button>
            )}
          </div>
        );
      })}
      <button
        onClick={onCreate}
        className="p-1.5 rounded-md hover:bg-gray-a3 text-gray-9 hover:text-gray-12 transition-colors shrink-0 ml-1"
        title="New Tab (⌘T)"
        aria-label="New Tab"
      >
        <PlusIcon className="size-3.5" />
      </button>
    </div>
  );
}
