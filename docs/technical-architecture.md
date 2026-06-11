# Technical Architecture

## Stack

- Electron Forge
- Electron Forge Vite plugin
- React
- TypeScript
- shadcn/ui
- Tailwind CSS
- dnd-kit for sidebar drag-and-drop sorting
- Electron
- Monaco Editor for the workspace editor extension
- `@pierre/trees` for the workspace editor file tree
- xterm.js + node-pty for the workspace terminal extension
- `@embedpdf/react-pdf-viewer` and `pdf-lib` for the optional PDF Editor
  workspace extension
- `@excalidraw/excalidraw` for the optional Excalidraw workspace extension
- Univer (`@univerjs/*`) for the optional Excel workspace extension
- pi coding agent
- Vercel Streamdown for assistant Markdown rendering

## Build And Start Pipeline

Ousia uses Electron Forge with `@electron-forge/plugin-vite`.

Key files:

- `forge.config.cjs`
- `vite.main.config.ts`
- `vite.preload.config.ts`
- `vite.renderer.config.ts`

The package entry point is:

```json
".vite/build/main.js"
```

Forge builds separate targets for:

- Electron main process: `src/electron/main.ts`
- Electron preload: `src/electron/preload.ts`
- Renderer window: React app through `vite.renderer.config.ts`

Development start:

```bash
npm start
```

`npm run dev` is an alias for the same full Electron development app. Use `npm run renderer:dev` only when intentionally running the renderer as a plain browser page.

In development, the main process loads `MAIN_WINDOW_VITE_DEV_SERVER_URL`, injected by the Forge Vite plugin. In packaged builds, it loads the generated renderer HTML under `.vite/renderer/${MAIN_WINDOW_VITE_NAME}`.

## Process Boundary

Renderer:

- Owns the UI shell.
- Owns the renderer App State Module in `src/app/app-state.ts`.
- Keeps app-level feature UI in `src/features/`: sidebar, chat, and workspace.
- Persists top-level session/project/app settings, shell layout state, native
  window state, workspace tabs, and the currently selected session/project
  through Electron IPC. The durable adapter is Electron
  `userData/app-state.json`; renderer code does not read or write storage keys
  directly. Shell layout state includes sidebar/workspace collapse state and
  sidebar/chat column widths. Native window state includes restored bounds and
  maximized state, owned by Electron main so renderer app-state saves do not
  overwrite the latest window size. Workspace tabs persist their active
  extension plus a lightweight opened-resource descriptor, so file-backed
  surfaces such as PDF Editor and Excalidraw can restore the last opened file
  after restart.
- Persists extension-owned local UI state through a separate Electron
  `userData/extension-state.json` adapter. Extensions read and write only inside
  their own namespace through `ExtensionContext.state`, scoped as `global`,
  `project`, `tab`, or `resource`; core app-state does not model extension
  implementation details such as browser URLs or editor cursor positions.
- Passes the current app theme into every workspace extension context as both
  the user preference and resolved light/dark value, so bundled and runtime
  extension surfaces can track Ousia appearance changes.
- Passes narrow app-level callbacks into workspace extension context only for
  host-owned shell actions, such as opening a project folder from an editor
  empty state. Extensions should not duplicate project selection or persist a
  separate cwd.
- Sends chat payloads to Electron preload.

Preload:

- Exposes a narrow `window.ousia` API.
- Bridges renderer to main through IPC.

Main process:

- Uses `src/electron/main.ts` as the composition root for module creation, IPC
  registration, and app lifecycle wiring.
- Owns the durable App State Store in `src/electron/app-state-store.ts`.
- Owns extension local state storage in
  `src/electron/extension-state-store.ts`.
- Owns pi coding agent sessions through the Agent Conversation Module in
  `src/electron/agent-conversations.ts`.
- Owns first-turn session naming through
  `src/electron/chat-title-generator.ts`.
- Owns runtime extension discovery, frontend compilation, deletion, and file
  watching through `src/electron/runtime-extensions.ts`.
- Owns project file and PDF host APIs through `src/electron/project-files.ts`.
- Owns terminal PTY sessions through `src/electron/project-terminal.ts`.
- Owns path expansion and containment helpers through
  `src/electron/host-paths.ts`.
- Owns window creation, native window helpers, webview policy, and WebAuthn
  setup through `src/electron/window-host.ts`.
- Opens native directory picker.
- Creates isolated pi sessions per cwd/session.

## Agent Session Model

Chat payloads include:

- `projectPath`
- `sessionId`
- `prompt`
- optional `attachments`
- `thinkingLevel`

