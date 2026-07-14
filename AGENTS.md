# Pi engineering contract

## Non-negotiable engineering rules

1. Fail fast. Never hide errors behind fallback behavior or pretend a failed operation succeeded.
2. Fix root causes. Do not accumulate one-off patches around a defect.
3. Make failures observable. Critical host, RPC, persistence, and renderer failures must leave useful structured logs.
4. Design for traceability. Important process starts, protocol failures, state transitions, and destructive operations must be diagnosable.
5. Keep this file current. Update it in the same change whenever the product direction, runtime architecture, or critical workflow changes.
6. Protect the mainline. Create a dedicated branch before broad refactors or experimental work.

## Product direction

- This repository continues the Git history and GitHub location of Ousia, but the maintained product is now the standalone, lightweight Tauri application Pi. The final Electron state is preserved on `codex/archive-ousia-electron-v0.1.32`; Ousia is otherwise an upstream UI/UX reference only and must never be modified as part of Pi work.
- The user-facing product and packaged application name is `Pi`. Keep the internal `pi-gui` crate/package names, bundle identifier, data directories, log filename, environment variables, and existing PATH ownership marker stable for upgrade compatibility.
- Preserve Ousia's UI, interactions, copy, spacing, typography, and behavior except for intentional Pi deviations documented in this section. Limit other frontend changes to build fixes and the minimum host/runtime adaptation required by Tauri.
- Pi intentionally uses the system UI font only. Do not expose font-family settings or bundle alternate font files.
- The only agent harness is Pi. There is no Codex harness, provider switch, compatibility layer, or alternate-agent implementation.
- Messages sent while Pi is already running default to the follow-up queue. Users may explicitly switch the conversation behavior to steering. The queue floats above the conversation as a composer-owned overlay; queue growth must never resize the conversation viewport or change its scroll-follow state. The conversation bottom clearance must include the queue's measured overlap beyond its existing bottom padding so followed content remains actually visible rather than merely reaching the mathematical scroll maximum.
- Do not bundle Node.js, Pi, or a Pi SDK in the application package. Resolve and launch an external `pi` executable so the app shares the user's Pi configuration, credentials, models, extensions, and sessions.
- The application may optionally install Pi with the user's existing Node.js/npm into an application-owned prefix outside the `.app`. This managed installation must never modify the system npm prefix and uninstall must never remove the user's `~/.pi` data.
- A missing Pi executable is an on-demand onboarding state, not a startup chat error. Keep the empty chat neutral; when the user first tries to send, retain the draft and open the Pi install/select dialog.
- Pi configuration and credentials are read-only inputs. Do not add API-key mutation commands or create a second credential/configuration source in the application.
- Non-project sessions and the project folder picker default to `~/pi`. Non-project sessions snapshot their working directory when created, so later default changes cannot invalidate persisted Pi mappings. Pi's previous home-directory default and Ousia's historical `~/Documents/Ousia` and `~/.ousia/chat` defaults are migrated to `~/pi` on load and persisted before the Rust host resolves a chat context; existing sessions retain their original directory while new sessions use the migrated default.

## Architecture source of truth

