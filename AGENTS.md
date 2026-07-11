# Ousia Desktop Agent Guide

This file is an index, not the full project context. Read only the docs that
match the task.

## Start Here

- Product intent and scope: [docs/product-context.md](docs/product-context.md)
- Design system and UI rules: [docs/design.md](docs/design.md)
- Technical architecture: [docs/technical-architecture.md](docs/technical-architecture.md)
- Codex provider architecture: [docs/codex-integration.md](docs/codex-integration.md)
- Streamdown Markdown rendering: [docs/streamdown.md](docs/streamdown.md)
- shadcn/ui local reference workflow: [docs/shadcn-reference.md](docs/shadcn-reference.md)
- Current development state and commands: [docs/development-state.md](docs/development-state.md)
- Performance architecture, baseline, and roadmap: [docs/performance.md](docs/performance.md)

## High-Signal Facts

- The current app is a reduced desktop agent client.
- Ousia has two responsibilities: it is a standalone desktop Agent product and
  the upstream framework used to build downstream Agent products such as Miki.
  Preserve clean compile-time extension boundaries even when Ousia Desktop does
  not use every extension point itself.
- Reusable shell, provider, lifecycle, IPC, persistence, observability, and UI
  behavior belongs upstream in Ousia. Product prompts, product tools, private
  Workspace Apps, branding, and product file policies are injected by a
  downstream composition root; Ousia core must never import downstream code.
- Public framework contracts live in versioned `@ousia/*` packages. The first
  extraction branch is `codex/extract-public-host-packages`; do not restore the
  removed user-local runtime extension loader to provide product extensibility.
- Do not try to keep downstream repositories source-identical to Ousia. The
  long-term goal is one source of truth for framework mechanisms, consumed
  through versioned packages, while each product keeps its own policy and UI.
- The app shell is assembled from React surfaces: sidebar, chat, and settings.
- Opening Settings replaces the project/session sidebar with General,
  Appearance, Chat Settings, and one dynamic Pi-or-Codex settings destination.
  Pi permission mode belongs under Pi Settings. The Harness choice remains a
  default for new sessions; existing session providers stay immutable.
- There is no Ousia extension/runtime-extension/plugin surface in this branch.
- The desktop runtime is Electron + Vite + React.
- The app supports Pi and Codex coding agents, both hosted from Electron main.
- Packaged builds do not embed the Codex native runtime. The pinned
  platform-specific `@openai/codex` archive is downloaded from the official npm
  registry on first Codex use, verified against its SHA-512 integrity, and
  atomically cached under the Ousia user-data directory.
- Agent provider is immutable per session. Pi uses the Ousia session id; Codex
  uses a separately persisted opaque thread id returned by app-server.
- Pi thinking level and Codex reasoning effort are separate preferences. Codex
  options, descriptions, and per-model defaults come from app-server
  `model/list`; they are not a shared hardcoded enum.
- Chat requests include `projectPath` and `sessionId`, but Electron main derives
  and validates cwd from canonical app state before routing; renderer paths are
  never an agent permission boundary.
- The default folder for unassigned sessions and the starting folder for adding
  projects are independently configurable; both initially use
  `~/Documents/Ousia`.
- Runtime logs are persisted at `~/.ousia/logs/ousia-desktop.log`; check this
  file first for Electron main errors, renderer console messages, renderer
  uncaught errors, and chat/title-generation failures.
- Packaged macOS updates use the independent analytics/update service and
  Squirrel.Mac. Releases must include a signed/notarized ZIP in addition to the
  DMG; checks do not download until the user clicks Update.
- The first BrowserWindow must not wait for shell-environment hydration or Pi
  runtime parsing. Provider-heavy modules are loaded only at capability
  boundaries; see `docs/performance.md` before changing startup imports.
- Streaming text deltas are coalesced in Electron main for at most 16 ms. Any
  non-delta event flushes pending text first so visible event ordering remains
  unchanged.
- User messages are published optimistically in the renderer with a stable
  `messageId` and immediately use the normal successful visual style. Pi and
  Codex must not echo successful user messages; renderer optimism is the single
  live write source. Provider failures carry the full canonical user event with
  the same id so a remounted renderer can reconstruct it, and a send must wait
  for any in-flight initial history snapshot before provider execution.
- Ousia is single-instance because Electron main owns a canonical in-memory app
  state snapshot. A second launch must focus the existing window instead of
  creating a competing writer for `app-state.json`.
