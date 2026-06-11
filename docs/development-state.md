# Development State

## Current Commands

Run full Electron development app:

```bash
npm start
```

Equivalent alias:

```bash
npm run dev
```

Run renderer-only Vite app:

```bash
npm run renderer:dev
```

Inspect persisted runtime logs:

```bash
tail -200 ~/.ousia/logs/ousia-desktop.log
```

Package with Electron Forge:

```bash
npm run package
```

Create distributables with Electron Forge makers:

```bash
npm run make
```

`npm run build` currently runs TypeScript project checks and then `electron-forge package`.

## Current Status

Implemented:

- shadcn Vite React app.
- Electron Forge + Vite plugin build/start pipeline.
- Neutral theme override.
- Electron main/preload bridge.
- Hidden inset Electron title bar.
- Three-column shell with resize.
- Workspace collapse/expand.
- Sidebar with a primary session list and a secondary project list.
- Sidebar collapse via `Command+B` or dragging the resize handle below 120px.
- Responsive shell collapse: shrinking the window first closes the workspace,
  then closes the sidebar, down to the chat area's 340px minimum width.
- Expanding a sidebar from a too-narrow window asks Electron main to grow the
  native window in the needed direction only enough to preserve the chat
  minimum width, then animates the panel open with Framer Motion. Workspace
  responsive reopen preserves the current chat column width when possible and
  uses a 448px minimum width.
- Last selected project/session restored from Electron `userData/app-state.json`.
- Open local directory as project through the native folder picker.
- Monaco-based workspace editor with project file navigation and save support.
- xterm.js-based workspace terminal backed by Electron main `node-pty`
  sessions, using bundled Ousia Terminal Mono for terminal glyph coverage plus
  a client-owned xterm theme that is reapplied after shell output. The PTY
  sources user shell config through a wrapper and then applies Starship's
  `plain-text-symbols` preset when Starship is available, with a compact
  built-in prompt fallback. Optional bundled Starship binaries are scoped to
  `src/extensions/system/terminal/vendor/starship/<platform>-<arch>/` and copied
  as Electron extra resources.
- Create, select, rename, delete sessions.
- Session lists use dnd-kit sortable drag-and-drop for manual reordering, while
  newly created or recently active sessions move to the top of their own session
  group.
- Project rows in the sidebar use dnd-kit sortable drag-and-drop to adjust and
  persist project order.
- Full-page settings surface with an inset VS Code-like floating left tab list
  for appearance, general, and model settings. Select controls apply
  immediately; text inputs apply on blur, so there is no save button.
- Default work dir setting, default `~/.ousia/workspace`; Electron main creates
  that directory during app-state load when the user has not chosen a custom
  default work dir.
- Model, selected provider runtime API key, and thinking level settings passed
  into pi chat turns. The chat input menu owns model and thinking-level
  selection. Model settings only manage provider entries and per-provider API
  keys; provider addition is populated from pi's real `ModelRegistry`, including
  custom `models.json` entries, instead of free-form provider text.
- First user message in a default `新会话` triggers asynchronous session title
  generation through a pi-resolved lightweight utility model, capped at 16
  characters.
- Electron main and renderer runtime diagnostics are persisted to
  `~/.ousia/logs/ousia-desktop.log`, including main `console` output,
  uncaught exceptions, unhandled rejections, renderer console messages,
  renderer uncaught errors, renderer unhandled rejections, window load failures,
  process exits, chat errors, and title-generation failures.
- pi coding agent session creation in Electron main.
- Agent cwd scoped to selected project.
- Esc interruption from the focused chat region/input through pi `abort()`.
- Steering messages: sending while the agent is working queues through pi
  `steer` instead of waiting for the current run to finish.
- Chat input supports selecting files with the attach button and pasting files
  into the input. Image files are passed to pi through `session.prompt(...,
  { images })` for vision-capable models; text-like files are inlined into the
  prompt; other binaries remain visible as attachment metadata.
- Streamdown Markdown rendering for assistant messages, with Streamdown link safety disabled.
- Thinking block weak quote style, collapsed after completion.
- Runtime extension packages loaded globally from `~/.ousia/extensions`, with
  frontend apps declared in `package.json#ousia.app` and automatic refresh from
  Electron main file watching.
- Renderer project/session/settings/selection and shell layout persistence is
  routed through `src/app/app-state.ts` into Electron
  `src/electron/app-state-store.ts`.
- App State persists with `schemaVersion: 2`; schema 1 project-nested sessions
  are migrated into the current top-level session list.
- Extension-owned local UI state is routed through
  `ExtensionContext.state` into Electron
  `src/electron/extension-state-store.ts`, persisted separately from shell
  app-state at `userData/extension-state.json`.
