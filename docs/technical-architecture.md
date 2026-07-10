# Technical Architecture

Ousia Desktop is an Electron + Vite + React app. The simplified app has no
user-local Ousia extension runtime. The renderer hosts the sidebar, chat, and
settings. A separate compile-time product boundary is being extracted as
versioned `@ousia/*` packages; see
[product-extensions.md](product-extensions.md).

## Runtime Stack

- Electron Forge + Vite for main, preload, and renderer builds.
- React renderer with Tailwind/shadcn UI.
- Pi coding agent and bundled Codex app-server hosted in Electron main.
- Streamdown for assistant Markdown rendering.
- npm workspaces for public, built Ousia packages. The first package,
  `@ousia/extension-api`, has no runtime-framework dependencies.

Removed from this branch:

- Runtime extension loading from `~/.ousia/extensions`.
- Workspace extension registry, slots, tabs, and picker.
- Browser, Editor, PDF, Excalidraw, and Sheets workspace surfaces.
- Built-in right-side terminal and PTY host.
- Extension-owned state storage.
- Local `ousia extension ...` CLI bridge.
- Ousia extension usage skill injection into Pi sessions.

These removals concern the old runtime loader. They do not prohibit explicit
compile-time products from registering provider-neutral tools or private
Workspace Apps through the public contracts.

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

The shell surfaces are memoized and receive stable event callbacks. Chat event
reduction preserves object references for no-op events and copies only the
changed item path, so active streaming does not invalidate unrelated shell or
history subtrees.

The old workspace abstraction and right-side terminal panel are gone. Shell
layout state only persists the sidebar width/collapse state and sidebar section
ordering.

## Electron Main

Main process entrypoints:

- `src/electron/main.ts`: registers IPC for app state, chat, models, project
  directory selection, window helpers, and logging.
- `src/electron/agent-provider-router.ts`: routes generic chat IPC by the
  canonical per-session agent provider.
- `src/electron/agent-conversations.ts`: owns Pi session creation, model
  selection, chat streaming, history, and interrupt handling.
- `src/electron/codex-app-server-client.ts`: owns the bundled native Codex
  process, JSONL RPC, lifecycle, and sanitized diagnostics.
- `src/electron/codex-agent-provider.ts`: adapts Codex threads, turns, items,
  authentication, history, and tools to Ousia chat contracts.
- `src/electron/app-state-store.ts`: persists shell, settings, project, session,
  and window state.
- `src/electron/window-host.ts`: owns the BrowserWindow and window state.
- `src/electron/ousia-product.ts`: supplies Ousia's validated product identity
  and desktop path policy to the composition root.

## Public Package Boundary

`packages/extension-api` defines environment-neutral codecs and registries for
product identity, Agent tools, and Workspace Apps. Ousia Desktop imports this
package through its npm workspace instead of importing package source by
relative path. Package builds run before app start, tests, typecheck, and
packaging, so consumers always resolve generated JavaScript and declarations
from `dist`.

Future host/UI extraction must preserve the runtime split: Electron lifecycle,
canonical path authorization, provider adapters, scope tombstones, and state IO
belong to the host; React panel chrome belongs to desktop UI; a downstream
Workspace App owns its renderer, state/event codec, effects, file policy, and
product dependencies.

The first window uses a fast persisted-state load and does not wait for shell
environment hydration or Pi SDK parsing. Provider-heavy modules are imported at
their first capability boundary. Adjacent text deltas are coalesced for one
short frame window in main before renderer IPC, while non-delta events retain
strict ordering.

Ordinary main-process app-state reads never import Pi. The renderer's initial
state IPC first awaits shell-environment hydration and then explicitly
synchronizes Pi's retry preference, preventing environment/package-path races.

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
- `checkCodexEnvironment()`, `loginCodexWithChatGPT()`, and `logoutCodex()`
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

Each chat request includes `projectPath` and `sessionId`. Electron main resolves
the canonical session record, derives its project path from the persisted
project/default-workspace index, rejects a mismatched renderer path, and routes
the canonical context to the immutable Pi or Codex provider. Both providers
execute with that canonical project as cwd; renderer input never expands an
agent sandbox boundary.

