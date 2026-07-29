# Ousia Electron engineering contract

## Non-negotiable engineering rules

1. Fail fast. Never hide errors behind fallback behavior or pretend a failed operation succeeded.
2. Fix root causes. Do not accumulate one-off patches around a defect.
3. Make failures observable. Critical host, IPC, persistence, updater, and renderer failures must leave useful structured logs.
4. Design for traceability. Important process starts, protocol failures, state transitions, and destructive operations must be diagnosable.
5. Keep this file current whenever the product direction, runtime architecture, or release workflow changes.
6. Protect the mainline. Create a dedicated branch before broad refactors or experimental work.

## Product direction

- Ousia Electron is again the primary maintained product. Active Electron development continues from `codex/archive-ousia-electron-v0.1.32`; the branch name is historical and no longer means the code is read-only.
- Pi Tauri is frozen at `v0.2.6` on `main` except for explicit compatibility, security, or release-transition work.
- Future Electron tags use the standard `v...` form. Future Tauri tags, if any, must use `tauri-v...`, so only Tauri carries a product prefix. Existing `electron-v...` releases remain supported for upgrade compatibility.
- The next Electron release becomes GitHub Latest. Tauri downloads remain pinned to `v0.2.6`. Before changing Latest, preserve a valid transition path for installed Tauri builds whose updater still reads `/releases/latest/download/latest.json`.
- Preserve Ousia's existing product identity, bundle identifier, application data, sessions, and upgrade paths unless a migration is explicitly designed and tested.

## Architecture source of truth

- Renderer: React 19 + TypeScript + Vite under `src/`.
- Desktop host and preload: Electron under `src/electron/`.
- Packaging: Electron Forge plus the scripts in `scripts/`.
- The preload bridge is the renderer trust boundary. Keep context isolation and validate IPC inputs in the host.
- Pi and Codex integrations are explicit agent providers. Do not silently route a failed provider to another provider.
- The main process owns sequenced replay snapshots for active chat streams. Renderer reloads must subscribe before replay hydration, then reconcile provider history when a run finishes.
- Pi history reads must use the active `SessionManager` branch while a session is running; the on-disk JSONL file is not authoritative until Pi flushes the turn.
- Persistence and session deletion must remain atomic, observable, and covered by tests.
- Runtime and Sentry diagnostics must not log prompt, response, tool payload, credential, or private file content.

## Required validation

Run these before handing off a functional change:

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

For release or packaging changes, also run the relevant signed/notarized macOS release workflow and verify the produced application and installer with Apple tooling before publishing.
