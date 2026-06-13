# Development State

## Commands

```bash
npm run typecheck
npm run lint
npm start
```

Useful log tail:

```bash
tail -200 ~/.ousia/logs/ousia-desktop.log
```

## Current Branch Direction

The `simple-gui` branch removes the Ousia extension system and keeps a simpler
desktop agent client:

- Sidebar for sessions/projects/settings.
- Chat as the primary agent surface.
- Right-side terminal panel only.
- No workspace tab strip, extension picker, runtime extension watcher, browser
  host, editor/PDF host, or extension state store.
- No `ousia extension ...` CLI bridge.
- No Ousia extension usage skill injection into pi sessions.

## Implemented UI State

- Sidebar collapse/expand and resizing.
- Right terminal panel collapse/expand and resizing.
- Chat history rendering with Streamdown.
- File and image attachments in chat input.
- Appearance mode and Radix color-scale settings.
- Model provider API key settings.
- Model and thinking-level controls in the chat input.
- Settings UI isolated in `src/features/settings/SettingsPage.tsx`.
- Sortable top-level sidebar sections: `会话` and `项目`.
- Right header terminal icon opens the terminal panel directly.

## Terminal

- Renderer terminal UI: `src/features/terminal/TerminalPanel.tsx`.
- Main PTY host: `src/electron/project-terminal.ts`.
- Resources: `src/features/terminal/resources`.
- Packaged resource target: `terminal` in Electron resources.

## Persistence

- App state persists settings, sessions, projects, shell layout, window state,
  expanded project ids, and current selection.
- Persistence accepts the current schema only; invalid or older development
  files fall back to default state.

## Notes

- Default unassigned sessions run in the configured default work dir, currently
  `~/.ousia/workspace`.
- Runtime logs live at `~/.ousia/logs/ousia-desktop.log`.