Electron main caches pi sessions by:

```text
projectPath::sessionId
```

Each pi session uses:

- `cwd = selected project path`
- unassigned sessions resolve `projectPath` to the configured default work dir
- shared `agentDir = app userData/pi-agent`
- conversation dir under app userData grouped by project path and session id

The resolved session work dir is therefore the default cwd for agent tools such
as read/write/edit/bash.

Chat attachments are resolved in the renderer before IPC. Image files are sent
as base64 `OusiaChatAttachment` records and Electron main forwards them to pi
through `session.prompt(text, { images })`, using pi's `ImageContent` shape so
the selected provider/model's vision input path is used. Text-like files are
inlined into the prompt in an `<attached_file>` block. Other binary files are
kept as visible attachment metadata only, because pi's SDK exposes first-class
image attachments but not generic binary file attachments.

Extension context should not be automatically attached to every chat or steering
message. Instead, Ousia should expose a bash-callable CLI that the existing
agent shell tool can use to query current UI state on demand: active workspace
tab, mounted extension instances, opened resources, selections, dirty state,
visible errors, and recent user operations. This keeps chat context small and
avoids growing the agent's dedicated tool surface.

Extension actions should also be invokable through that CLI. The first
implemented bridge installs an executable shim at `~/.ousia/bin/ousia`, starts a
loopback HTTP bridge in Electron main, writes connection details plus a bearer
token to `~/.ousia/desktop-bridge.json`, and prepends the shim directory to the
app process `PATH` so pi bash sessions can call it. CLI calls target an
extension instance and action name, cross Electron main for routing and policy
checks, execute in the renderer-owned extension surface, then print a structured
JSON result or error. Privileged effects such as filesystem writes, PTY input,
browser `WebContentsView` control, and backend extension work should continue to go
through Electron main IPC adapters rather than direct renderer access.

Current implemented CLI actions:

```bash
ousia extension list
ousia extension invoke --extension extension.firstParty.pdfEditor --action help
ousia extension invoke --extension extension.firstParty.univerSheets --action openAndFocus
ousia extension invoke --extension extension.firstParty.pdfEditor --action openAndFocus
ousia extension invoke --extension extension.firstParty.pdfEditor --action openFile --json '{"path":"relative-or-absolute.pdf"}'
ousia extension invoke --extension extension.firstParty.excalidraw --action openFile --json '{"path":"relative-or-absolute.excalidraw"}'
```

`help` is a generic workspace extension action that returns the supported
actions, arguments, examples, and known limitations for the selected extension.
Ousia does not append extension instructions to pi's system prompt. Instead,
Electron main installs a unified `ousia` usage skill into the same app-scoped pi
agent directory used by Ousia chat sessions, under `<userData>/pi-agent/skills`,
and lets pi discover it through the normal skill loader. Ousia also adds pi's
default user skill directory, `~/.pi/agent/skills`, as additional skill paths
for non-Ousia user skills so embedded sessions can use the user's normal pi
skills while keeping app-scoped auth, models, settings, and sessions. Ousia
does not additionally import a default-user `ousia` skill into embedded
sessions; the app-scoped `ousia` skill is the single Ousia usage entry. The
install is one-time and records a marker under Ousia's app data; if the user
later edits or deletes the visible skill, Ousia does not rewrite it on session
creation. The skill tells pi to list extensions, inspect help before use, and
avoid inventing unlisted actions.
Extension-specific usage belongs in help, not in the skill body or system
prompt. `openAndFocus` is a generic workspace extension action and works for
every registered Ousia workspace extension id.
The PDF `openFile` action is PDF-specific: it normalizes the requested path
against the currently selected project or default work dir, requires an existing
`.pdf`, and sends a project-relative path plus a token-protected local PDF URL
to the renderer.
The Excalidraw `openFile` action allows files under any registered Ousia project
or the default work dir, requires an existing `.excalidraw` file, and sends the
parsed scene JSON to the renderer-owned Excalidraw surface. The CLI response
summarizes the opened scene instead of echoing the full element payload, keeping
agent logs readable.

## IPC API

Renderer-facing API is declared in:

- `src/electron/chat-types.ts`
- `src/types/ousia.d.ts`

Currently exposed on `window.ousia`:

- `loadAppState()`
- `saveAppState(payload)`
- `sendChatMessage(payload)`
  - accepts optional chat attachments; images are forwarded to pi as
    `ImageContent[]`, text files are appended to the prompt, and unsupported
    binary files are represented as metadata.
