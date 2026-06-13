# Ousia Desktop Agent Guide

This file is an index, not the full project context. Read only the docs that
match the task.

## Start Here

- Product intent and scope: [docs/product-context.md](docs/product-context.md)
- UI direction and interaction rules: [docs/design-context.md](docs/design-context.md)
- Technical architecture: [docs/technical-architecture.md](docs/technical-architecture.md)
- Streamdown Markdown rendering: [docs/streamdown.md](docs/streamdown.md)
- shadcn/ui generated reference: [docs/shadcn-reference.md](docs/shadcn-reference.md)
- Current development state and commands: [docs/development-state.md](docs/development-state.md)

## High-Signal Facts

- The `simple-gui` branch is a reduced desktop agent client.
- The app shell is assembled from React surfaces: sidebar, chat, and a right
  terminal panel.
- There is no Ousia extension/runtime-extension/plugin surface in this branch.
- The right-side terminal is the only secondary surface. The chat header terminal
  icon expands it directly.
- The desktop runtime is Electron + Vite + React.
- The real coding agent is pi coding agent, hosted in Electron main process.
- Chat requests include `projectPath` and `sessionId`; pi sessions are isolated
  by project/session so tool execution uses the selected project as cwd.
- Default work dir is user configurable and defaults to `~/.ousia/workspace`.
- Runtime logs are persisted at `~/.ousia/logs/ousia-desktop.log`; check this
  file first for Electron main errors, renderer console messages, renderer
  uncaught errors, and chat/title-generation failures.

## Important Source Entrypoints

- App shell and current UI state: [src/App.tsx](src/App.tsx)
- Chat UI: [src/features/chat/ChatArea.tsx](src/features/chat/ChatArea.tsx)
- Right terminal panel: [src/features/terminal/TerminalPanel.tsx](src/features/terminal/TerminalPanel.tsx)
- Electron main process and pi session bridge: [src/electron/main.ts](src/electron/main.ts)
- Electron preload API: [src/electron/preload.ts](src/electron/preload.ts)
- Renderer IPC types: [src/electron/chat-types.ts](src/electron/chat-types.ts)
- Electron Forge config: [forge.config.cjs](forge.config.cjs)
- Forge Vite configs: [vite.main.config.ts](vite.main.config.ts), [vite.preload.config.ts](vite.preload.config.ts), [vite.renderer.config.ts](vite.renderer.config.ts)

## Working Rules For Future Agents

- Do not reintroduce Ousia extension, runtime extension, plugin, addon, browser,
  editor, PDF, Excalidraw, or Sheets workspace surfaces unless the user
  explicitly asks to reverse this branch direction.
- Do not inject an Ousia extension usage skill or CLI bridge into pi sessions.
- Keep the right panel terminal-first and direct; it is not a tabbed workspace.
- Preserve the shadcn preset theme direction unless the user explicitly changes
  it.
- Follow the project icon policy in `docs/design-context.md`: use Lucide for
  ordinary utility icons and Solar icons only for high-expression navigation or
  major workspace signals.
- Before changing shadcn/ui primitives, compare against the generated reference
  under `ref/`; see `docs/shadcn-reference.md`.
- When changing agent behavior, verify whether the change belongs in renderer
  state, Electron IPC, or pi session setup.
