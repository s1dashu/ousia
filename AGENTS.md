# Ousia Electron engineering contract

## Non-negotiable engineering rules

1. Fail fast. Never hide errors behind fallback behavior or pretend a failed operation succeeded.
2. Fix root causes. Do not accumulate one-off patches around a defect.
3. Make failures observable. Critical host, IPC, persistence, updater, and renderer failures must leave useful structured logs.
4. Design for traceability. Important process starts, protocol failures, state transitions, and destructive operations must be diagnosable.
5. Keep this file current whenever the product direction, runtime architecture, or release workflow changes.
6. Protect the mainline. Create a dedicated branch before broad refactors or experimental work.

## Product direction

- Ousia Electron is the primary maintained product, and active development now
  continues on `main`. The historical
  `codex/archive-ousia-electron-v0.1.32` branch remains only as ancestry for the
  restored Electron line.
- Pi is the only supported and marketed agent runtime. Do not expose, advertise,
  or extend Codex as a product feature. Legacy Codex implementation remains in
  the tree only until its UI, runtime, dependency, and persisted-state migration
  can be removed deliberately without losing existing user data.
- Pi Tauri is frozen at the `v0.2.6` tag and GitHub release. Its source remains
  recoverable from that tag and the merged history; it is no longer the active
  `main` tree except for explicit compatibility, security, or release-transition
  work.
- The maintained Electron release line starts at `v0.3.0`; `v0.2.x` remains the
  frozen Tauri line. Electron tags use the standard `v...` form. Future Tauri
  tags, if any, must use `tauri-v...`, so only Tauri carries a product prefix.
  Existing `v0.1.x` and `electron-v0.1.x` Electron releases remain supported
  for upgrade compatibility.
- Electron releases are GitHub Latest. Tauri downloads remain pinned to `v0.2.6`, and Electron releases must preserve the frozen Tauri `latest.json` updater manifest so installed Tauri builds can still resolve `/releases/latest/download/latest.json`.
- Preserve Ousia's existing product identity, bundle identifier, application data, sessions, and upgrade paths unless a migration is explicitly designed and tested.

## Architecture source of truth

- Renderer: React 19 + TypeScript + Vite under `src/`.
- Desktop host and preload: Electron under `src/electron/`.
- Packaging: Electron Forge plus the scripts in `scripts/`.
- The preload bridge is the renderer trust boundary. Keep context isolation and validate IPC inputs in the host.
- Git branch reads and mutations are main-process-owned. The renderer passes a persisted project ID; the host resolves the canonical project path and executes Git without a shell.
- Pi is the sole supported agent provider. While the deprecated Codex provider
  remains in the tree, never route a failed or legacy session to Pi silently;
  retirement must use an explicit, observable migration.
- The main process owns sequenced replay snapshots for active chat streams. Renderer reloads must subscribe before replay hydration, then reconcile provider history when a run finishes.
- Pi history reads must use the active `SessionManager` branch while a session is running; the on-disk JSONL file is not authoritative until Pi flushes the turn.
- Persistence and session deletion must remain atomic, observable, and covered by tests.
- Runtime and Sentry diagnostics must not log prompt, response, tool payload, credential, or private file content.

## Window drag-region guardrail

The macOS window becoming impossible to drag after resizing is a recurring, difficult Electron defect and must be treated as highly regression-sensitive.
Keep every `-webkit-app-region: no-drag` declaration scoped beneath `.window-drag`, because global no-drag selectors can let clipped controls in scroll or overflow containers corrupt Chromium's native hit-test map after relayout.
Any title-bar, resize, scroll, overflow, or drag-region change must preserve `src/app/window-drag-regions.test.ts` and explicitly verify dragging after repeated resizes; do not restore traffic-light repositioning as a workaround.

## Validation policy

Keep the normal development loop proportional to the change:

- During routine development, default to linting only the changed source files.
  Do not automatically run targeted tests or `npm run typecheck` after each
  small edit.
- Run additional targeted checks during the daily loop only when the user asks
  for them or when a change is high-risk and delaying validation would make a
  likely failure materially harder to diagnose.
- Do not run `npm run build` for routine styling, copy, or isolated component
  changes. Production packaging is a checkpoint, not a per-edit requirement.
- Run `npm run verify:full` before committing, at periodic integration
  checkpoints, before a release, after dependency/build-system changes or broad
  refactors, or when the user explicitly requests full validation.
- Full build/package commands must run serially. They share `.vite/build` and
  can fail or corrupt validation results when run concurrently.

For release or packaging changes, also run the relevant signed/notarized macOS release workflow and verify the produced application and installer with Apple tooling before publishing.

Sentry is release-only. Development, tests, `npm run build`, local packaging,
and local DMG commands must keep it disabled. Only the explicit formal release
workflow may enable Sentry and load source-map upload credentials.
