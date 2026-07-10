# Testing Plan

This plan covers the simplified Ousia Desktop client: sidebar project/session
state, Pi/Codex chat orchestration boundaries, settings, and file preview
surfaces. The app is Electron + Vite + React, with both agents hosted from
Electron main.

## Test Strategy

Automated tests should cover deterministic product logic first:

- App state defaults, normalization, and transaction semantics in Electron main.
- Project path resolution and project-root containment checks.
- Tool file previews for write/edit operations, including invalid edits.
- Chat event reduction, attachment classification, history export, and tool UI
  formatting helpers.
- Model/provider selection helpers and compatibility aliases.
- Agent-provider routing, Codex RPC lifecycle, protocol event adaptation, and
  opaque thread-id persistence.
- Per-model Codex reasoning option/default mapping and independent Pi/Codex
  preference persistence.

Electron window behavior and real Pi/Codex execution should be smoke-tested
separately because they depend on native app launch state, local credentials,
shell environment, native binaries, and a real filesystem workspace.

## Automated Coverage

Run:

```bash
npm test
npm run test:coverage
```

Coverage thresholds are enforced in `vitest.config.ts` for core non-UI logic:

- Statements: 88%
- Lines: 88%
- Functions: 90%
- Branches: 80%

The coverage set intentionally excludes Electron bootstrap files and React TSX
surfaces until those have a stable component/E2E harness. UI behavior should be
covered through focused pure helpers now, then expanded with component tests for
sidebar, chat composer, settings forms, and tool preview interactions.

## Product Critical Paths

P0 automated paths:

- Loading app state returns a valid current-schema state.
- Invalid or old app-state files fall back to defaults instead of silently
  preserving unsafe data.
- Session/project transaction APIs create, delete, rename, move, reorder, and
  touch records without stale renderer snapshots.
- New sessions retain an immutable agent provider; Codex thread binding is
  atomic, idempotent, and rejects conflicting rebinding.
- Codex RPC parsing correlates responses, routes notifications/server requests,
  rejects pending work on exit, and never logs secrets.
- Codex model metadata preserves all non-empty reasoning efforts, applies the
  model default when no supported preference exists, and rejects inconsistent
  defaults or unsupported selections before starting a turn.
- Project-relative file paths cannot resolve outside the selected project.
- Write/edit tool previews expose meaningful diffs or explicit errors.
- Chat streaming events reduce into stable user, assistant, thinking, tool,
  system, and error history items.

P1 automated paths:

- Attachment classification for image, text-like, and generic files.
- Clipboard history formatting for empty, text, and tool histories.
- Model preset helpers merge stored and Pi-discovered providers correctly.
- Settings normalization rejects invalid theme, width, language, tool, and model
  values.

P2 / manual smoke paths:

- App launches from `npm start`.
- A new session can be created, renamed, moved between projects, and deleted.
- Settings can save provider credentials through Pi and refresh model status.
- A text-only chat request reaches Pi and streams assistant/tool updates.
- Codex account status/login works, and a text request streams through the
  packaged app-server; restart resumes the same opaque thread.
- Codex tool execution, file diff, branch, compact, and interrupt events map to
  stable Ousia items without auto-approving escalations.
- Interrupting a running chat reports the expected state in the UI.
- Finder actions open project directories and reveal project files.
- Runtime errors are written to `~/.ousia/logs/ousia-desktop.log`.

## Regression Rules

- Any change to `src/electron/app-state-store.ts` needs a transaction test.
- Any change to `src/electron/host-paths.ts` or Finder/file-preview behavior
  needs a path containment test.
- Any change to Pi event mapping needs a chat reducer test.
- Any change to Codex protocol/version, RPC handling, or event mapping needs a
  protocol fixture test plus packaged native-binary smoke test.
- Any change to model/reasoning selection needs tests for provider-specific
  persistence, per-model defaults, unknown future Codex values, and provider
  boundary rejection.
- Any change to tool preview payload handling needs a write/edit preview test.
- Any new user-visible settings field needs normalization and persistence tests.
