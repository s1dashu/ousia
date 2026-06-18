# Development State

## Commands

```bash
npm run typecheck
npm run lint
npm start
```

Packaging commands:

```bash
npm run package
npm run make
npm run make:dmg:notarized
```

- `npm run package` builds only `out/Ousia-darwin-arm64/Ousia.app` for local
  production smoke testing.
- `npm run make` builds a fast local DMG without signing or notarization.
- `npm run make:dmg:notarized` signs, notarizes, staples, and verifies the app
  and DMG for release distribution.

Useful log tail:

```bash
tail -200 ~/.ousia/logs/ousia-desktop.log
```

## Current Direction

The simplified app removes the Ousia extension system and keeps a smaller
desktop agent client:

- Sidebar for sessions/projects/settings.
- Chat as the primary agent surface.
- No right-side workspace panel, workspace tab strip, extension picker, runtime
  extension watcher, browser host, editor/PDF host, or extension state store.
- No `ousia extension ...` CLI bridge.
- No Ousia extension usage skill injection into Pi sessions.

## Implemented UI State

- Sidebar collapse/expand and resizing.
- Chat history rendering with Streamdown.
- File and image attachments in chat input.
- Appearance mode and Radix color-scale settings.
- Model provider API key settings.
- Model and thinking-level controls in the chat input.
- Settings UI isolated in `src/features/settings/SettingsPage.tsx`.
- Sortable top-level sidebar sections: `会话` and `项目`.

## Persistence

- App state persists settings, sessions, projects, shell layout, window state,
  expanded project ids, and current selection.
- Persistence accepts the current schema only; invalid or older development
  files fall back to default state.

## Notes

- Default unassigned sessions run in the configured default chat directory,
  currently `~/.ousia/chat`.
- Runtime logs live at `~/.ousia/logs/ousia-desktop.log`.
