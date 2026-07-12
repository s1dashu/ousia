# Technical Architecture

Ousia Desktop is an Electron + Vite + React app. The simplified app has no
Ousia extension runtime. The renderer hosts the sidebar, chat, and settings.

## Runtime Stack

- Electron Forge + Vite for main, preload, and renderer builds.
- React renderer with Tailwind/shadcn UI.
- Pi coding agent and an on-demand Codex app-server hosted in Electron main.
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
- `src/components/ui/card.tsx`: the existing product Card primitive; Settings
  uses its feature-local Vega Card.
- `src/features/chat/ChatArea.tsx`: chat history, input, attachments, controls.
- `src/features/chat/ChatHeader.tsx`: chat title bar actions.
- `src/features/chat/ChatMessageList.tsx`: assistant/user/system message
  rendering.
- `src/features/chat/ChatComposerParts.tsx`: queued message and attachment
  composer subcomponents.
- `src/features/chat/ChatToolCall.tsx`: tool call rendering and payload
  expansion.
- `src/features/settings/SettingsPage.tsx`: categorized settings content and
  provider-specific configuration. Shared chat behavior has its own section;
  Pi permission mode is rendered only inside Pi settings.
- `src/features/settings/SettingsSidebar.tsx`: settings-mode navigation with a
  dynamic Pi or Codex destination.
- `src/features/settings/settings-navigation.ts`: settings section ids and the
  provider-aware navigation model shared by the shell and settings sidebar.
- `src/features/settings/SettingsSelect.tsx`, `SettingsSwitch.tsx`,
  `SettingsButton.tsx`, `SettingsCard.tsx`, `SettingsInput.tsx`, and
  `SettingsDialog.tsx`: feature-local Base UI controls aligned with the
  `bIkeymG` Vega reference, isolated from globally customized primitives.
- `src/features/settings/settings-local-styles.ts`: settings shell-only Vega
  sidebar and panel classes; primitive styling lives with each local component.
- `src/features/shell/main-panel-styles.ts`: shared left-corner geometry for the
  chat and settings panels. Both panels sit on a `bg-sidebar` host so the
  revealed corner surface matches the side panel.
- `src/features/sidebar/Sidebar.tsx`: project/session/settings navigation.

The renderer theme has two explicit layers. Global shadcn tokens are the exact
neutral `bIkeymG` Vega light/dark values and define the default behavior for new
and uncustomized UI. Chat typography and spacing preferences are persisted in
app state and applied through Ousia-prefixed chat CSS variables. Existing
appearance palettes currently live under the
`--ousia-app-*` migration palette. The tuned chat and session-sidebar roots map
those values through `ousia-chat-theme` and `ousia-sidebar-theme` as a temporary
compatibility boundary. The target architecture in `docs/design.md` replaces
those broad mappings with direct component semantics such as
`--ousia-composer-*`, `--ousia-message-*`, and `--ousia-sidebar-*`.

The shell surfaces are memoized and receive stable event callbacks. Chat event
reduction preserves object references for no-op events and copies only the
changed item path, so active streaming does not invalidate unrelated shell or
history subtrees.

Live Pi tool items track streamed input completion separately from execution
completion. For write/edit calls, Electron main emits a per-item
`tool_input_end` when that content index's raw argument stream first becomes a
strictly complete JSON object; the renderer then collapses that file preview
while leaving its execution status running, but only if the renderer previously
observed that item as an active write/edit preview. If a provider delivers the
tool name and complete arguments in one renderer batch, the newly identified
preview must still open and remain visible until execution finishes. This
cannot rely only on Pi's
`toolcall_end`, because some OpenAI-compatible providers delay all such events
until the complete model response has finished. Final success or failure still
comes exclusively from `tool_execution_end`.

Streaming write previews must not depend on JSON field order. When `content`
arrives before `path`, the preview uses the neutral `write` target temporarily
and renders the partial content immediately; the same tool item adopts the real
path when that field arrives. A complete write payload without a path remains
invalid and does not receive this streaming-only treatment.

