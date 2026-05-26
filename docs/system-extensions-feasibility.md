# Extension Levels

## Decision

Every workspace surface should be represented as an extension. Browser, Editor,
and Terminal are first-party preinstalled extensions.

This is feasible without turning them into runtime packages under
`~/.ousia/extensions`. A first-party preinstalled extension is a bundled extension
definition with the same workspace app contract as a runtime extension:

- stable `id`
- `title`
- `slot: "workspace.tab"`
- React app entry/component
- distribution level
- trust marker

All extension levels can therefore share workspace tab selection, restoration,
launcher rendering, error handling, and future extension authoring guidance.

## Levels

Ousia uses four distribution levels:

- `first-party-preinstalled`: produced by Ousia, packaged with the app, and visible by
  default. Current examples: Browser, Editor, Terminal.
- `first-party-optional`: produced by Ousia but not preinstalled. Users can
  choose to install it later.
- `community`: produced outside Ousia and installed by the user from a community
  source.
- `user-local`: created or modified locally by the user or by the agent under
  `~/.ousia/extensions`.

Distribution is separate from implementation kind. A bundled extension ships in
the app bundle; a runtime extension is loaded from disk. Distribution and trust
are origin and product-experience labels, not runtime permission boundaries.
Ousia uses an install-as-trust model: installed extensions are trusted local
code within the host APIs Ousia exposes.

## Important Distinction

Extension does not mean unprivileged runtime code.

The Browser, Editor, and Terminal frontends can be mounted like extensions, but
their privileged work must stay in Electron main:

- Browser: `<webview>` enablement, preference stripping, external URL policy,
  WebAuthn account selection, and browser session configuration.
- Editor: project-scoped file listing, file reading, file saving, traversal
  rejection, ignored directories, and file size limits.
- Terminal: PTY creation, cwd scoping, input forwarding, resize, disposal, and
  process cleanup.

Privileged host work remains in Electron main and is exposed through explicit
host APIs such as project file IPC, PTY IPC, and browser webview setup.

## Suggested Shape

```ts
type ExtensionDefinition = {
  id: string
  title: string
  slot: "workspace.tab"
  kind: "bundled" | "runtime"
  distribution:
    | "first-party-preinstalled"
    | "first-party-optional"
    | "community"
    | "user-local"
  trust: "first-party" | "community" | "local-user"
  component: React.ComponentType<ExtensionProps>
}
```

Then the current bundled extensions map cleanly:

- Browser: `kind: "bundled"`, `distribution: "first-party-preinstalled"`,
  `trust: "first-party"`
- Editor: `kind: "bundled"`, `distribution: "first-party-preinstalled"`,
  `trust: "first-party"`
- Terminal: `kind: "bundled"`, `distribution: "first-party-preinstalled"`,
  `trust: "first-party"`
- User-local runtime extensions: `kind: "runtime"`,
  `distribution: "user-local"`, `trust: "local-user"`

## Migration Path

1. Rename the remaining implementation types to `ExtensionDefinition` once the
   source tree naming has moved to extension terminology.
2. Keep `distribution` and `trust` metadata on every definition.
3. Keep current Browser/Editor/Terminal React implementations as bundled app
   entries.
4. Make the workspace registry return one unified list of bundled and runtime
   extension definitions.

## Risks

- Calling everything an extension can blur the security model. Keep
  `distribution` and `trust` visible in the model.
- Do not imply a permission sandbox where none exists. Distribution and trust
  labels identify source and install experience only.
- Do not move Browser/Editor/Terminal privileged logic into runtime extension
  code. That would weaken the current process model.
