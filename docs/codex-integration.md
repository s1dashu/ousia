# Codex Provider Integration

Ousia integrates Codex through the official `codex app-server` protocol. The
App Server is the interface intended for rich clients; `codex exec` and the
TypeScript SDK are optimized for non-interactive automation and do not expose
the same authentication, history, approval, delta-streaming, or structured
interrupt surface.

Primary references:

- [Official App Server guide](https://developers.openai.com/codex/app-server/)
- [Official Codex harness architecture](https://openai.com/index/unlocking-the-codex-harness/)
- [App Server protocol README](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)
- [Official TypeScript SDK](https://github.com/openai/codex/tree/main/sdk/typescript)

Community implementations reviewed:

- [Harnss](https://github.com/OpenSource03/harnss) is an MIT-licensed
  Electron/React multi-agent client. Its Codex transport is useful evidence
  that a desktop client can own App Server lifecycle and adapt protocol events
  behind a renderer-safe boundary.
- [Paseo](https://github.com/getpaseo/paseo) also models Codex as a provider
  transport. It is AGPL-licensed, so Ousia used it only as an architectural
  comparison and did not copy implementation code.

Both community examples reinforce the same boundary as the official guide:
keep Codex transport, credentials, thread identity, and approvals outside the
renderer. Ousia's implementation is based on the official protocol and its own
typed IPC/event model.

## Runtime Boundary

- Electron main owns one long-running downloaded `codex app-server --stdio`
  process. Renderer code only sees Ousia's typed preload IPC.
- Before any request reaches Codex, Electron main resolves the session's cwd
  from canonical app state and rejects a mismatched renderer path. That same
  canonical path defines `workspaceWrite.writableRoots`.
- `@openai/codex` is pinned to `0.144.0`, but Electron Forge excludes its native
  platform package. On first Codex use, Electron main downloads the exact
  platform archive from the official npm registry, verifies the pinned SHA-512
  integrity before extraction, and atomically caches it under the Ousia
  user-data directory. Concurrent callers share one installation promise;
  download, verification, extraction, and startup failures are logged and
  returned without falling back to a system Codex installation.
- The client sends `initialize`, then `initialized`, with
  `experimentalApi: false` and `requestAttestation: false`.
- Stdout is newline-delimited JSON RPC. Request ids, notifications, and
  server-to-client requests are routed separately. Stderr and lifecycle errors
  go to `~/.ousia/logs/ousia-desktop.log` without prompts, credentials, tokens,
  or full RPC payloads.

## Session Identity

`OusiaSessionRecord.agentProvider` is fixed when the session is created. The
global default only affects future sessions.

- Pi maps the Ousia session id to its own session id.
- Codex returns an opaque thread id from `thread/start`. Electron main binds it
  atomically to `agentThreadId`; resume, history, branch, compact, and interrupt
  use that id.

Do not infer Codex ids, parse files under `~/.codex/sessions`, or switch an
existing conversation between providers.

## Models and Reasoning Effort

Ousia obtains Codex models through `model/list`. For each model, it preserves
the server-provided `supportedReasoningEfforts`, descriptions, and
`defaultReasoningEffort`. The renderer follows that model default until the user
chooses a supported Codex preference.

Codex reasoning effort is an open protocol string, not Pi's fixed thinking
level enum. The provider must preserve new non-empty values returned by App
Server, show them without silently dropping them, and reject malformed model
metadata or an unsupported selection at the main-process boundary. Pi thinking
level and Codex reasoning effort are persisted separately so switching agent
providers or models cannot overwrite the other provider's preference.

## Safety and Authentication

Until Ousia has an approval UI, Codex threads use:

```text
approvalPolicy = never
sandbox = workspace-write (standard) | read-only (read-only mode)
```

Unexpected approval requests are declined and logged. Ousia never auto-accepts
them. The Pi-only `noTerminal` and `custom` tool modes have no exact Codex
enforcement equivalent: the renderer uses `standard` while a Codex session is
selected, and the main-process adapter still rejects either unsupported value
if one reaches the provider boundary.

Authentication uses `account/read`, `account/login/start`, and
`account/logout`. Codex owns credential storage and refresh. Ousia opens the
returned ChatGPT login URL but never reads or writes Codex's auth file.

## Messages During an Active Turn

Every renderer submission declares how Electron main should handle it if a
Codex turn is active: `steer` maps to App Server `turn/steer`, while the queue
mode maps to Ousia's `followUp` queue. This declaration is sent even when the
renderer currently believes the session is idle. Electron main is the source
of truth for active-turn state, so delayed or missed renderer status events
cannot turn a valid queue or steer action into a conflicting normal start.

This behavior was backported from Miki commit
`312513dac6cdf7b8407d8ed0da2362d7f2c99b84`.

## Protocol Upgrade Workflow

The App Server command and wire protocol can evolve. Before changing the pinned
Codex version:

1. Download the new pinned platform binary and run
   `codex app-server generate-ts --out <temp-dir>`.
2. Compare every method and field used by the client/provider adapter.
3. Update fixture contract tests.
4. Run typecheck, lint, unit tests, and a real app-server smoke test.
5. Update every platform archive URL/integrity in the runtime manifest, bump the
   Ousia app version, package the app, verify no Codex native package is embedded,
   and test first-use download plus app-server launch from the packaged `.app`.
