# Extension Runtime

## Concept

Extensions are React surfaces. The app shell itself is moving toward an
extension-composed model:

- Sidebar extension area
- Chat extension area
- Workspace extension tabs

The MVP implements workspace tabs first.

## Agent-Extension Contract

Ousia's extension runtime should evolve around two complementary contracts:

1. Context: each extension publishes structured state that the agent can read.
2. Actions: each extension exposes common operations that the agent can invoke.

The context contract is the agent's perception layer for GUI surfaces. It should
not be limited to app-level project/session metadata. For each mounted extension
instance, Ousia should be able to describe:

- Identity: extension id, tab id, title, distribution, trust label, and whether
  the surface is active or backgrounded.
- Resource state: opened URL, file path, document id, sheet name, selected PDF,
  terminal cwd, or other domain resource.
- View state: route/page, mode/tool, scroll position, viewport, zoom, active
  panel, focused field, and visible errors.
- Selection state: selected text, file, node, cell range, object id, cursor
  position, or time range.
- Mutation state: dirty/clean status, unsaved local edits, pending import/export,
  and whether the extension is currently busy.
- User activity: recent meaningful operations such as opened file, changed tool,
  selected object, edited field, saved, exported, navigated, or cancelled.

The action contract is the agent's control layer for GUI surfaces. It should
cover common, user-visible operations first: activate tab, open resource,
navigate, search, select, scroll, set field value, click named command, save,
export, undo, redo, and close. Domain extensions can add domain-specific actions,
but they should keep action names stable and arguments structured.

Agent-facing documentation for extension actions should live with the extension
action surface itself. In the current CLI bridge, every operable extension should
support a `help` action that returns supported actions, arguments, examples, and
known limitations. Pi's extra extension prompt should stay intentionally small:
list extensions, inspect `help` before use, and never invent unlisted actions.
When action capabilities change, update CLI `help` first instead of copying
extension-specific instructions into the prompt.

Agent-invoked extension actions should be observable by default. The user should
be able to see the target surface, understand what changed, and interrupt or
correct the agent through normal UI. Destructive or externally visible actions
should require an explicit confirmation policy even when the extension is trusted.

## Current Implementation

The current renderer implementation has an extension registry, an extension slot
renderer, and an extension context object. Browser, Editor, and Terminal are
registered as first-party preinstalled extensions. PDF Editor is registered as a
first-party optional workspace extension.

The first-party browser extension uses Electron's native `<webview>` tag. The
renderer owns the browser chrome and address bar, while Electron main enables
the tag and sanitizes attached webviews before they load remote content. It uses
a shared `persist:ousia-browser` partition so cookies, local storage, and login
state survive app restarts and are shared across projects.

The same browser partition is configured in Electron main for WebAuthn account
selection. On macOS, Touch ID / Secure Enclave passkey prompts require
`app.configureWebAuthn()` with a keychain access group supplied through
`OUSIA_WEBAUTHN_KEYCHAIN_ACCESS_GROUP` or derived from `OUSIA_APPLE_TEAM_ID`.
The keychain access group must match the packaged app's signing entitlement.

The first-party editor extension embeds Monaco Editor. It fills the workspace
tab edge to edge, shows a project-scoped file navigation sidebar powered by
`@pierre/trees`, and reads/saves files through Electron main IPC instead of
giving the renderer direct filesystem access.

The first-party terminal extension embeds xterm.js edge to edge in the workspace
tab. It does not spawn shell processes from the renderer; it sends input and
resize events through preload IPC to Electron main, where `node-pty` owns the
shell session for the selected project/session context.

The first-party optional PDF Editor extension embeds `@embedpdf/react-pdf-viewer`
for PDF viewing and annotation UI, uses `pdf-lib` for lightweight local write
operations, and reads/saves project PDF bytes through Electron main IPC. It
polls project PDF metadata so agent-written file changes are reflected in the
workspace tab.

The first-party optional Excel extension embeds Univer through the official
Univer Sheets core preset. It currently provides an embedded editing surface
only; project file import/export and agent-specific Office automation are
separate future host capabilities.

