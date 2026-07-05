# Ousia Desktop Agent Guide

This file is an index, not the full project context. Read only the docs that
match the task.

## Start Here

- Product intent and scope: [docs/product-context.md](docs/product-context.md)
- UI direction and interaction rules: [docs/design-context.md](docs/design-context.md)
- Technical architecture: [docs/technical-architecture.md](docs/technical-architecture.md)
- Streamdown Markdown rendering: [docs/streamdown.md](docs/streamdown.md)
- shadcn/ui local reference workflow: [docs/shadcn-reference.md](docs/shadcn-reference.md)
- Current development state and commands: [docs/development-state.md](docs/development-state.md)

## High-Signal Facts

- The current app is a reduced desktop agent client.
- The app shell is assembled from React surfaces: sidebar, chat, and settings.
- There is no Ousia extension/runtime-extension/plugin surface in this branch.
- The desktop runtime is Electron + Vite + React.
- The real coding agent is Pi coding agent, hosted in Electron main process.
- Chat requests include `projectPath` and `sessionId`; Pi sessions are isolated
  by project/session so tool execution uses the selected project as cwd.
- Default workspace folder is user configurable and defaults to
  `~/Documents/Ousia`.
- Runtime logs are persisted at `~/.ousia/logs/ousia-desktop.log`; check this
  file first for Electron main errors, renderer console messages, renderer
  uncaught errors, and chat/title-generation failures.

## Important Source Entrypoints

- App shell and current UI state: [src/App.tsx](src/App.tsx)
- Chat UI: [src/features/chat/ChatArea.tsx](src/features/chat/ChatArea.tsx)
- Electron main process and Pi session bridge: [src/electron/main.ts](src/electron/main.ts)
- Electron preload API: [src/electron/preload.ts](src/electron/preload.ts)
- Renderer IPC types: [src/electron/chat-types.ts](src/electron/chat-types.ts)
- Electron Forge config: [forge.config.cjs](forge.config.cjs)
- Forge Vite configs: [vite.main.config.ts](vite.main.config.ts), [vite.preload.config.ts](vite.preload.config.ts), [vite.renderer.config.ts](vite.renderer.config.ts)

## Working Rules For Future Agents

- 优先定位问题的根本原因并修复根因；不要只为当前坏数据或单个 badcase
  做补丁式恢复，除非用户明确要求先救数据。
- This is a new project; do not add backward-compatibility migrations, legacy
  config shims, or old-option fallbacks unless the user explicitly asks for
  them.
- Do not reintroduce Ousia extension, runtime extension, plugin, addon, browser,
  editor, PDF, Excalidraw, or Sheets workspace surfaces unless the user
  explicitly asks to reverse this branch direction.
- Do not inject an Ousia extension usage skill or CLI bridge into Pi sessions.
- Preserve the shadcn preset theme direction unless the user explicitly changes
  it.
- Keep primary floating panels, menus, popovers, dialogs, and dropdown surfaces
  pure white. Paper is an auxiliary/background color, not the main panel color.
- Match those floating surfaces to the composer default surface treatment:
  `0.5px` foreground/10 border and the shared
  `--ousia-floating-panel-shadow`, which is slightly stronger than the composer
  shadow; avoid thicker borders, diffuse shadows, or ad hoc panel shadows.
- Before building a fresh app package, check whether there are code changes. If
  code has changed since the previous package, bump the app version first so the
  new package has a new version number.
- Follow the project icon policy in `docs/design-context.md`: use HugeIcons for
  interface icons and route imports through `src/components/icons/huge-icons.tsx`.
- Before changing shadcn/ui primitives, compare against a local generated
  reference under ignored `ref/`; see `docs/shadcn-reference.md`.
- When changing agent behavior, verify whether the change belongs in renderer
  state, Electron IPC, or Pi session setup.
- Tool call disclosure state is renderer-local UI memory in `localStorage`
  under `ousia.chat.toolDisclosure.v1`; do not persist it into chat history.
- Streaming chat performance depends on preserving memo boundaries: compare
  render wrapper objects by their underlying `ChatItem` references. Do not
  defer actively streaming write/edit diff previews; live code output is a core
  chat experience.
- Pi `tool_execution_update` events carry both `args` and `partialResult`;
  use `args` to refresh write/edit file previews, while preserving
  `partialResult` for tool output streams.
- Chromium native scrollbar thumb drags can emit chat `scroll` events without
  preceding pointer, wheel, or touch events. Infer user history-scroll intent
  from an upward `scrollTop` delta before auto-following the latest message.
- Keep sidebar row surfaces inset with explicit margins; avoid negative row
  margins that make selected/session rows eat the left padding.
