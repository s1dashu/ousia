# Product Context

This project is the Pi-only Ousia desktop client. The product focus is a direct
Pi chat experience with projects, sessions, settings, and Pi packages.

Ousia can discover and manage Pi packages, extensions, prompts, skills, and
themes. It is not a general extension host: packages extend Pi, not the Ousia
renderer, and cannot own workspace tabs, panels, or application state.

The legacy Codex implementation is deprecated and outside the supported product
surface. It remains temporarily for an explicit removal and persisted-session
migration; do not advertise it or add new Codex functionality.

## Scope

In scope:

- Project and session navigation in the left sidebar.
- Agent chat backed by Pi in Electron main.
- Project/session isolated cwd for agent work.
- Pi package and installed-skill discovery plus package lifecycle management.
- User settings for appearance mode, Radix color scale, chat typography and
  spacing, Pi model-provider API keys, model, thinking level, custom system
  prompt, default session folder, and default project creation starting folder.

Out of scope:

- Renderer-loaded Ousia runtime extensions under `~/.ousia/extensions`.
- Codex authentication, sessions, models, or runtime features.
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
- Chat: central conversation surface for a Pi session.
- Default session folder: directory used as the cwd for unassigned sessions,
  initially `~/Documents/Ousia`.
- Default project creation starting folder: initial directory shown when adding
  a project, also initially `~/Documents/Ousia` but independently configurable.
- Agent: the Pi runtime hosted by Electron main for a project-aware session.
