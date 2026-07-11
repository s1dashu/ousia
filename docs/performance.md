# Performance Architecture and Roadmap

This document is the performance baseline and optimization record for Ousia
Desktop. Performance work must preserve the existing product behavior, visual
design, provider boundaries, and canonical Electron-main app state.

## Optimization Roadmap

The first complete optimization pass follows these stages:

1. **Measure and locate hot paths**: production renderer/main builds, package
   size, test baseline, runtime logs, and React/Electron data flow.
2. **Protect renderer boundaries**: keep sidebar, settings, chat, and stable
   Markdown messages from rerendering for unrelated streaming state.
3. **Reduce streaming work**: coalesce adjacent text deltas without changing
   event order, and update chat history with copy-on-write tail-first lookup.
4. **Shorten startup**: create the first window without synchronously waiting
   for shell hydration or parsing the Pi runtime; load provider code only when
   its capability is requested.
5. **Remove repeated I/O and scans**: cache canonical app state, Pi session file
   discovery, parsed histories, and the runtime log descriptor while preserving
   explicit invalidation and error propagation.
6. **Reduce build/package overhead**: import only used HugeIcons and deduplicate
   shared Pi dependencies in the main-process bundle.
7. **Verify and observe**: full tests, coverage, typecheck, lint, production
   package, packaged-app UI smoke testing, and structured startup timing logs.

The stages above are implemented in version `0.1.17`. Future performance work
should begin by repeating the same measurements rather than assuming that a
previous bottleneck is still dominant.

## Measured Baseline and Result

Measurements were taken on 2026-07-10 with the same local production toolchain.
Sizes are uncompressed filesystem sizes and are intentionally approximate where
the build emits content-hashed filenames.

| Metric                             |      Before |       After | Change |
| ---------------------------------- | ----------: | ----------: | -----: |
| HugeIcons/Vite transformed modules |       6,919 |       1,490 | -78.5% |
| Renderer build wall time           |      5.28 s |      4.19 s | -20.6% |
| Renderer build peak RSS            |    1.313 GB |    0.950 GB | -27.7% |
| Main entry chunk                   |     ~5.1 MB |    74,141 B | -98.5% |
| Complete main build                |    ~8.23 MB |     ~6.4 MB |  ~-22% |
| Renderer initial JavaScript        | 1,163,776 B | 1,166,873 B |  +0.3% |
| Packaged `.app`                    |     ~653 MB |     ~650 MB | ~-0.5% |

After moving Codex `0.144.0` to its integrity-verified first-use download, the
arm64 macOS 0.1.22 build measures approximately 345 MB unpacked and 153 MB as a
local DMG. The preceding table remains the historical rendering-optimization
baseline rather than a current package-size baseline.

The renderer entry size is effectively unchanged; the icon change improves the
module graph, build time, and build memory rather than hiding code in another
initial chunk. This historical baseline predates the on-demand Codex runtime:
packaged builds now exclude the native platform archive and download the pinned,
integrity-verified runtime only on first Codex use.

## Implemented Runtime Changes

### Renderer

- `App` passes stable callbacks and memoized provider/model data into memoized
  sidebar, chat, and settings surfaces. Streaming one session no longer causes
  unrelated shell surfaces or a background session to rerender.
- Chat event reduction uses tail-first lookup, lazy item/array copies, and
  reference-preserving no-op returns. Long histories avoid cloning on events
  that do not change their state.
- Static Streamdown options and timestamp formatting are shared instead of
  recreated for every message render.
- Chat-history failures receive one bounded delayed retry instead of creating
  an unbounded IPC loop. After that, selecting another chat and returning, or
  reloading the app, explicitly starts a fresh retry budget.
- User messages are inserted locally in their final visual style before chat
  IPC. Providers do not echo successful user messages, removing both Codex
  model/thread RPC latency from perceived send latency and the second live write
  source. If initial history is already in flight, Electron main finishes that
  snapshot before starting the provider send; the bubble remains immediate
  while the snapshot fence prevents provider-local history ids from racing it.
- Tooltip pointer positioning snapshots DOM state before animation-frame work
  and cancels stale frames, eliminating the recurring detached-element error.