Submitting a chat message creates a stable client message id and publishes the
user item to its contextual session before invoking Electron IPC. That item
immediately uses the normal successful style and is the only live success write;
Pi and Codex do not echo successful user messages. Provider failures emit the
same content and client id atomically with `delivery: "failed"`, allowing a
remounted renderer to reconstruct the failed item. The main-process router
rejects duplicate ids in the same session before they can execute twice, and
waits for an already in-flight initial history snapshot before routing a send so
provider-local history ids cannot create a duplicate bubble. `autoRetryOnFailure`
is sent only to Pi and is rejected at the Codex provider boundary.

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
- `src/electron/codex-app-server-client.ts`: owns the downloaded native Codex
  process, JSONL RPC, lifecycle, and sanitized diagnostics.
- `src/electron/codex-runtime-manager.ts`: downloads the pinned native Codex
  archive on first use, verifies SHA-512 integrity, and atomically owns its
  versioned user-data cache.
- `src/electron/codex-agent-provider.ts`: adapts Codex threads, turns, items,
  authentication, history, and tools to Ousia chat contracts.
- `src/electron/app-state-store.ts`: persists shell, settings, project, session,
  and window state.
- `src/electron/window-host.ts`: owns the BrowserWindow and window state.

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

Chat-title requests carry the current interface language as a required field.
Both Pi utility-model titles and Codex ephemeral-thread titles generate and
normalize output in that language. Changing the language does not rename titles
that were already persisted.

## Agent Sessions

Each chat request includes `projectPath` and `sessionId`. Electron main resolves
the canonical session record, derives its project path from the persisted
project/default-session-folder index, rejects a mismatched renderer path, and
routes
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

Codex uses a pinned, on-demand `codex app-server` native binary over stdio.
The first Codex capability request downloads and verifies the matching platform
archive; later requests reuse the versioned user-data cache.
Ousia persists the opaque thread id returned by Codex instead of deriving it
from the Ousia session id or parsing private rollout files. Authentication goes
through app-server account RPCs so Codex remains the credential owner. See
[codex-integration.md](codex-integration.md).

Codex model discovery also supplies each model's supported reasoning efforts,
descriptions, and default effort. Those open protocol values are kept separate
from Pi's fixed thinking levels and are validated again by the Codex provider
before `turn/start`.

## Updates And Anonymous Metrics

Packaged macOS builds query the independently deployed Ousia analytics service
for the latest GitHub release. Checking and downloading are separate actions:
the renderer exposes an update button only after a newer signed ZIP is known to
exist, and Electron's native Squirrel.Mac updater begins downloading only after
the user clicks it. Startup checks and the native **Check for Updates…** app-menu
action use Electron `net.fetch` so they share Chromium's system-proxy behavior.
Manual checks always show a native result dialog; update state and errors are
emitted over IPC and recorded in the runtime log.

After download, installation waits for either an explicit Restart click or a
strict idle condition: the window is not focused, no input was observed for five
minutes, and no agent session is running. A downloaded update is also applied on
the next normal app launch by Squirrel.Mac.

The service receives `app_opened` and `update_downloaded` events containing only
a random installation UUID, app version, platform, and CPU architecture. It
HMAC-hashes the UUID before persistence. Download counts come from the same
service's validated redirect endpoint, which must be used by both the updater
and public download links.

## App State

App state schema version 2 stores settings, flat project/session indexes,
expanded project ids, shell layout, selected session, and window state. Settings
include appearance mode, Radix color scale, independently configurable default
session and project-creation starting folders,
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

## Remote Error Monitoring

The reusable Sentry integration initializes the official Electron SDK in main,
preload, and renderer only when the product build embeds a valid public DSN.
Ousia and downstream products use separate Sentry projects and releases. All
JavaScript events pass through the shared fail-closed privacy sanitizer;
screenshots, logs, tracing, replay, local variables, request data, breadcrumbs,
and native minidumps are disabled by default. Production builds with Sentry
enabled must upload matching hidden source maps and exclude them from the app.
See [sentry.md](sentry.md).
