<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./docs/media/ousia-logo.png">
    <img src="./docs/media/ousia-logo.png" alt="Ousia" width="96" />
  </picture>
</p>

<h1 align="center">Ousia</h1>

<p align="center">
  <strong>A minimalist desktop for the Pi coding agent.</strong>
</p>

<p align="center">
  <a href="https://github.com/s1dashu/ousia/releases/latest"><img src="https://img.shields.io/github/v/release/s1dashu/ousia?color=222222" alt="GitHub Release"></a>
  <img src="https://img.shields.io/badge/platform-macOS-222222" alt="Platform">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-222222" alt="License"></a>
  <img src="https://img.shields.io/badge/built_with-Electron-47848f?logo=electron&logoColor=white" alt="Electron">
  <img src="https://img.shields.io/badge/stack-React%2019-087ea4?logo=react" alt="React">
</p>

<p align="center">
  <a href="#-quick-start">Run from source</a>
  &nbsp;·&nbsp;
  <a href="#-development">Development</a>
</p>

<p align="center">
  <a href="https://github.com/s1dashu/ousia/releases/download/v0.3.3/Ousia-0.3.3-arm64.dmg">
    <img src="./assets/download-electron-button.svg?v=4" alt="Download the Electron version for macOS" width="280" height="48">
  </a>
</p>

---

## See Ousia in action

<p align="center">
  <img src="./assets/readme/ousia-dark-mode.gif" width="100%" alt="Ousia streaming a coding-agent response in dark mode">
</p>

## What is Ousia

