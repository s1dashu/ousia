# Technical Architecture

Ousia Desktop is an Electron + Vite + React app. On the `simple-gui` branch,
the app has no Ousia extension runtime. The renderer hosts sidebar, chat, and a
single terminal panel.

## Runtime Stack

- Electron Forge + Vite for main, preload, and renderer builds.
- React renderer with Tailwind/shadcn UI.
- pi coding agent hosted in Electron main.
- xterm.js + node-pty for the right-side terminal.
- Streamdown for assistant Markdown rendering.

Removed from this branch:

- Runtime extension loading from `~/.ousia/extensions`.
- Workspace extension registry, slots, tabs, and picker.
- Browser, Editor, PDF, Excalidraw, and Sheets workspace surfaces.
- Extension-owned state storage.
- Local `ousia extension ...` CLI bridge.
- Ousia extension usage skill injection into pi sessions.

## Renderer

Main renderer entrypoints:

- `src/App.tsx`: shell state, sidebar/chat/terminal layout, persistence.
- `src/features/chat/ChatArea.tsx`: chat history, input, attachments, controls.
- `src/features/chat/ChatHeader.tsx`: chat title bar actions.
- `src/features/chat/ChatMessageList.tsx`: assistant/user/system message
  rendering.
- `src/features/chat/ChatComposerParts.tsx`: queued message and attachment
  composer subcomponents.
- `src/features/chat/ChatToolCall.tsx`: tool call rendering and payload
  expansion.
- `src/features/settings/SettingsPage.tsx`: settings form and provider key
  management.
- `src/features/sidebar/Sidebar.tsx`: project/session/settings navigation.
- `src/features/terminal/TerminalPanel.tsx`: xterm terminal mounted in the
  right panel.

The old workspace abstraction is gone. `TerminalPanel` receives
`projectPath`, `sessionId`, and `resolvedTheme` directly from `App`. Shell
layout state uses terminal-panel names such as `terminalPanelWidth` and
`isTerminalPanelCollapsed`.

## Electron Main

Main process entrypoints:

- `src/electron/main.ts`: registers IPC for app state, chat, models, project
  directory selection, window helpers, logging, and project PTY.
- `src/electron/agent-conversations.ts`: owns pi session creation, model
  selection, chat streaming, history, and interrupt handling.
- `src/electron/project-terminal.ts`: owns node-pty lifecycle.
- `src/electron/app-state-store.ts`: persists shell, settings, project, session,
  and window state.
- `src/electron/window-host.ts`: owns the BrowserWindow and window state.

## Preload API

`window.ousia` exposes only the narrow app APIs needed by the simplified shell:

- `loadAppState()` / `saveAppState(payload)`
- `sendChatMessage(payload)`
- `generateChatTitle(payload)`
- `getChatHistory(payload)`
- `interruptChat(payload)`
- `listModels()`
- `openProjectDirectory()`
- `selectDirectory()`
- `ensureWindowWidth(payload)`
- `getWindowFullscreenState()`
- `createTerminal(payload)`
- `writeTerminal(payload)`
- `resizeTerminal(payload)`
- `disposeTerminal(payload)`
- `onTerminalEvent(callback)`
- `onChatEvent(callback)`
- `onWindowFullscreenChange(callback)`

## Agent Sessions

Each chat request includes `projectPath` and `sessionId`. Electron main expands
the project path, creates a pi agent dir under `userData/pi-agent`, and stores
conversation history under `userData/sessions/<project>/<session>`.

The app no longer installs an Ousia usage skill, filters a user `ousia` skill,
or prepends an `ousia` CLI shim to the agent environment.

## App State

App state schema version 2 stores settings, flat project/session indexes,
expanded project ids, shell layout, selected session, and window state. Settings
include appearance mode, Radix color scale, default work dir, send-during-run
mode, thinking level, selected model, and per-provider API keys.

`src/electron/app-state-store.ts` accepts the current schema only. Invalid or
older development-state files fall back to default state because this dev branch
has not shipped a stable persistence contract yet.

## Terminal Resources

Terminal resources live under `src/features/terminal/resources` and are packaged
to the Electron resources directory as `terminal`.

Bundled Starship binaries may live at:

```text
src/features/terminal/resources/vendor/starship/<platform>-<arch>/starship
```

`src/electron/project-terminal.ts` uses the bundled binary when present and
falls back to the user's installed `starship`, then to a compact built-in prompt.

## Runtime Logs

Runtime logs are written to:

```text
~/.ousia/logs/ousia-desktop.log
```

They include Electron main logs, renderer console messages, renderer uncaught
errors, and chat/title-generation failures.