Ousia hosts the bundled Pi coding agent runtime in Electron main and uses the
user's local Pi agent directory as resolved by the Pi SDK (`~/.pi/agent`,
honoring `PI_CODING_AGENT_DIR`) for model config, credentials, resources, and
session history.

Ousia maps its sidebar `sessionId` to a Pi session with the same id in Pi's
default session directory for the project cwd. If the Pi session already exists,
it is opened; otherwise Ousia creates a new Pi session with that id. Provider
API keys entered through Ousia are saved through Pi's auth storage API as a
single-provider merge, preserving unrelated existing Pi credentials. For users,
the supported configuration entry points are Pi itself, usually through the Pi
TUI/login flow, and Ousia's settings UI; the concrete auth storage file is a
Pi-owned implementation detail.

Live Pi AgentSessions use a bounded idle-only LRU. Active, queued, or
shell-running sessions are retained until idle. Deleting a session/project
releases provider-local state; Pi listeners are unsubscribed and the session is
disposed, while Codex thread/context maps are cleared. Disk history remains the
source for lossless recreation after an idle eviction.

On macOS, apps launched from Finder or a DMG do not inherit terminal shell
environment variables. During main-process startup, Ousia reads the user's shell
environment and imports missing variables into the Electron process so Pi can
see provider keys configured through shell startup files. Runtime logs record
only imported variable names, not values. For durable provider configuration,
users should configure Pi through Pi's own UI/commands or through Ousia's model
provider settings.

The app no longer installs an Ousia usage skill, filters a user `ousia` skill,
or prepends an `ousia` CLI shim to the agent environment.

Codex uses the pinned bundled `codex app-server` native binary over stdio.
Ousia persists the opaque thread id returned by Codex instead of deriving it
from the Ousia session id or parsing private rollout files. Authentication goes
through app-server account RPCs so Codex remains the credential owner. See
[codex-integration.md](codex-integration.md).

Codex model discovery also supplies each model's supported reasoning efforts,
descriptions, and default effort. Those open protocol values are kept separate
from Pi's fixed thinking levels and are validated again by the Codex provider
before `turn/start`.

## App State

App state schema version 2 stores settings, flat project/session indexes,
expanded project ids, shell layout, selected session, and window state. Settings
include appearance mode, Radix color scale, default workspace folder,
send-during-run mode, default agent for new sessions, Codex model selection,
Codex reasoning preference, Pi thinking level, selected Pi model, per-provider
API keys, and locally disabled model provider ids. Session records persist their
agent provider and optional Codex thread id.

Electron main owns the persisted project/session index. The renderer may keep
local UI state for responsiveness, but it persists project/session changes by
sending transaction intents to main and then syncing from the returned canonical
state. Renderer code must not save full app-state snapshots because stale
snapshots can overwrite newer session/project index changes.

Electron main keeps a canonical in-memory snapshot per app-state file. Public
loads and transaction results are cloned, durable no-op transactions skip disk,
and a new snapshot becomes visible only after the atomic file replacement
succeeds.

The desktop runtime does not support concurrent main processes. It holds
Electron's single-instance lock, and a second launch focuses (or recreates) the
existing window, ensuring that only one main process can mutate the canonical
in-memory snapshot and `app-state.json`.

Chat events carry their session context. The renderer routes contextual events
only while that canonical session still exists; late events after deletion are
logged and dropped instead of falling into the selected chat. Session/project
deletion is disabled while any affected agent turn is running.

`src/electron/app-state-store.ts` accepts the current schema only. Invalid or
older development-state files fall back to default state because this pre-release
app has not shipped a stable persistence contract yet.

## Runtime Logs

Runtime logs are written to:

```text
~/.ousia/logs/ousia-desktop.log
```

They include Electron main logs, renderer console messages, renderer uncaught
errors, chat/title-generation failures, shell-environment hydration time, and
structured BrowserWindow startup timings. The append descriptor is reused and
the log rotates at 8 MiB on process startup.

See [performance.md](performance.md) for the measured baseline and performance
regression guardrails.