- Live Pi AgentSessions are capped with idle-only LRU eviction. Never evict a
  streaming, queued, or bash-running session; deletion must release provider
  state and unsubscribe/dispose Pi resources.

## Important Source Entrypoints

- App shell and current UI state: [src/App.tsx](src/App.tsx)
- Chat UI: [src/features/chat/ChatArea.tsx](src/features/chat/ChatArea.tsx)
- Electron main process and agent router: [src/electron/main.ts](src/electron/main.ts)
- Codex app-server client: [src/electron/codex-app-server-client.ts](src/electron/codex-app-server-client.ts)
- Codex provider adapter: [src/electron/codex-agent-provider.ts](src/electron/codex-agent-provider.ts)
- Electron preload API: [src/electron/preload.ts](src/electron/preload.ts)
- Renderer IPC types: [src/electron/chat-types.ts](src/electron/chat-types.ts)
- Electron Forge config: [forge.config.cjs](forge.config.cjs)
- Forge Vite configs: [vite.main.config.ts](vite.main.config.ts), [vite.preload.config.ts](vite.preload.config.ts), [vite.renderer.config.ts](vite.renderer.config.ts)

## Framework Evolution And Downstream Upgrades

- Put a change in Ousia when another Agent product could reasonably reuse it:
  Electron/window lifecycle, Agent runtime and provider adapters, conversation
  history/event flow, dynamic tool registration, WorkspaceHost contracts, IPC,
  logging/observability, persistence orchestration, themes, shortcuts, and the
  generic sidebar/chat/settings shell.
- Keep product prompts, product tools, private Workspace Apps and their codecs,
  domain models, branding, data isolation, file-placement policy, and
  product-specific interaction design downstream.
- A downstream workaround for a missing framework capability is not a permanent
  extension mechanism. Define a strict typed contribution point in Ousia, make
  Ousia Desktop use the same public boundary, then remove the downstream hack.
- Prefer a small set of explicit, typed, fail-fast contracts over accumulating
  optional flags. Required providers, tools, Workspace Apps, codecs, path
  policies, and IPC procedures must fail composition when absent or invalid.
- Classify repository differences by ownership, not textual similarity:
  reusable bug fixes and performance work move upstream; product behavior stays
  downstream; genuinely variable behavior becomes an explicit strategy
  contract; harmless structural differences do not justify a rewrite.
- Publish framework changes as exact, versioned `@ousia/*` packages with release
  notes and contract tests. Downstream products upgrade those exact versions on
  a dedicated integration branch, run both Ousia and product gates, adapt their
  composition code, and delete any framework implementation now supplied by the
  package. Do not make downstream products depend on a floating Ousia `main`.
- Until a framework area has been extracted into a package, keep its commits
  separable and traceable so a downstream integration branch can port them
  without merging the Ousia product wholesale. This is transitional, not the
  intended steady-state maintenance model.

## Working Rules For Future Agents

- 优先定位问题的根本原因并修复根因；不要只为当前坏数据或单个 badcase
  做补丁式恢复，除非用户明确要求先救数据。
- This is a new project; do not add backward-compatibility migrations, legacy
  config shims, or old-option fallbacks unless the user explicitly asks for
  them.
- Do not reintroduce Ousia extension, runtime extension, plugin, addon, browser,
  editor, PDF, Excalidraw, or Sheets workspace surfaces unless the user
  explicitly asks to reverse this branch direction.
- Do not solve a downstream product need with an Ousia-side product special
  case. Add a strict, versioned host contract or product contribution point,
  make Ousia consume that boundary itself, and keep unknown capabilities and
  invalid state as hard errors.
- Keep framework performance and reliability changes separable from Ousia-only
  product changes so downstream products can upgrade the host without merging
  the Ousia application wholesale. Record material host behavior changes in
  the relevant architecture docs and package release notes.
- Do not inject an Ousia extension usage skill or CLI bridge into Pi sessions.
- Keep global shadcn semantic tokens aligned exactly with the neutral
  `bbVKEbY` Maia preset. Product-specific color treatments must not mutate that
  global token set.
- Keep primary floating panels, menus, popovers, dialogs, and dropdown surfaces
  pure white. Paper is an auxiliary/background color, not the main panel color.
- Appearance scales currently live under the migration palette
  `--ousia-app-*` in `src/index.css`. Existing `ousia-chat-theme` and
  `ousia-sidebar-theme` scopes are migration adapters, not the target system.
  Do not add new broad shadcn token remapping; migrate reviewed product surfaces
  toward direct `--ousia-<component>-<role>` tokens as specified in
  `docs/design.md`. Settings and generic shadcn primitives must continue to read
  global Maia semantics.
