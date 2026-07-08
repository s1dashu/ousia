# Technical Architecture

Ousia Desktop is an Electron + Vite + React app. The simplified app has no
Ousia extension runtime. The renderer hosts the sidebar, chat, and settings.

## Runtime Stack

- Electron Forge + Vite for main, preload, and renderer builds.
- React renderer with Tailwind/shadcn UI.
- Pi coding agent hosted in Electron main.
- Streamdown for assistant Markdown rendering.

Removed from this branch:

- Runtime extension loading from `~/.ousia/extensions`.
- Workspace extension registry, slots, tabs, and picker.
- Browser, Editor, PDF, Excalidraw, and Sheets workspace surfaces.
- Built-in right-side terminal and PTY host.
- Extension-owned state storage.
- Local `ousia extension ...` CLI bridge.
- Ousia extension usage skill injection into Pi sessions.

## Renderer

Main renderer entrypoints:

- `src/App.tsx`: shell state, sidebar/chat layout, persistence.
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

The old workspace abstraction and right-side terminal panel are gone. Shell
layout state only persists the sidebar width/collapse state and sidebar section
ordering.

## Electron Main

Main process entrypoints:

- `src/electron/main.ts`: registers IPC for app state, chat, models, project
  directory selection, window helpers, and logging.
- `src/electron/agent-conversations.ts`: owns Pi session creation, model
  selection, chat streaming, history, and interrupt handling.
- `src/electron/app-state-store.ts`: persists shell, settings, project, session,
  and window state.
- `src/electron/window-host.ts`: owns the BrowserWindow and window state.

## Preload API

`window.ousia` exposes only the narrow app APIs needed by the simplified shell:

- `loadAppState()`
- App-state transactions such as `saveAppSettings(payload)`,
  `saveShellLayout(payload)`, `saveAppSelection(payload)`, `createSession(payload)`,
  `deleteSession(payload)`, `renameSession(payload)`, `moveSession(payload)`,
  `reorderSessions(payload)`, `touchSession(payload)`, `createProject(payload)`,
  `deleteProject(payload)`, and `reorderProjects(payload)`
- `sendChatMessage(payload)`
- `generateChatTitle(payload)`
- `getChatHistory(payload)`
- `interruptChat(payload)`
- `listModels()`
- `checkPiEnvironment()`
- `savePiProviderCredential(payload)`
- `removePiProviderCredential(payload)`
- `openProjectDirectory()`
- `selectDirectory()`
- `getWindowFullscreenState()`
- `getWindowZoomState()`
- `onChatEvent(callback)`
- `onWindowFullscreenChange(callback)`
- `onWindowZoomChange(callback)`

## Agent Sessions

Each chat request includes `projectPath` and `sessionId`. Electron main expands
the project path, and hosts the bundled Pi coding agent runtime in Electron
main. Ousia always uses the user's local Pi agent directory as resolved by the
Pi SDK (`~/.pi/agent`, honoring `PI_CODING_AGENT_DIR`) for model config,
credentials, resources, and session history.

Ousia maps its sidebar `sessionId` to a Pi session with the same id in Pi's
default session directory for the project cwd. If the Pi session already exists,
it is opened; otherwise Ousia creates a new Pi session with that id. Provider
API keys entered through Ousia are saved through Pi's auth storage API as a
single-provider merge, preserving unrelated existing Pi credentials. For users,
the supported configuration entry points are Pi itself, usually through the Pi
TUI/login flow, and Ousia's settings UI; the concrete auth storage file is a
Pi-owned implementation detail.

On macOS, apps launched from Finder or a DMG do not inherit terminal shell
environment variables. During main-process startup, Ousia reads the user's shell
environment and imports missing variables into the Electron process so Pi can
see provider keys configured through shell startup files. Runtime logs record
only imported variable names, not values. For durable provider configuration,
users should configure Pi through Pi's own UI/commands or through Ousia's model
provider settings.

The app no longer installs an Ousia usage skill, filters a user `ousia` skill,
or prepends an `ousia` CLI shim to the agent environment.

## App State

App state schema version 2 stores settings, flat project/session indexes,
expanded project ids, shell layout, selected session, and window state. Settings
include appearance mode, Radix color scale, default workspace folder,
send-during-run mode, thinking level, selected model, and per-provider API keys.

Electron main owns the persisted project/session index. The renderer may keep
local UI state for responsiveness, but it persists project/session changes by
sending transaction intents to main and then syncing from the returned canonical
state. Renderer code must not save full app-state snapshots because stale
snapshots can overwrite newer session/project index changes.

`src/electron/app-state-store.ts` accepts the current schema only. Invalid or
older development-state files fall back to default state because this pre-release
app has not shipped a stable persistence contract yet.

## Runtime Logs

Runtime logs are written to:

```text
~/.ousia/logs/ousia-desktop.log
```

They include Electron main logs, renderer console messages, renderer uncaught
errors, and chat/title-generation failures.
