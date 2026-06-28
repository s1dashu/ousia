<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./ousia-logo.png">
    <img src="./ousia-logo.png" alt="Ousia" width="96" />
  </picture>
</p>

<h1 align="center">Ousia</h1>

<p align="center">
  <strong>A minimalist desktop for the Pi Coding Agent.</strong>
</p>

<p align="center">
  <a href="https://github.com/s1dashu/ousia-desktop/releases/latest"><img src="https://img.shields.io/github/v/release/s1dashu/ousia-desktop?color=222222" alt="GitHub Release"></a>
  <img src="https://img.shields.io/badge/platform-macOS-222222" alt="Platform">
  <img src="https://img.shields.io/badge/status-pre--release-ebc248" alt="Status">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-222222" alt="License"></a>
  <img src="https://img.shields.io/badge/built_with-Electron-47848f?logo=electron&logoColor=white" alt="Electron">
  <img src="https://img.shields.io/badge/stack-React%2019-087ea4?logo=react" alt="React">
  <img src="https://img.shields.io/badge/styled-Tailwind%20CSS%204-06b6d4?logo=tailwindcss&logoColor=white" alt="Tailwind CSS">
</p>


<p align="center">
  <a href="https://github.com/s1dashu/ousia-desktop/releases/latest">
    <img src="https://img.shields.io/badge/↓_Download_for_macOS_(Apple_Silicon)-000000?style=for-the-badge&logo=apple&logoColor=white&borderRadius=8" alt="Download for macOS">
  </a>
</p>

<p align="center">
  <a href="#-quick-start">Run from source</a>
  &nbsp;·&nbsp;
  <a href="#-development">Development</a>
</p>

---

## What is Ousia

**Ousia** is a minimalist desktop for the [Pi Coding Agent](https://github.com/earendil-works/pi).
It wraps the agent in a clean macOS app with project-aware sessions, streaming
Markdown, and persistent chat history — so you can keep the conversation going
without leaving your codebase.

Think of it as the missing GUI layer for Pi. No tabs, no extensions, no hidden
panels. Just your projects and your agent, side by side.

## Why Ousia

Coding agents are great in the terminal, but bouncing between your editor,
terminal, and the agent's output creates constant friction. Ousia gives Pi a
dedicated desktop surface so conversations stay in context, tool invocation is
visible inline, and everything persists across restarts.

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
- **Model flexibility** — Configure any Pi-compatible provider (Anthropic,
  OpenAI, Gemini, etc.) in Settings. Switch models and tune thinking levels
  from the chat input without interrupting the conversation.
- **Shared Pi config** — Ousia reads credentials and model config from your
  local Pi agent directory (`~/.pi/agent`). Providers set up in the Pi CLI or
  TUI work in Ousia automatically — and vice versa.
- **Fully local** — Electron app, local state, no cloud account. Debug logs
  live at `~/.ousia/logs/`.

## 🚀 Quick start

### Download (macOS)

Get the latest `.dmg` from [Releases](https://github.com/s1dashu/ousia-desktop/releases/latest),
open it, drag **Ousia** into **Applications**, and launch.

> ⚠️ Ousia is pre-release software. You'll hit rough edges. We ship fast and
> iterate faster.

### Run from source

```bash
# Requirements: Node.js ≥ 24, npm ≥ 11
git clone https://github.com/s1dashu/ousia-desktop.git
cd ousia-desktop
npm install
npm start
```

On first launch, Ousia asks for a default workspace folder (defaults to
`~/Documents/Ousia`). Configure your model provider API key in **Settings**,
pick a model from the chat input, and start a session.

## 🧱 Architecture

| Layer | Stack |
|---|---|
| Shell | Electron 42 + Electron Forge + Vite |
| UI | React 19 + Tailwind CSS 4 + shadcn/ui + Framer Motion |
| Markdown | Streamdown (streaming + static modes) |
| Agent | Pi Coding Agent, hosted in Electron main process |
| Icons | HugeIcons Core Free |
| State | Local JSON via `Electron.app.getPath('userData')` |

The renderer talks to the agent through a narrow `window.ousia` IPC bridge.
Pi sessions are isolated by `projectPath` and `sessionId` — every chat message
carries both, so the agent always operates in the right directory.

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
│  │  Pi Coding Agent Sessions    │   │
│  │  (isolated by projectPath +  │   │
│  │   sessionId, cwd = project)  │   │
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

## 📖 Docs

| File | Covers |
|---|---|
| `AGENTS.md` | Entry point for coding agents contributing to this repo |
| `docs/product-context.md` | Scope, product boundaries, glossary |
| `docs/design-context.md` | UI rules, icon policy, shell constraints |
| `docs/technical-architecture.md` | Stack, IPC model, state schema, logging |
| `docs/streamdown.md` | Markdown rendering config and link handling |
| `docs/shadcn-reference.md` | Local shadcn/ui reference workflow |
| `docs/development-state.md` | Current implementation state and commands |

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