The first-party optional Excalidraw extension embeds
`@excalidraw/excalidraw` as a standalone whiteboard workspace. It keeps
Excalidraw's native tools and file/export menu intact, and is separate from the
SVG Editor because Excalidraw is a sketch/diagram whiteboard rather than a
structural SVG file editor. Its CLI `openFile` action can open an existing
project-scoped `.excalidraw` scene by passing validated scene JSON from Electron
main to the renderer surface.

Runtime extension docs:

- `docs/runtime-extensions.md`

Runtime extension authoring skill for pi:

- `/Users/bytedance/.pi/agent/skills/ousia-extension/SKILL.md`

## Intended Direction

Every workspace surface should be an extension. Browser, Editor, and Terminal
are first-party preinstalled extensions: packaged with Ousia, listed in the same
workspace registry, and mounted through the same `workspace.tab` contract.

Ousia uses four distribution levels:

- `first-party-preinstalled`: produced by Ousia and visible by default.
- `first-party-optional`: produced by Ousia and available for optional install.
- `community`: produced outside Ousia and installed by the user from a community
  source.
- `user-local`: created or modified locally by the user or by the agent under
  `~/.ousia/extensions`.

The first-party preinstalled extensions differ from user-local runtime
extensions by origin and install experience: their frontend code is bundled with
the app and visible by default. Privileged host work such as webview setup,
filesystem access, and PTY creation stays behind Electron main IPC adapters.

Ousia uses an install-as-trust extension model. Distribution and trust labels
describe where an extension came from and how it appears in the product; they
are not runtime permission boundaries.

Custom UI should be written as runtime extension packages under
`~/.ousia/extensions`. Each package uses `package.json#ousia.app` to declare its
frontend app entry. The default entry is `App.tsx`, matching the common
React/Vite convention. Extension app entries are bundled by Electron main and
then mounted into workspace tabs.

The long-term desired flow:

1. User asks the agent to create an extension.
2. Agent writes an extension package under `~/.ousia/extensions`.
3. App watches the global extension directory and recompiles after file changes settle.
4. App registers it into workspace tabs.
5. Extension registers its context provider and action handlers with the Ousia
   host.
6. User can interact with the extension immediately, and the agent can perceive
   the current extension state.
7. Agent can invoke exposed extension actions while the user watches the
   workspace surface.
8. When extension hosts are added, optional Node backends provide local host
   APIs through a controlled IPC bridge.

Implementation should happen in layers:

1. Add a renderer-side extension instance registry that tracks mounted tab
   instances, active/background state, and last published context.
2. Extend `ExtensionContext` with host callbacks such as `publishContext`,
   `registerActions`, and `emitUserActivity`.
3. Use `ExtensionContext.state` for extension-owned local state. State is
   namespaced by extension and scoped as `global`, `project`, `tab`, or
   `resource`, so runtime and bundled extensions can restore lightweight UI
   state without adding extension-specific fields to shell app-state.
4. Persist or buffer recent extension activity in the registry so it can be
   returned when the agent explicitly asks for current UI state.
5. Add main/preload IPC for `ousia:extensions:context:*` and
   `ousia:extensions:action:*`, keeping privileged work in Electron main.
6. Expose a bash-callable CLI, for example `ousia extension context`, that
   returns active tab, mounted extension instances, opened resources, selections,
   visible errors, dirty state, and recent user operations on demand.
7. Expose extension action invocation through the same CLI, for example
   `ousia extension invoke`, routed back through Electron main to the renderer
   extension instance.
8. Give each CLI-operable extension a `help` action so agents can discover
   concrete actions and constraints at runtime instead of relying on hard-coded
   prompt details.
9. Add policies for action visibility, confirmation, timeout, cancellation, and
   result reporting.

## Out Of Scope For MVP

- Third-party marketplace.
- Security sandboxing for arbitrary remote code.
- Node extension host execution.
- `window.ousia.extensions.invoke(...)` backend calls.
- Fully generic remote UI automation for arbitrary third-party websites.

Avoid adding heavy extension protocols too early. The current package manifest is
intentionally close to VSCode and npm conventions: `package.json` identifies the
extension, and `package.json#ousia.app` tells Ousia what to load.

Feasibility notes for converting Browser, Editor, and Terminal to this shape live
in `docs/system-extensions-feasibility.md`.
