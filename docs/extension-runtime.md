# Extension Runtime

## Concept

Extensions are React surfaces. The app shell itself is moving toward an
extension-composed model:

- Sidebar extension area
- Chat extension area
- Workspace extension tabs

The MVP implements workspace tabs first.

## Current Implementation

The current renderer implementation has an extension registry, an extension slot
renderer, and an extension context object. Browser, Editor, and Terminal are
registered as first-party bundled extensions.

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

Runtime extension docs:

- `docs/runtime-extensions.md`

Runtime extension authoring skill for pi:

- `/Users/bytedance/.pi/agent/skills/ousia-extension/SKILL.md`

## Intended Direction

Every workspace surface should be an extension. Browser, Editor, and Terminal
are first-party bundled extensions: packaged with Ousia, listed in the same
workspace registry, and mounted through the same `workspace.tab` contract.

Ousia uses four distribution levels:

- `first-party-bundled`: produced by Ousia and visible by default.
- `first-party-optional`: produced by Ousia and available for optional install.
- `community`: produced outside Ousia and installed by the user from a community
  source.
- `user-local`: created or modified locally by the user or by the agent under
  `~/.ousia/extensions`.

The first-party bundled extensions differ from user-local runtime extensions in
trust and capability source: their frontend code is bundled with the app, while
privileged capabilities such as webview setup, filesystem access, and PTY
creation stay behind Electron main IPC adapters.

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
5. User can interact with the extension immediately.
6. When extension hosts are added, optional Node backends provide local
   capabilities through a controlled IPC bridge.

## Out Of Scope For MVP

- Third-party marketplace.
- Security sandboxing for arbitrary remote code.
- Node extension host execution.
- `window.ousia.extensions.invoke(...)` backend calls.

Avoid adding heavy extension protocols too early. The current package manifest is
intentionally close to VSCode and npm conventions: `package.json` identifies the
extension, and `package.json#ousia.app` tells Ousia what to load.

Feasibility notes for converting Browser, Editor, and Terminal to this shape live
in `docs/system-extensions-feasibility.md`.
