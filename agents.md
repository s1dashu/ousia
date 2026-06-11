# Ousia Desktop Agent Guide

This file is an index, not the full project context. Read only the docs that match the task.

## Start Here

- Product intent and scope: [docs/product-context.md](docs/product-context.md)
- UI direction and interaction rules: [docs/design-context.md](docs/design-context.md)
- Technical architecture: [docs/technical-architecture.md](docs/technical-architecture.md)
- Extension runtime model: [docs/extension-runtime.md](docs/extension-runtime.md)
- Extension architecture endgame: [docs/extension-architecture-endgame.md](docs/extension-architecture-endgame.md)
- Runtime extensions: [docs/runtime-extensions.md](docs/runtime-extensions.md)
- System extensions feasibility: [docs/system-extensions-feasibility.md](docs/system-extensions-feasibility.md)
- Streamdown Markdown rendering: [docs/streamdown.md](docs/streamdown.md)
- shadcn/ui generated reference: [docs/shadcn-reference.md](docs/shadcn-reference.md)
- Current development state and commands: [docs/development-state.md](docs/development-state.md)

## High-Signal Facts

- Ousia is an extension-native desktop agent client.
- Ousia's core blueprint is a powerful, flexible agent plus a rich extension
  ecosystem.
- The agent performs most user work; extensions mainly let humans inspect,
  audit, preview, and lightly intervene in the agent's outputs.
- Extension context should be agent-visible, including active surface, opened
  file/resource, selection, view state, and recent user operations.
- Extensions should expose common actions so the agent can operate them under
  the user's observation.
- Agent-facing Ousia usage instructions should live in the unified `ousia`
  skill, stay minimal, and tell pi to list extensions, call each extension's
  `help` action before use, and only use actions documented by that help output.
  Put extension-specific usage details in CLI help, not in pi's system prompt.
- The app shell is assembled from React surfaces: sidebar, chat, and workspace.
- The first customizable surface is the workspace tab area.
- First-party bundled extensions are compiled into the app; custom user-authored surfaces live as runtime extension packages under `~/.ousia/extensions`.
- The desktop runtime is Electron + Vite + React.
- The real coding agent is pi coding agent, hosted in Electron main process.
- Chat requests include `projectPath` and `sessionId`; pi sessions are isolated by project/session so tool execution uses the selected project as cwd.
- Default work dir is user configurable and defaults to `~/.ousia/workspace`.
- Runtime logs are persisted at `~/.ousia/logs/ousia-desktop.log`; check this
  file first for Electron main errors, renderer console messages, renderer
  uncaught errors, and chat/title-generation failures.

## Important Source Entrypoints

- App shell and current UI state: [src/App.tsx](src/App.tsx)
- Electron main process and pi session bridge: [src/electron/main.ts](src/electron/main.ts)
- Electron preload API: [src/electron/preload.ts](src/electron/preload.ts)
- Renderer IPC types: [src/electron/chat-types.ts](src/electron/chat-types.ts)
- Electron Forge config: [forge.config.cjs](forge.config.cjs)
- Forge Vite configs: [vite.main.config.ts](vite.main.config.ts), [vite.preload.config.ts](vite.preload.config.ts), [vite.renderer.config.ts](vite.renderer.config.ts)
- Extension registry and slot renderer implementation live in the renderer source tree.

## Working Rules For Future Agents

- Route Ousia usage, including runtime extension/plugin/addon/component
  creation/update/debug/removal, to the unified pi skill at
  `/Users/bytedance/.pi/agent/skills/ousia/SKILL.md`.
- Runtime extensions use `package.json#ousia.app`. Simple extensions can be `package.json + App.tsx`; `src/` is optional.
- Before adding a first-party extension, prefer the most popular active community stack or component that solves the core problem.
- Keep `agents.md` short. Put product, design, and technical notes in `docs/`.
- After code changes, update the relevant docs when the work changes technical stack choices, architecture, or project background, and link those docs from this file.
- When adding or changing agent-operable extension actions, update the
  extension's CLI `help` output first; avoid copying action details into pi's
  system prompt or the generic Ousia extension skill.
- Prefer adding focused docs over expanding this file.
- Preserve the shadcn preset theme direction unless the user explicitly changes it.
- Follow the project icon policy in `docs/design-context.md`: use Lucide for ordinary, quiet utility icons and Solar icons for high-expression navigation or major workspace/extension signals.
- Before changing shadcn/ui primitives, compare against the generated reference under `ref/`; see `docs/shadcn-reference.md`.
- Do not replace the open/free workspace with a fixed review/code surface.
- When changing agent behavior, verify whether the change belongs in renderer state, Electron IPC, or pi session setup.
