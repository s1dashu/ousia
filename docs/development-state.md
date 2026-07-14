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
npm run make:release:mac
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
- `npm run make:release:mac` builds the signed/notarized DMG plus the signed,
  notarized ZIP required by Squirrel.Mac automatic updates. Bump the app version
  first and attach both artifacts to the matching GitHub release.

Useful log tail:

```bash
tail -200 ~/.ousia/logs/ousia-desktop.log
```

Optional Sentry builds use `OUSIA_SENTRY_DSN`; development delivery additionally
requires `OUSIA_SENTRY_ENABLE_IN_DEVELOPMENT=1`. An enabled production package
requires `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `OUSIA_SENTRY_PROJECT` so the
exact release source maps are uploaded. Native minidumps remain off unless
`OUSIA_SENTRY_ENABLE_NATIVE_CRASH_REPORTS=1` is explicitly approved. See
`docs/sentry.md`; never commit any real token or DSN to the repository.

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
- Appearance mode, Radix color-scale, chat font, text-size, line-spacing,
  message-spacing, and content-width settings.
- Model provider API key settings, including local provider disable/hide state.
- Model and reasoning controls in the chat input. Pi uses its fixed thinking
  levels; Codex renders each model's app-server-provided efforts and default.
- Immediate final-style optimistic user-message rendering with provider success
  echoes removed and explicit same-id failure reporting.
- On-demand Codex app-server runtime download plus authentication, model
  discovery, streaming, history, branch, compact, interrupt, and export
  adaptation. The native archive is SHA-512 verified and cached atomically.
- Settings mode replaces the normal sidebar with categorized navigation and
  separates shared chat behavior from the selected Pi or Codex harness-specific
  configuration. Pi permission mode is Pi-only. Its controls use feature-local
  copies of the `bIkeymG` Vega Base UI primitives. Settings rows use a `720px` container breakpoint
  and a `52rem` content maximum.
- General settings are grouped as Agent Harness, Language & Region, and Default
  Creation Paths; the two creation-path settings stay together.
- Global shadcn semantic tokens match the neutral `bIkeymG` Vega preset.
  Appearance palettes are isolated as `--ousia-app-*` tokens and are mapped
  back only inside the session/project Sidebar. Chat, Composer, Settings,
  forms, and portaled controls use fixed neutral Vega surfaces. This boundary
  was backported from Miki commit
  `5949ecc7d9a3f87aff755e12e6b69935d967ddb8`. Mist is the default for new app
  state and was adapted from Miki commit
  `9ad986812f151b6a5c2811e7544efcaa4fdea27b`; persisted user palette choices
  are not overwritten.
- Sortable top-level sidebar sections: `会话` and `项目`.
- Packaged macOS builds check the private analytics service for releases. An
  available release adds an Update button to the sidebar footer; download is
  explicit, while the native app menu also provides **Check for Updates…** with
  visible success and failure results. Release checks use Electron's Chromium
  network stack so macOS proxy settings are honored. The update response points
  directly to the matching GitHub Release asset; Analytics reads GitHub's asset
  counters without proxying the download. Installation is automatic only after
  five minutes without input, no focused Ousia window, and no running agent
  turn. Otherwise the button becomes Restart after the update finishes downloading.
- Native application/context menus and manual-update dialogs follow the Ousia
  interface language. A successful language-settings save rebuilds the native
  menu immediately; restarting the app is not required.

## Persistence

- Sidebar session removal is non-destructive archival. Archived sessions are
  hidden from the sidebar and managed in the final Settings destination, which
  supports multi-select restore and confirmed permanent deletion. Permanent
  deletion also removes the provider-owned local session data: Pi JSONL through
  an exact SDK session lookup and Codex threads through app-server
  `thread/delete`; a provider failure keeps the corresponding Ousia record.
- Project rows expose a `...` menu for folder reveal, project archival, and
  deletion. Project archival atomically archives every active session in the
  project while keeping the project itself registered.

- App state persists settings, sessions, projects, shell layout, window state,
  expanded project ids, and current selection.
- Session/project index writes go through Electron main app-state transaction
  APIs; renderer no longer sends full app-state snapshots for those writes.
- Persistence accepts the current schema only; invalid or older development
  files fall back to default state.

## Notes

- Default unassigned sessions run in the configured default session folder.
  The add-project directory picker has a separate configurable starting folder;
  both initially use `~/Documents/Ousia`.
- Runtime logs live at `~/.ousia/logs/ousia-desktop.log`.
