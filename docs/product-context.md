# Product Context

This branch is the simplified Ousia desktop client. The product focus is a
direct agent chat experience with projects, sessions, settings, and a built-in
right-side terminal.

The app is intentionally not extension-native on this branch. Runtime
extensions, first-party workspace extensions, extension tabs, and agent-operable
extension actions have been removed.

## Scope

In scope:

- Project and session navigation in the left sidebar.
- Agent chat backed by pi coding agent in Electron main.
- Project/session isolated cwd for agent work.
- A right-side terminal panel using xterm.js and node-pty.
- User settings for appearance mode, Radix color scale, model provider API
  keys, model, thinking level, and default work dir.

Out of scope:

- Ousia runtime extensions under `~/.ousia/extensions`.
- First-party Browser, Editor, PDF, Excalidraw, or Sheets workspace surfaces.
- Workspace extension tabs or extension picker.
- Local `ousia extension ...` CLI bridge.
- Ousia extension usage skill injection into pi sessions.

## Product Boundary

The agent remains the primary worker. The terminal is a direct companion surface
for observing and interacting with the selected project environment. Other file
preview, editing, browser, and custom UI workflows should happen through normal
agent tools or future explicit product work, not through the removed extension
system.

## Glossary

- Sidebar: left project/session/settings navigation.
- Chat: central conversation surface for the pi coding agent.
- Terminal panel: right-side built-in terminal for the selected project/session.
- Default work dir: directory used by unassigned sessions, currently
  `~/.ousia/workspace`.