### Electron Main

- Shell-environment hydration is asynchronous and cached. It starts early but
  is awaited only at provider/model/environment boundaries, so a slow login
  shell cannot block the first window.
- Pi-heavy modules and provider sessions load on demand. The fast window-state
  read does not parse the Pi SDK before BrowserWindow creation.
- Initial retry-preference synchronization reads Pi's `settings.json` through
  a small validated reader after shell hydration. It no longer parses the
  5 MB Pi provider chunk just to obtain one boolean.
- Adjacent assistant/thinking deltas for the same item are batched for up to
  16 ms. Every non-delta event flushes pending text first, preserving observable
  ordering and final content.
- Canonical app-state snapshots are cached by state-file path and cloned at API
  boundaries. A new snapshot is published only after atomic persistence
  succeeds, and reference-identical durable no-ops skip disk writes. Electron's
  single-instance lock prevents competing processes from writing stale
  snapshots; a second launch focuses the existing window.
- Pi history reconstruction uses an id-to-index map instead of repeated linear
  searches. Parsed history is capped at 12 entries, session-file discovery at
  64 entries, and live Pi AgentSessions at 8 idle/LRU entries. Running sessions
  are never evicted. Deleting sessions or projects explicitly releases Pi and
  Codex runtime state; Pi release unsubscribes listeners before disposal.
- Codex model discovery deduplicates concurrent requests and reads account and
  model state in parallel.
- Runtime logging keeps one append descriptor open and rotates at 8 MiB on
  startup instead of performing directory/open/close work for every line.

## Observability

The runtime log at `~/.ousia/logs/ousia-desktop.log` records:

- `window.startup`: app-state, BrowserWindow, renderer-load, and total startup
  durations in milliseconds;
- shell-environment hydration duration and imported variable names (never
  values);
- renderer console errors, renderer process loss, failed loads, unresponsive
  windows, uncaught exceptions, and unhandled rejections.

This makes startup regressions and runtime failures traceable in packaged builds
without enabling DevTools.

One packaged `0.1.17` cold-start sample recorded 26.5 ms for app state,
128.2 ms for BrowserWindow creation, 143.5 ms for renderer loading, and
299.4 ms total through `did-finish-load`. Shell hydration took 258 ms in
parallel and did not block the window. This is a diagnostic sample from one
machine, not a cross-device percentile or a claim about first contentful paint.
A warm window recreation after closing the macOS window took 148.4 ms.

## Correctness Guardrails

- Delta batching must preserve order across tool, terminal, completion, and
  error events.
- App-state cache publication must happen only after the atomic rename succeeds.
- Provider/runtime caches must remain bounded and have explicit invalidation or
  disposal paths.
- A running provider session must never be selected for LRU eviction; temporary
  overflow is allowed until a session becomes idle.
- Renderer memoization must use stable callbacks that see the latest committed
  state; stale closures are not an acceptable optimization.
- Optimistic user messages and provider failure events must share one validated
  message id. Content conflicts for the same id are protocol errors; text/time
  heuristics are not a valid deduplication strategy.
- Performance work must not change CSS tokens, layout, interaction semantics,
  provider selection, sandbox/cwd validation, or persistence ownership.

## Verification

Required checks for this pass and future changes:

```bash
npm run typecheck
npm run lint
npm test
npm run test:coverage
npm run package
```

Also launch the packaged app, inspect chat and settings, exercise a floating
surface, and check the runtime log for new uncaught renderer/main errors.

The `0.1.17` pass completed 27 test files / 206 tests, coverage of 89.79%
statements, 82.33% branches, 94.75% functions, and 89.62% lines, plus clean
typecheck, lint, production packaging, chat/settings/floating-surface visual
smoke tests, single-instance focus, and macOS close-then-relaunch window
recreation. The final packaged run produced no new warnings or errors.

Chrome DevTools trace collection was unavailable in the current tool session,
so this pass does not claim Core Web Vitals or interaction-percentile results.
The local build, package, tests, structured startup timings, and packaged-app
smoke test are the evidence for this pass. A future pass with a DevTools trace
should add repeatable cold-start and long-stream interaction benchmarks here.