- `generateChatTitle(payload)`, which asks a pi-resolved lightweight utility
  model for a first-turn session title capped at 16 characters
- `getChatHistory(payload)`
- `interruptChat(payload)`
- `openProjectDirectory()`, using Electron's native directory picker with
  create-directory support on platforms that expose it
- `ensureWindowWidth(payload)`, used by responsive shell expansion to grow the
  native window left or right before reopening collapsed panels
- `listEditorFiles(payload)`
- `readEditorFile(payload)`
- `saveEditorFile(payload)`
- `listPdfFiles(payload)`
- `readPdfFile(payload)`
- `savePdfFile(payload)`
- `createTerminal(payload)`
- `writeTerminal(payload)`
- `resizeTerminal(payload)`
- `disposeTerminal(payload)`
- `createBrowser(payload)`
- `setBrowserBounds(payload)`
- `destroyBrowser(payload)`
- `navigateBrowser(payload)`
- `browserBack(payload)`
- `browserForward(payload)`
- `reloadBrowser(payload)`
- `stopBrowser(payload)`
- `focusBrowser(payload)`
- `openBrowserExternal(payload)`
- `readBrowserSelection(payload)`
- `findInBrowser(payload)`
- `stopBrowserFind(payload)`
- `setBrowserZoom(payload)`
- `respondToBrowserAuth(payload)`
- `onBrowserEvent(callback)`, used by the browser workspace extension to receive
  navigation, loading, download, find-in-page, and auth events from Electron
  main.
- `listRuntimeExtensions()`
- `watchRuntimeExtensions()`
- `deleteRuntimeExtension(payload)`
- `onWorkspaceAction(callback)`, used by the local Ousia CLI bridge to request
  visible workspace extension actions such as opening and focusing the PDF
  editor.
- `onChatEvent(callback)`
- `onTerminalEvent(callback)`

IPC channels are grouped by product or privileged host API. App state uses
`ousia:app-state:*`, chat uses `ousia:chat:*`, native window helpers use
`ousia:window:*`, runtime extension management uses `ousia:extensions:*`,
project files use `ousia:host:project-files:*`, project PDF bytes use
`ousia:host:project-pdfs:*`, project PTY uses `ousia:host:project-pty:*`, and
main-owned browser views use `ousia:browser:*`.

Chat sending is non-blocking from the renderer perspective. The Agent
Conversation Module starts a normal pi prompt when the session is idle, and uses
pi steering when a message arrives while the session is already streaming.
`interruptChat` clears queued steering/follow-up messages and calls
`AgentSession.abort()` for the selected project/session.

After the first user message in a still-default `新会话` session, the renderer
fires a non-blocking `generateChatTitle` request through Electron main. Main
uses pi's `AuthStorage` and `ModelRegistry` from the same `userData/pi-agent`
root as chat sessions, then selects a lightweight utility model. The current
chat provider is preferred, and known cheap/fast choices include DeepSeek V4
Flash, GPT nano/mini models, Gemini Flash Lite, GLM Turbo/Air, and MiMo Flash.
If the current provider is not authenticated, other authenticated utility
providers are tried. The returned title is sanitized and capped at 16 characters
before the renderer updates local session metadata. If the user has already
renamed the session, the generated title is ignored.

## Runtime Logging

Ousia writes persistent desktop runtime diagnostics to:

```text
~/.ousia/logs/ousia-desktop.log
```

The logger is installed in Electron main before app startup work begins. It
captures main-process `console` calls, uncaught exceptions, unhandled promise
rejections, chat error events, title-generation failures, renderer
`console-message` events, renderer process exits, load failures, and explicit
preload reports for `window.error` and `window.unhandledrejection`.

The editor file APIs are project-scoped. Electron main resolves all requested
paths under the selected project root, rejects traversal outside that root, skips
large files, and ignores heavy generated directories while building the file
navigation list.

The PDF file APIs are also project-scoped. Electron main lists `.pdf` files
under the selected project, returns PDF content as base64 to the renderer, and
accepts base64 content for saves. The optional PDF Editor uses those APIs to
show the current project PDF, send PDF selection context to the current agent
session, perform lightweight manual writes, and refresh when the underlying file
mtime changes.