- pi chat session caching, history hydration, stream event translation, and
  interruption are routed through `src/electron/agent-conversations.ts`.
- Electron main is now a composition root; host capabilities are split into
  `src/electron/project-files.ts`, `src/electron/project-terminal.ts`,
  `src/electron/window-host.ts`, and `src/electron/host-paths.ts`.
- Runtime extension frontend compilation, deletion, and file watching are
  routed through `src/electron/runtime-extensions.ts`.
- Workspace UI is isolated in `src/features/workspace/Workspace.tsx`.
- Sidebar and chat UI are isolated in `src/features/sidebar/Sidebar.tsx` and
  `src/features/chat/ChatArea.tsx`.
- App State defaults are shared from `src/electron/chat-types.ts` so renderer
  fallback state and Electron persisted state stay aligned.
- First-party optional extensions are available in the extension picker but are
  not opened as default workspace tabs.
- First-party optional PDF Editor workspace extension, backed by
  `@embedpdf/react-pdf-viewer`, `pdf-lib`, and project-scoped PDF IPC for
  listing, syncing, saving `.pdf` files, and quoting the current PDF text
  selection into the active chat input.
- First-party optional Excalidraw workspace extension, backed by
  `@excalidraw/excalidraw`, for standalone whiteboard and sketch editing.
- First-party optional Excel workspace extension that embeds the Univer Sheets
  editing surface.
- Browser extension WebAuthn account selection, with macOS Touch ID / Secure
  Enclave WebAuthn enabled when a matching keychain access group is configured.
- Workspace supports multiple open tab instances, close-on-hover tab icons, and
  a persistent new-tab button that opens an app-launcher-style extension picker.
- Open workspace tabs and the active tab are restored globally across projects.
- Sidebar/workspace collapse state and sidebar/chat column widths are restored
  from Electron `userData/app-state.json`.
- Native window size, position, and maximized state are restored from Electron
  `userData/app-state.json`.
- Workspace extensions receive their `extensionId` and `tabId` in context so
  they can persist global, project, tab, or resource scoped state without
  leaking extension-specific fields into the shell schema.
- New-tab extension management can bulk-delete runtime extensions.
- The legacy extension overview surface has been removed from the picker.
- Local Ousia CLI bridge for agent-visible workspace control. The app installs
  `~/.ousia/bin/ousia`, starts a token-protected loopback bridge, and lets pi
  bash sessions invoke first-party extension actions without adding dedicated
  agent tools.
- CLI-operable extension usage is help-first: Ousia installs a unified `ousia`
  usage skill under the same app-scoped pi agent directory used by Ousia chat
  sessions, `<userData>/pi-agent/skills`, and lets pi discover it through the
  normal skill loader. Ousia also adds the default pi user skill directory,
  `~/.pi/agent/skills`, as additional skill paths for non-Ousia user skills so
  embedded sessions can use the user's normal pi skills while keeping app-scoped
  auth, models, settings, and sessions. Ousia does not additionally import a
  default-user `ousia` skill into embedded sessions; the app-scoped `ousia`
  skill is the single Ousia usage entry. Installation is one-time; user edits or
  deletion of that visible skill are not rewritten on later session creation.
  The skill tells the agent to list extensions, call `help`, and avoid unlisted
  actions. Concrete action names, arguments, examples, and limitations belong in
  each extension's CLI help output, not in pi's system prompt.
- Generic workspace extension focus through the CLI: `openAndFocus` opens and
  focuses any registered Ousia workspace extension tab. PDF editor also supports
  `openFile` to open a current-project PDF inside that editor.

## Known Gaps

- Session message history in renderer is in-memory after hydration, with pi
  history loaded on session selection.
- Rename/delete use local metadata only; deeper pi session file management is not implemented.
- Default unassigned sessions run in the configured default work dir, currently `~/.ousia/workspace`.
- Runtime extension file watching uses Node `fs.watch`.
- Runtime extension frontend apps loaded from `~/.ousia/extensions` are
  `user-local` distribution extensions with `local-user` trust. They are not
  sandboxed third-party code, and currently expose only `react` as a runtime
  package import.
- Runtime extension backend manifests are documented, but the Node extension
  host and `window.ousia.extensions.invoke(...)` bridge are not implemented yet.
- Forge packaging works; DMG/signing/notarization are not configured yet.

## Verification Notes

Recent builds pass with:

```bash
npm run typecheck
npm run lint
npm run build
```

Vite reports a large chunk warning after Streamdown integration. This is expected for now and does not block runtime.
