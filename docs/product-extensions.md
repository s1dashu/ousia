# Compile-time Product Extensions

Ousia is extracting a versioned public host boundary for downstream products.
The first package is `@ousia/extension-api` at `packages/extension-api`.
Ousia Desktop consumes the workspace package itself before any downstream
product is expected to consume a published release.

This is not the removed runtime-extension system. Product extensions are
selected by the application composition root at build time. Ousia does not scan
`~/.ousia/extensions`, load arbitrary user code, provide a marketplace, or
restore the old extension CLI.

## Current Public Package

`@ousia/extension-api` is React-, Electron-, Pi-, and Codex-independent. It
currently owns:

- strict `ProductIdentity` and `DesktopPathPolicy` snapshots;
- JSON-value and runtime-codec contracts;
- ordered provider-neutral Agent prompt manifests;
- provider-neutral Agent tool definitions, registries, and deterministic
  manifest revisions;
- Workspace App definitions, state/event codecs, registries, persisted state
  envelopes, live/history ingress, and non-persisted effects;
- the synchronous renderer capture handle required by close/reload barriers.

The package builds to `dist`; its npm exports never point at raw TypeScript.
The root npm workspace runs the package build before start, test, typecheck, and
packaging commands. `npm pack --dry-run --workspace @ousia/extension-api`
validates the publishable file set.

The package manifest uses public access under the `@ousia` scope. Publishing is
a separate release action and requires an npm organization/account that owns
that scope. Downstream products should pin an exact published version rather
than a branch, floating tag, or relative path outside their repository.

## Product Identity and Paths

Identity and desktop paths are separate contributions. A generic product does
not need to invent an asset protocol merely to name itself:

```ts
const identity = defineProductIdentity({
  id: "example",
  displayName: "Example",
})

const paths = defineDesktopPathPolicy({
  userDataDirectoryName: "example-desktop",
  runtimeLog: {
    homeDirectoryName: ".example",
    directoryName: "logs",
    fileName: "example-desktop.log",
  },
})
```

Definitions are validated, cloned, and frozen. Unknown keys, unsafe path
components, and late reconfiguration fail during bootstrap. Ousia's own
composition is `src/electron/ousia-product.ts`.

The desktop path policy contains only paths every extracted desktop host owns
today: Electron `userData` and the runtime log. Default-workspace and
project/session storage policies remain explicit application contributions
until their owners are extracted; advertising unused path fields would create a
false source of truth.

## Agent Contributions

Product Agent instructions are ordered prompt sections. The Pi adapter must
append the rendered product prompt through its supported system-prompt
contribution; the Codex adapter must supply the same rendered prompt as stable
`developerInstructions` without replacing Codex base instructions.

### Tools

One provider-neutral registry is the intended source of truth for a product's
tool name, label, description, JSON Schema, strict input codec, execution mode,
prompt metadata, executor, and result content. Duplicate and unknown tools are
hard errors. The manifest revision is derived from canonical, name-sorted
Codex-visible tool specs; changing a name, description, or input schema changes
the revision even if a caller forgets to bump a version string. An optional
compatibility version can additionally invalidate threads for executor behavior
changes.

Pi and Codex adapters belong to the host layer, not to a product tool. Codex
products that require custom tools must explicitly enable App Server's
experimental API and expose the same registry through `thread/start`
`dynamicTools`. A Codex session must persist the manifest revision bound to its
thread; resume with a different required revision must fail because the current
protocol does not accept replacement dynamic tools on `thread/resume`.

## Workspace Apps

The generic persisted envelope is:

```ts
type StoredWorkspaceApp = {
  instanceId: string
  appId: string
  stateVersion: number
  state: JsonValue
}
```

The registry rejects duplicate or unknown apps, and decoding rejects unknown
state versions or malformed state. A reducer receives explicit `live` or
`history` ingress and returns both persisted state and ephemeral effects. Focus,
selection, notifications, and similar renderer behavior belong in effects; they
must not be smuggled into persisted state just to trigger UI work.

The hot-path reducer does not serialize or deep-clone the complete state after
every ingress batch. State codecs run at creation, decode, committed capture,
and persistence boundaries; this keeps a large canvas from paying an O(board)
JSON clone for each animation-frame batch while still making invalid persisted
state a hard error.

Before a close/reload snapshot, a mounted renderer synchronously calls
`captureCommittedState()` and returns one merged canonical state. The host must
not dispatch several independent flush updates that can overwrite one another.

Ousia does not ship a WorkspaceHost UI yet. Future `@ousia/desktop-host` and
`@ousia/desktop-ui` packages will own scope/tombstone/persistence orchestration
and the right-panel shell. Product renderers and their codecs stay downstream.
For example, Miki's canvas, `miki-asset` protocol, visible-file policy, preview
cache, canvas events, and canvas dependencies do not belong in Ousia core.