- The dark chat panel uses `card` as its background, so user message bubbles
  need a different dark surface such as `muted` to remain visible.
- Match those floating surfaces to the composer default surface treatment:
  `0.5px` foreground/10 border and the shared
  `--ousia-floating-panel-shadow`, which is slightly stronger than the composer
  shadow; avoid thicker borders, diffuse shadows, or ad hoc panel shadows.
- Before building a fresh app package, check whether there are code changes. If
  code has changed since the previous package, bump the app version first so the
  new package has a new version number.
- Follow the project icon policy in `docs/design.md`: use HugeIcons for
  interface icons and route imports through `src/components/icons/huge-icons.tsx`.
- Before changing shadcn/ui primitives, compare against a local generated
  reference under ignored `ref/`; see `docs/shadcn-reference.md`.
- Base UI dropdown labels must be children of `DropdownMenuGroup` or
  `DropdownMenuRadioGroup`; a bare `DropdownMenuLabel` is a runtime error.
- Settings uses feature-local Base UI primitives copied from the original
  `bbVKEbY` Maia source. Keep Button, Card, Input, Select, Switch, and Dialog
  aligned with that reference; do not replace Maia semantic tokens, radii,
  rings, or shadows with fixed values. Settings must remain outside the tuned
  chat/session-sidebar token scopes so its sidebar, controls, menus, dialogs,
  and panel read the global Maia semantics. The settings sidebar may reuse only
  `--ousia-sidebar` for background continuity with the session sidebar.
- The canonical light Card is `src/components/ui/card.tsx` and follows Maia's
  pure-white global Card surface. Keep product-specific card treatments inside
  explicit Ousia scopes instead of changing the global Card token.
- Chat and settings panels share their left-corner geometry through
  `src/features/shell/main-panel-styles.ts`; color ownership remains separate:
  chat uses the local Ousia scope and Settings uses global Maia tokens.
- When changing agent behavior, verify whether the change belongs in renderer
  state, Electron IPC, the provider router, Pi session setup, or Codex
  app-server adaptation.
- Keep `@openai/codex` and the on-demand runtime manifest pinned to the version
  documented in `docs/codex-integration.md`. Regenerate/compare app-server
  protocol types and run downloaded native-binary smoke tests before upgrading
  it.
- Preserve every non-empty Codex reasoning effort returned by `model/list`,
  including unknown future values, and validate the selected effort at the
  provider boundary. Do not filter Codex efforts through Pi's fixed levels.
- Never derive a Codex thread id from an Ousia session id, parse private Codex
  rollout files, read/write Codex `auth.json`, auto-approve app-server requests,
  or enable experimental app-server capabilities by default.
- Never pass a renderer-supplied project path into an agent sandbox. Resolve the
  session's canonical project/default session folder in Electron main, reject a
  mismatched path, and forward only the canonical value.
- Session/project indexes are owned by Electron main. Renderer must not persist
  full app-state snapshots for session or project changes; use the app-state
  transaction IPCs (`createSession`, `deleteSession`, `renameSession`,
  `moveSession`, `createProject`, etc.) and sync from the returned canonical
  state.
- Contextual chat events for a session that no longer exists must be logged and
  dropped; never fall them back into the currently selected chat. Running
  sessions/projects must not be deleted until their agent turn is terminal.
- Preserve renderer-generated chat `messageId` values across IPC and provider
  failure events. Never emit a second provider success item, replace the id with
  a provider-local random id, or dedupe user messages by text/time heuristics.
  Electron main must reject a repeated id for the same live session before
  routing it to either provider.
- `autoRetryOnFailure` is Pi-only. Renderer payloads for Codex must omit it, and
  the Codex provider boundary must reject it if it appears.
- Tool call disclosure state is renderer-local UI memory in `localStorage`
  under `ousia.chat.toolDisclosure.v1`; do not persist it into chat history.
- Pi write/edit disclosures distinguish streamed input completion from actual
  tool execution completion. Derive per-file input completion from the first
  strictly complete raw argument JSON for that content index; some
  OpenAI-compatible providers delay every `toolcall_end` until the whole model
  response finishes. Only collapse at input completion after the renderer has
  already observed the item as an active write/edit preview; late tool-name
  identification must still reveal the preview until execution ends. Keep the
  tool running until `tool_execution_end`.
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