**Ousia** is a minimalist desktop for the
[Pi Coding Agent](https://github.com/earendil-works/pi). It wraps Pi in a clean
macOS app with project-aware sessions, streaming
Markdown, and persistent chat history — so you can keep the conversation going
without leaving your codebase.

Think of it as a focused GUI layer for Pi: your projects, conversations,
extensions, and skills in one polished desktop workspace.

## Why Ousia

Coding agents are great in the terminal, but bouncing between your editor,
terminal, and the Agent's output creates constant friction. Ousia gives Pi and
its tools a dedicated desktop surface so conversations stay in context, tool
invocation is visible inline, and everything persists across restarts.

### In practice

- **Project-first sessions** — Every chat session is bound to a project
  directory. The agent reads, writes, and runs tools inside your project. Switch
  projects and the agent context follows.
- **Persistent everything** — Sessions, sidebar layout, window position, color
  theme, font preferences — all restored on relaunch.
- **Streaming Markdown** — Assistant responses render live with
  [Streamdown](https://streamdown.ai), including fenced code blocks, tables,
  and expandable tool-call summaries. Watch the agent think in real time.
- **Attachments in composer** — Drag files and images directly into a message
  when your model supports multimodal input.
- **Extensions & Skills** — Discover, install, update, and remove Pi packages
  from a curated catalog, and inspect skills already available to the Agent.
- **Conversation search** — Search across chat history and jump directly to a
  matching message.
- **Custom system prompts** — Shape Pi's behavior with a dedicated Markdown
  editor for your own system instructions.
- **Integrated Git branches** — Create and switch project branches from the
  new-task flow or an active session.
- **Conversation controls** — Interrupt or compact a conversation, branch from
  an earlier message, move sessions between projects, and archive them without
  losing history.
- **Queue or steer** — Choose whether a new message waits as a follow-up or
  intervenes in the task the selected Agent is currently running.
- **Model flexibility** — Configure Pi-compatible providers (Anthropic,
  OpenAI, Gemini, etc.) and choose the model and thinking level for each
  conversation.
- **Shared Pi config** — Ousia reads credentials and model config from your
  local Pi agent directory (`~/.pi/agent`). Providers set up in the Pi CLI or
  TUI work in Ousia automatically — and vice versa.
- **Local desktop state** — Ousia keeps its project/session index and debug
  logs locally under its isolated application data and `~/.ousia/logs/`.

## 🚀 Quick start

### Download (macOS)

[Download the latest `.dmg`](https://github.com/s1dashu/ousia/releases/download/v0.3.3/Ousia-0.3.3-arm64.dmg),
open it, drag **Ousia** into **Applications**, and launch. Previous versions and
release notes remain available on the [Releases page](https://github.com/s1dashu/ousia/releases/latest).

> ⚠️ Ousia is pre-release software. You'll hit rough edges. We ship fast and
> iterate faster.

### Run from source

```bash
# Requirements: Node.js ≥ 24, npm ≥ 11
git clone https://github.com/s1dashu/ousia.git
cd ousia
npm install
npm start
```

On first launch, Ousia asks for a default workspace folder (defaults to
`~/Documents/Ousia`). Configure Pi providers from **Settings** and start a
session.

## 🧱 Architecture

| Layer    | Stack                                                     |
| -------- | --------------------------------------------------------- |
| Shell    | Electron 42 + Electron Forge + Vite                       |
| UI       | React 19 + Tailwind CSS 4 + shadcn/ui + Framer Motion     |
| Markdown | Streamdown (streaming + static modes)                     |
| Agent    | Pi Coding Agent, hosted in the Electron main process      |
| Icons    | Nucleo icons                                             |
| State    | Local JSON via `Electron.app.getPath('userData')`         |

The renderer talks to Pi through a narrow `window.ousia` IPC bridge. Electron
main resolves every session's canonical project before routing the request, so
renderer paths cannot expand the Agent's workspace.

```
┌─────────────────────────────────────┐
│  Renderer Process                   │
│  ┌──────────┐  ┌──────────────────┐ │
│  │ Sidebar  │  │     Chat         │ │
│  │ Projects │  │  ┌────────────┐  │ │
│  │ Sessions │  │  │ Streamdown │  │ │
│  │ Settings │  │  │ Tool calls │  │ │
│  └──────────┘  │  │ Composer   │  │ │
│                 │  └────────────┘  │ │
│                 └──────────────────┘ │
└──────────┬──────────────────────────┘
           │ window.ousia (IPC)
┌──────────▼──────────────────────────┐
│  Electron Main Process              │
│  ┌──────────────────────────────┐   │
│  │      Pi Agent Sessions       │   │
│  │  (canonical session +        │   │
│  │   project cwd routing)       │   │
│  └──────────────────────────────┘   │
│  ┌──────────────────────────────┐   │
│  │  App State Store (JSON)      │   │
│  └──────────────────────────────┘   │
└─────────────────────────────────────┘
```

## 🛠 Development

```bash
npm run typecheck    # Type-check all TypeScript targets
npm run lint         # ESLint across the project
npm run check        # Both of the above
npx eslint src/path/to/changed-file.tsx  # Routine fast feedback
npm run verify:full  # Before commit: tests, checks, and app build

npm run package      # Production app bundle → out/
npm run make         # Local unsigned DMG (fast iteration)
```

### Release build (macOS signed + notarized)

```bash
# Apple Developer credentials
export APPLE_SIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="TEAMID"

npm run make:dmg:notarized   # Signed DMG + notarization
```

## Data and diagnostics

- Pi remains the source of truth for its providers, credentials, models,
  resources, and session history.
- Ousia writes desktop state atomically and keeps project/session restoration
  and active chat replay observable.
- Host, IPC, persistence, updater, provider, and renderer failures are recorded
  in structured local logs. Production builds also use privacy-sanitized Sentry
  diagnostics.
- Prompts, responses, tool payloads, credentials, and private file contents are
  excluded from diagnostics.

## 📖 Docs

| File                             | Covers                                                  |
| -------------------------------- | ------------------------------------------------------- |
| `AGENTS.md`                      | Entry point for coding agents contributing to this repo |
| `docs/product-context.md`        | Scope, product boundaries, glossary                     |
| `docs/design.md`                 | Design system, token ownership, and UI rules            |
| `docs/technical-architecture.md` | Stack, IPC model, state schema, logging                 |
| `docs/streamdown.md`             | Markdown rendering config and link handling             |
| `docs/shadcn-reference.md`       | Local shadcn/ui reference workflow                      |
| `docs/development-state.md`      | Current implementation state and commands               |

## 🤝 Contributing

Contributions are welcome. Before opening a PR:

1. Read `CONTRIBUTING.md` and `AGENTS.md`
2. Run `npm run check` to verify types and linting
3. For packaging changes, also run `npm run package`
4. Keep changes aligned with the current product direction (no extensions,
   no workspace panels)

## 📄 License

Ousia is [MIT](./LICENSE) © 2026 Ousia Desktop contributors.

Bundled CJK fonts are under [SIL OFL 1.1](./NOTICE).

---

<p align="center">
  <sub>Built with Electron, React, and Pi. Styled with Tailwind CSS & shadcn/ui.</sub>
</p>
