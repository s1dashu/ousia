<p align="center"><sub><strong>MAC CLIENT FOR PI</strong></sub></p>

<h1 align="center">Ousia</h1>

<p align="center">
  <strong>Super light. Clean by design.</strong><br>
  A faster, smoother way to work with Pi.
</p>

<p align="center">
  <code>≈10 MB DOWNLOAD</code>&nbsp;&nbsp;·&nbsp;&nbsp;<code>MINIMALIST DESIGN</code>&nbsp;&nbsp;·&nbsp;&nbsp;<code>SMOOTH EXPERIENCE</code>
</p>

<p align="center">
  <a href="https://tauri.app/"><img src="https://img.shields.io/badge/Tauri-2-24C8DB?style=flat-square&amp;logo=tauri&amp;logoColor=white" alt="Built with Tauri 2"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-222222?style=flat-square" alt="MIT License"></a>
</p>

<p align="center">
  <a href="https://github.com/s1dashu/ousia/releases/download/v0.1.32/Ousia-0.1.32-arm64.dmg"><strong>Download Electron</strong></a>
  ·
  <a href="https://github.com/s1dashu/ousia/releases/download/v0.2.6/Pi_aarch64.dmg"><strong>Download Tauri</strong></a>
  ·
  <a href="#development">Development</a>
</p>

<p align="center">
  <a href="https://github.com/s1dashu/ousia/releases/download/v0.1.32/Ousia-0.1.32-arm64.dmg"><strong>Download Ousia Electron v0.1.32</strong></a><br>
  <sub>Original Electron edition · macOS Apple Silicon</sub>
</p>

<p align="center">
  <a href="https://github.com/s1dashu/ousia/releases/download/v0.2.6/Pi_aarch64.dmg"><strong>Download Pi Tauri v0.2.6</strong></a><br>
  <sub>Current lightweight Tauri edition · macOS Apple Silicon</sub>
</p>

## Recent changes

- [**v0.2.6**](https://github.com/s1dashu/ousia/releases/tag/v0.2.6) — Clearer Pi request failures, smoother sidebar dragging, and consistent sidebar text alignment.
- [**v0.2.5**](https://github.com/s1dashu/ousia/releases/tag/v0.2.5) — Stable sidebar spacing across display and scrollbar configurations.
- [**v0.2.4**](https://github.com/s1dashu/ousia/releases/tag/v0.2.4) — Signed in-app updates with explicit download and install controls.

[View all releases →](https://github.com/s1dashu/ousia/releases)

## See Ousia in action

<p align="center">
  <img src="./assets/readme/ousia-dark-mode.gif" width="100%" alt="Ousia streaming code generation from Pi">
</p>

## Pi, with a better desktop experience

Ousia gives Pi a focused, polished workspace on macOS. It works with the Pi already on your Mac, so your models, extensions, settings, and conversations are ready to use.

The download is only **about 10 MB**, so Ousia is quick to install and takes up very little space.

## Why Ousia

- **Super lightweight** — only about 10 MB to download, with a small footprint on your Mac.
- **Cleaner, more polished UI/UX** — projects, conversations, light and dark themes, live tool progress, and a simple message box that keeps the focus on your work.
- **Faster, smoother performance** — a responsive interface that stays smooth while Pi is working, even during long conversations.
- **Improved stability and reliability** — protects saved conversations, prevents duplicate windows, and clearly tells you when something goes wrong.

## Download

Both editions support **macOS on Apple Silicon**.

### Ousia Electron v0.1.32

[Download the Electron DMG](https://github.com/s1dashu/ousia/releases/download/v0.1.32/Ousia-0.1.32-arm64.dmg)

This is the latest published release of the Electron application.

### Pi Tauri v0.2.6

[Download the Tauri v0.2.6 DMG](https://github.com/s1dashu/ousia/releases/download/v0.2.6/Pi_aarch64.dmg)

This is the current lightweight Tauri application with signed in-app updates.

Open the downloaded DMG, move the app to `Applications`, then launch it. The Tauri edition can use your existing Pi executable or install Pi into its own managed directory.

Release builds are signed with a Developer ID certificate, notarized by Apple, and validated with Gatekeeper before publishing.

## What you can do

- Organize conversations into projects and sessions.
- Stream assistant responses, thinking, tool calls, and file previews in real time.
- Queue follow-up messages while Pi is working, or switch to steering mode.
- Choose from the models and providers already configured in Pi.
- Interrupt, compact, branch, move, archive, and export sessions.
- Tune theme, content width, type size, line spacing, and message density.
- Reuse the same Pi credentials, extensions, settings, and session directory across the CLI and desktop app.

## How it stays light

```text
┌──────────────────────────┐        JSONL RPC        ┌──────────────────────┐
│          Ousia           │  ───────────────────▶   │   pi --mode rpc      │
│  interface + native host │                         │   your Pi runtime     │
└──────────────────────────┘                         └──────────────────────┘
                                                               │
                                                               ▼
                                                  config · models · sessions
```

Ousia owns the desktop experience. Pi owns the agent runtime. There is no duplicate credential store and no bundled runtime hidden inside the application package.

## Requirements

To connect an existing Pi installation, Ousia only needs a valid `pi` executable. It can discover Pi from your login-shell `PATH`, common install locations, the active npm global prefix, or a path selected in Settings.

If Pi is not installed, Ousia can use your existing Node.js and npm to install `@earendil-works/pi-coding-agent` into an app-owned directory. This optional setup does not change the system npm prefix and never removes `~/.pi`.

## Development

Prerequisites:

- macOS
- Node.js and npm
- Rust toolchain
- Pi, or a path supplied through `PI_GUI_PI_PATH`

Start the development app:

```sh
npm ci
npm run desktop:dev
```

Use a specific Pi executable when needed:

```sh
PI_GUI_PI_PATH=/absolute/path/to/pi npm run desktop:dev
```

Run the required checks:

```sh
npm run typecheck
npm run lint
cargo test --manifest-path src-tauri/Cargo.toml
npm run build
```

Build the macOS app locally:

```sh
npm run desktop:build -- --bundles app
```

The application is written with React, TypeScript, Tauri, and Rust. The desktop host communicates with Pi through strict line-delimited JSON over standard input and output.

<details>
<summary><strong>Signed macOS release builds</strong></summary>

Official releases require a Developer ID identity and Apple notarization credentials:

```sh
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_ID="you@example.com"
export APPLE_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="TEAMID"
npm run release:mac
```

The release script fails immediately if signing, notarization, stapling, DMG verification, or Gatekeeper assessment does not succeed. It produces the DMG, a ZIP containing the same notarized app, and a SHA-256 checksum file.

</details>

## Data and diagnostics

- Pi remains the owner of its configuration, credentials, models, extensions, and sessions.
- Ousia stores only desktop UI state and the mapping required to reopen Pi sessions.
- State is written atomically.
- Host, subprocess, RPC, and renderer failures are recorded in structured local logs.
- Message content and tool payloads are not written to performance logs.

## License

See [LICENSE](./LICENSE) for the project license and [NOTICE](./NOTICE) for third-party notices.