- UI: React 19 + TypeScript + Vite, mirrored from Ousia under `src/`.
- Desktop host: Tauri 2 + Rust under `src-tauri/`.
- Compatibility boundary: `src/tauri/api.ts` implements the existing `window.ousia` UI contract with Tauri commands and events. Keeping the contract avoids UI/UX drift; it is not an Electron runtime.
- Agent boundary: the Rust host launches `pi --mode rpc` and exchanges strict line-delimited JSON over stdin/stdout.
- Pi discovery: `PI_GUI_PI_PATH` is the authoritative development/testing override; otherwise prefer a persisted explicitly selected or application-managed executable, then inspect the login-shell `PATH`, common installation locations, and the active npm global prefix. Every selected path must be a verified executable.
- Runtime ownership: `pi-runtime.json` in the Tauri application data directory is the source of truth for a managed Pi installation and optional shell integration. PATH integration may only own `~/.local/bin/pi` plus one exact marked block in `~/.zprofile` or `~/.bash_profile`; removal must validate the receipt before changing either file.
- Window chrome: the application shell is a normal full-size child of `#root`, not a viewport-fixed layer, so WKWebView live resize cannot expose a stale independently composited shell. The renderer measures the live sidebar-toggle center and viewport geometry; the Rust host maps that measurement through the native WKWebView frame and aligns the macOS traffic lights after layout, zoom, settled resize, and fullscreen changes. Renderer and native geometry must agree with the active page zoom before AppKit frames are mutated; transient mismatches are deferred, bounded, logged, and retried instead of applying stale measurements. Do not replace this measurement contract with a fixed traffic-light Y coordinate.
- Process ownership: Pi is a single-instance desktop application. A duplicate launch must focus the existing window instead of starting another host that could race the active host for the same Pi session files.
- Persistence: application UI state and Ousia-to-Pi session mappings are stored atomically in the Tauri application data directory. A mapping records whether Pi has materialized a resumable session file; an unfinished mapping must never be passed back to `pi --session`. Pi session content remains in the user's Pi data directory.
- Error policy: malformed RPC frames, unknown protocol events, invalid persistence, unavailable mapped sessions, and subprocess failures are fatal to the affected operation and are logged. Do not silently skip them.
- RPC lifecycle: `agent_end` ends one low-level run and may precede retry/compaction/continuation; `agent_settled` authoritatively ends the session-level run. Keep the old-Pi `agent_end` completion path explicit, delayed, and observable rather than conflating the two events.
- RPC streaming identity: assistant text and thinking block IDs include both the agent-run generation and Pi assistant-message boundary, because content indexes restart after tool execution. Stream tool-call input from `toolcall_start`/`toolcall_delta`/`toolcall_end`, then update the same stable Pi tool-call ID from `tool_execution_*`; never collapse tool-adjacent assistant messages or reorder them during persistence reconciliation. Preserve and forward the raw accumulated `toolcall_delta` text for live previews instead of relying on Pi's parsed partial argument object: model-generated JSON key order is not stable, and Ousia's write/edit previews must stream even when `content` arrives before `path`. Reset input scanning at each assistant-message boundary, keep completion sticky per stable tool-call ID, and log the completion source plus delta/byte counts without logging the payload.
- Tool history parity: lightweight persisted history retains Ousia-compatible, parseable tool-input summaries while omitting full payloads. When authoritative reconciliation confirms a just-streamed tool by its stable Pi tool-call ID, preserve the complete live payload so completion never changes the tool summary or disclosure behavior; lazily load full payloads only for history that was not already present live.
- Renderer stream performance: buffer high-frequency assistant text and complete tool-input snapshots to a bounded visual update cadence, coalescing only adjacent events whose protocol semantics preserve the complete accumulated payload. Keep text stream commits interruptible and flush lifecycle boundaries on the next animation frame. Commit the already bounded tool-input path at normal priority, cap live write/edit preview redraws independently from the lossless event buffer, and immediately flush input completion; low-priority React transitions must never leave a live preview stuck at its initial empty state. Keep the latest message eager while allowing WebKit to skip rendering offscreen historical messages only after each message's exact block size has been measured; fixed or generic intrinsic-size placeholders are forbidden because they destabilize conversation scroll geometry. Pierre diff syntax highlighting runs in one ES-module worker; never silently disable or fall back from that worker to main-thread highlighting. Worker failures must be persisted and stop the affected preview. Never trade away final content, event ordering, persistence reconciliation, or protocol errors for apparent smoothness.
- Response performance: start preparing the persisted selected session's RPC process as soon as application state is available, without waiting for model discovery; defer configuration until the selected model has been validated. Retain at most the selected idle client plus any actively streaming clients. Preparation is superseding: a newer selection cancels an older in-flight startup or configuration, while a newer preparation for the same session reuses its in-flight process; canceled preparation is logged as lifecycle information rather than surfaced as an operation failure. Start first-message title generation as soon as the primary prompt is accepted, concurrently on an isolated ephemeral RPC process; never reuse or reconfigure the active session client for title generation. Reuse an unchanged configuration and unchanged persisted session mapping, and preserve correlated timing logs from the renderer message ID through process readiness, preparation, configuration, prompt acceptance, first output, and full run completion.
- Conversation scrolling: observed upward `scrollTop` movement with unchanged scroll geometry is authoritative user intent even when wheel/touch capture is missed, except while an explicit programmatic latest-scroll correction remains unresolved; captured wheel/touch/pointer intent still cancels that correction immediately. A requested scroll target is never an observed geometry baseline: only the browser's actual `scrollTop` may update that baseline, and renderer work may keep the correction unresolved until streaming ends. Programmatic scrolling, history prepends, layout-anchor adjustments, and renderer-driven `scrollHeight`/`clientHeight` changes must update the full geometry baseline; never auto-restore the bottom against an unexplained move toward history, and never mistake a measured layout change for user intent. Nested write/edit preview scrolling remains isolated from the conversation follow state and follows its own streamed content to the bottom until an explicit upward wheel movement opts out. Because Pierre worker highlighting mutates shadow content after React layout effects, its busy-to-idle worker transition is the authoritative final-scroll correction signal.
- Runtime logs: JSONL at the platform Tauri log directory; on macOS, `~/Library/Logs/com.sidasoftware.pi-gui/pi-gui.log`. Logs rotate at 8 MiB. Renderer performance summaries and exceptional interaction-state transitions must cross the Tauri logging bridge with bounded structured metadata; console-only diagnostics are insufficient, and message/tool payload content must never be logged.
- macOS releases: `scripts/release-macos.sh` is the release build source of truth. It requires an explicit Developer ID identity and Apple notarization credentials, builds the `.app` and `.dmg`, waits for notarization and stapling, verifies both artifacts with Apple tooling, and emits a ZIP plus SHA-256 checksums. Never publish an artifact produced by bypassing those checks.

## Required validation

Run these before handing off a functional change:

```sh
npm run typecheck
npm run lint
cargo test --manifest-path src-tauri/Cargo.toml
npm run build
```

For desktop-host or packaging changes, also run:

```sh
npm run desktop:build -- --bundles app
```

For renderer or startup changes, launch the packaged app and visually verify the actual window. Inspect the runtime log for new frontend or RPC errors rather than treating a live process as proof of success.
