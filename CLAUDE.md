# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Reterm

Desktop app (Glaze framework) that records every terminal command with timestamp, cwd, and exit status, then lets the user search, label, save, and re-run history. Built on the Glaze SDK (`@glaze/core`), which provides Electron-like `BrowserWindow`, `ipcMain`, `app`, `dialog`, `logger`, and a React component library.

## Commands

All scripts go through the `glaze` CLI wrapper (`glaze.ts`):

- `npm run dev` — start app with both main and renderer in dev mode
- `npm run dev:renderer` — renderer-only (Vite) dev mode
- `npm run build` — production build (main → esbuild, renderer → Vite)
- `npm run type-check` — TypeScript check across main + renderer
- `npm run lint` — ESLint
- `npm run format` — oxfmt

Node ≥ 24 is required.

## Architecture

Two TypeScript projects share one repo, communicating via IPC:

### Main process (`main/`)
Node backend, entrypoint `main/index.ts`. The Glaze runtime bootstraps IPC and the native bridge before `index.ts` runs; the entry just registers handlers and creates `BrowserWindow`s.

- `main/handlers/` — IPC handlers registered through `ipcMain.handle(channel, ...)`. `reterm.ts` defines the full `terminal:*`, `history:*`, `settings:*`, `dialog:*`, `projects:*` contract. Handlers validate untyped IPC payloads with the local `assertString` / `assertOptional*` guards before dispatching to services. State-change handlers call `ipcMain.broadcast("history:changed", {})` so renderer queries can refetch.
- `main/services/` — business logic, no IPC concerns:
  - `command-runner.ts` — multi-session shell executor; tracks per-session cwd.
  - `history-store.ts` — JSON persistence at `app.getPath("userData")/reterm-history.json` (+ `reterm-settings.json`). Uses in-memory caches (`historyCache`, `settingsCache`); `initHistoryStore()` warms them and runs retention cleanup (drops non-saved entries older than `retentionDays`, preserving shell-imports).
  - `shell-history.ts` — imports `~/.zsh_history` / `~/.bash_history`.
  - `project-discovery.ts` — cached folder index for the project switcher.
- `main/windows/` — `BrowserWindow` factory for the secondary settings window, plus `window-paths.ts` which resolves dev-server vs. built-file URLs and preload script paths.

### Renderer (`renderer/`)
React 19 + React Compiler, TanStack Router (memory history), TanStack Query, Radix UI + Tailwind v4. Two HTML entrypoints map to two roots:

- `main-window.html` → `renderer/main/index.tsx` → router with a single `/` route rendering `HomeView` inside `RootView`. UI is composed of `components/tab-bar.tsx`, `terminal-pane.tsx`, `history-pane.tsx`, `command-palette.tsx`, `project-switcher.tsx`.
- `settings-window.html` → `renderer/settings/index.tsx` → `settings-view.tsx`.

`renderer/preload.ts` exposes the typed IPC bridge to the window. `renderer/lib/types.ts` mirrors `main/services/types.ts` for the wire contract — keep them in sync when changing IPC shapes.

### Adding a new IPC endpoint
1. Add the service function in `main/services/`.
2. Register the channel in `main/handlers/reterm.ts` with input guards; broadcast `history:changed` if mutating state observed by lists.
3. Add the matching typed wrapper in `renderer/preload.ts` and types in `renderer/lib/types.ts`.
4. Consume via TanStack Query in the renderer; invalidate on the `history:changed` broadcast.

## Glaze specifics

- Import backend APIs from `@glaze/core/backend` (`app`, `BrowserWindow`, `ipcMain`, `dialog`, `Menu`, `logger`). Do not import from `electron` directly.
- Renderer component primitives come from `@glaze/core/components` (`TooltipProvider`, `Toaster`, `ErrorBoundaryView`).
- The runtime injects `__APP_DISPLAY_NAME__` at build time.
- `package.json#glaze` holds SDK metadata (`sdkVersion`, capabilities, migrations) — generally not hand-edited.
