# Development State

## Commands

```bash
npm run typecheck
npm run lint
npm test
npm run test:coverage
npm start
```

Testing strategy and coverage scope are tracked in
[docs/testing-plan.md](testing-plan.md).
The current performance baseline, optimization roadmap, and regression
guardrails are tracked in [docs/performance.md](performance.md).

Packaging commands:

```bash
npm run package
npm run make
npm run make:dmg:signed
npm run notarize:dmg
npm run make:dmg:notarized
```

- `npm run package` builds only `out/Ousia-darwin-arm64/Ousia.app` for local
  production smoke testing.
- `npm run make` builds a fast local DMG without signing or notarization.
- `npm run make:dmg:signed` signs the app and DMG but does not notarize them.
- `npm run notarize:dmg -- <path-to-dmg>` notarizes, staples, and verifies an
  existing signed DMG. If no path is provided, it uses the newest DMG under
  `out/make`.
- `npm run make:dmg:notarized` runs the signed DMG build and then notarizes that
  DMG for release distribution.

Useful log tail:

```bash
tail -200 ~/.ousia/logs/ousia-desktop.log
```

Packaged startup timing is logged under `window.startup`, split into app-state,
BrowserWindow, renderer-load, and total durations.

## Current Direction

The simplified app removes the Ousia extension system and keeps a smaller
desktop agent client:

- Sidebar for sessions/projects/settings.
- Chat as the primary agent surface.
- Per-session Pi or Codex agent runtime; the default only affects new sessions.
- No right-side workspace panel, workspace tab strip, extension picker, runtime
  extension watcher, browser host, editor/PDF host, or extension state store.
- No `ousia extension ...` CLI bridge.
- No Ousia extension usage skill injection into Pi sessions.

## Implemented UI State

- Sidebar collapse/expand and resizing.
- Chat history rendering with Streamdown.
- File and image attachments in chat input.
- Appearance mode and Radix color-scale settings.
- Model provider API key settings, including local provider disable/hide state.
- Model and reasoning controls in the chat input. Pi uses its fixed thinking
  levels; Codex renders each model's app-server-provided efforts and default.
- Bundled Codex app-server authentication, model discovery, streaming,
  history, branch, compact, interrupt, and export adaptation.
- Settings UI isolated in `src/features/settings/SettingsPage.tsx`.
- Sortable top-level sidebar sections: `会话` and `项目`.

## Persistence

- App state persists settings, sessions, projects, shell layout, window state,
  expanded project ids, and current selection.
- Session/project index writes go through Electron main app-state transaction
  APIs; renderer no longer sends full app-state snapshots for those writes.
- Persistence accepts the current schema only; invalid or older development
  files fall back to default state.

## Notes

- Default unassigned sessions run in the configured default workspace folder,
  currently `~/Documents/Ousia`.
- Runtime logs live at `~/.ousia/logs/ousia-desktop.log`.
