# Product Context

This project is the simplified Ousia desktop client. The product focus is a
direct agent chat experience with projects, sessions, and settings.

The app is intentionally not extension-native in this direction. Runtime
extensions, first-party workspace extensions, extension tabs, and agent-operable
extension actions have been removed.

## Scope

In scope:

- Project and session navigation in the left sidebar.
- Agent chat backed by a per-session Pi or Codex agent in Electron main.
- Project/session isolated cwd for agent work.
- User settings for the default agent for new sessions, Codex authentication,
  appearance mode, Radix color scale, chat typography and spacing, Pi model provider API keys, model,
  provider-specific thinking/reasoning preference, default session folder, and
  default project creation starting folder.

Out of scope:

- Ousia runtime extensions under `~/.ousia/extensions`.
- First-party Browser, Editor, PDF, Excalidraw, or Sheets workspace surfaces.
- Built-in right-side terminal or other secondary workspace panels.
- Workspace extension tabs or extension picker.
- Local `ousia extension ...` CLI bridge.
- Ousia extension usage skill injection into Pi sessions.

## Product Boundary

The agent is the primary worker. File preview, editing, browser, terminal, and
custom UI workflows should happen through normal agent tools or future explicit
product work, not through the removed extension system or a secondary workspace
panel.

## Glossary

- Sidebar: left project/session/settings navigation.
- Chat: central conversation surface for the session's immutable Pi or Codex
  Agent provider.
- Default session folder: directory used as the cwd for unassigned sessions,
  initially `~/Documents/Ousia`.
- Default project creation starting folder: initial directory shown when adding
  a project, also initially `~/Documents/Ousia` but independently configurable.
- Agent provider: the immutable Pi or Codex runtime selected when a session is
  created. Changing the default only affects new sessions.