The terminal APIs are also project-scoped. Renderer extension surfaces host
xterm.js only; Electron main creates and owns the corresponding `node-pty` process with
`cwd = selected project path`, forwards terminal output over IPC, and receives
input plus resize events from the renderer. Terminal visuals are client-owned:
the renderer loads bundled Ousia Terminal Mono for terminal glyph coverage,
falls back to the Codex-style system mono stack, and reapplies the Ousia xterm
theme after shell output, while Electron main identifies the PTY as
`TERM_PROGRAM=Ousia` instead of inheriting an external terminal profile.
The spawned shell uses temporary wrapper startup files for common shells. The
wrappers source the user's normal config first, then point Starship at a
temporary copy of the Terminal extension's vendored `plain-text-symbols.toml`
preset and run `starship init` when Starship is available. PATH/tooling setup is
preserved while the workspace terminal defaults to Ousia's plain-text Starship
prompt; without Starship, the wrapper falls back to a compact built-in prompt.
Terminal-owned Starship binaries live under
`src/extensions/system/terminal/vendor/starship/<platform>-<arch>/` and are
packaged as Electron extra resources. The PTY module prepends the matching
binary directory to `PATH` when present, keeping Starship distribution scoped to
the Terminal extension resource boundary.

Runtime extension packages are global under `~/.ousia/extensions`; they are not
project-scoped. Project awareness means the agent and system surfaces receive
the selected project path as context, not that extension packages belong to a
single project. Electron main reads each extension's `package.json#ousia.app`,
bundles the frontend app entry with esbuild, marks it as a `user-local`
distribution with `local-user` trust, and sends compiled extension code to the
renderer. Older extension package formats are not loaded.

All workspace surfaces use the same extension definition shape. Browser, Editor,
and Terminal are first-party preinstalled extensions; PDF Editor, SVG Editor,
Excalidraw, and Excel are first-party optional and appear in the extension
picker without opening as default tabs. Privileged host work remains in Electron
main through explicit IPC adapters. See `docs/system-extensions-feasibility.md`.

## Settings

App-level settings live behind the renderer App State Module and are persisted
by Electron main to `userData/app-state.json`. The file carries
`schemaVersion: 2`; schema 1 project-nested sessions are migrated into top-level
sessions, and other incompatible shapes fall back to default state during early
development.
The default state factory is shared from `src/electron/chat-types.ts` so
renderer fallback state and Electron persisted state use the same defaults.

Current settings:

- `appearanceColorScale`, default `tea`
- `defaultWorkDir`, default `~/.ousia/workspace`
- `thinkingLevel`, default `medium`
- `modelProvider`, default `deepseek`
- `modelId`, default `deepseek-v4-flash`
- `modelProviders`, default `[{ id: "deepseek", apiKey: "" }]`
- `modelApiKey`, legacy single-provider key retained for migration only

Renderer settings are stored locally and edited through immediate-apply controls:
select values apply on change, and text inputs apply when they lose focus.
Appearance settings update renderer CSS tokens through the document root, while
the current model, selected provider's optional runtime API key, and thinking
level are forwarded to pi before each chat turn. Older state with a single
`modelApiKey` is normalized into the selected provider entry during load.
Model settings only manage provider entries and per-provider API keys. Provider
addition is constrained to pi-known providers through Electron IPC backed by
pi's `ModelRegistry` over `userData/pi-agent/auth.json` and `models.json`.
Model and thinking-level selection happen in the chat input menu, using the same
built-in/custom registry used for chat sessions.

## Browser WebAuthn

The first-party browser extension uses the `persist:ousia-browser` Electron session.
Electron requires explicit main-process setup for passkeys on macOS:

- `app.configureWebAuthn()` must be called before Touch ID / Secure Enclave
  WebAuthn requests are serviced.
- `select-webauthn-account` must be handled for the browser session; otherwise
  Electron cancels requests that return multiple discoverable credentials.
- Packaged macOS builds need a keychain access group that also appears in the
  app's `keychain-access-groups` signing entitlement.

Set one of these before launching a signed macOS build:

```bash
OUSIA_WEBAUTHN_KEYCHAIN_ACCESS_GROUP="<TEAM_ID>.com.ousia.desktop.webauthn"
```

or:

```bash
OUSIA_APPLE_TEAM_ID="<TEAM_ID>"
```

When neither variable is set, Ousia still handles WebAuthn account selection,
but it skips the macOS platform authenticator and logs a warning.

## Important Caveats

- The renderer-only page from `npm run renderer:dev` does not have Electron preload, so real pi chat only works inside the Electron window.
- macOS passkeys in the browser extension require Electron WebAuthn configuration
  plus matching signing entitlements in packaged builds. Existing passkeys from
  other browsers may not be available to Electron's app-scoped authenticator.
- Streamdown increases bundle size because it brings Markdown/code rendering support. See `docs/streamdown.md` for current link safety behavior.
- Current project/session metadata is local-only and should later move to a more durable app data store.
