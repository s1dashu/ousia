# Runtime Extensions

Runtime extensions are user-writable packages loaded into Ousia without changing
the app source. An extension is a small app package: it has a React frontend
entry today and can later add a Node backend entry for local host APIs.

## Location

Ousia scans one global extension directory:

- `~/.ousia/extensions`

Older extension package formats are not loaded.

Runtime extensions are global and reusable across all projects. Project awareness
belongs to the agent/session context and to host APIs such as editor and
terminal cwd; extension packages themselves are not project-scoped.

## Package Shape

Simple UI-only extension:

```text
~/.ousia/extensions/my-extension/
  package.json
  App.tsx
```

Use `App.tsx` as the default frontend entry. This is the most familiar React and
Vite convention for agent-authored apps. `Page.tsx` is more strongly associated
with routed frameworks such as Next.js, so avoid it for Ousia extension roots.

`package.json` is both the npm package manifest and the Ousia extension manifest.
Ousia-specific metadata lives under the `ousia` field:

```json
{
  "name": "my-extension",
  "version": "0.1.0",
  "ousia": {
    "app": {
      "title": "My Extension",
      "slot": "workspace.tab",
      "entry": "App.tsx"
    }
  }
}
```

`entry` is relative to the extension root. It does not need to live under `src/`.
For small extensions, prefer `App.tsx` at the root. Larger extensions can use
`src/App.tsx` if they want a more conventional project layout.

## Full-Stack Shape

The intended full-stack shape keeps the same manifest and adds an optional
backend entry:

```text
~/.ousia/extensions/lark-tools/
  package.json
  App.tsx
  backend.ts
```

```json
{
  "name": "lark-tools",
  "version": "0.1.0",
  "ousia": {
    "app": {
      "title": "Lark Tools",
      "slot": "workspace.tab",
      "entry": "App.tsx"
    },
    "backend": {
      "entry": "backend.ts",
      "runtime": "node"
    },
    "permissions": ["command:lark-cli"]
  }
}
```

The backend manifest is documented now, but the separate Node extension host and
`window.ousia.extensions.invoke(...)` bridge are not implemented yet.

## Frontend Contract

- Only `workspace.tab` is supported.
- Runtime extension frontend apps loaded from `~/.ousia/extensions` are
  `user-local` distribution extensions with `local-user` trust. They are created
  or installed by the user/agent on the local machine, and are not a sandbox for
  arbitrary third-party marketplace code.
- Runtime extensions may omit `ousia.app.distribution` or set it to
  `user-local`. Other distribution values are rejected.
- Ousia uses an install-as-trust extension model. Distribution and trust labels
  describe origin and product experience, not runtime permission boundaries.
- Frontend entry source can be `.tsx` or `.ts`.
- The entry must export a React component as `default` or named `App`.
- Frontend entries are bundled with esbuild, so relative imports inside the
  extension directory are supported.
- Runtime extensions can import `react`; other package imports are not exposed
  yet.
- Type-only imports are erased during compilation.
- Styling should be plain CSS, usually in a scoped `<style>` tag inside the
  component.
- Do not rely on Tailwind utilities for layout or visual styling. Runtime
  extension files do not update Tailwind's generated CSS, so new, arbitrary,
  responsive, or dynamic utility classes may silently render unstyled.
- Runtime extensions are mounted edge-to-edge in the workspace tab. The root
  element should set `width: 100%` and `min-height: 100%`, with no outside
  margin, outer wrapper card, or artificial gap from the host frame.
- Scope CSS selectors with an extension-specific root class, and use Ousia theme
  variables such as `--background`, `--foreground`, `--card`,
  `--card-foreground`, `--muted-foreground`, `--border`, `--primary`, and
  `--radius`.
- Runtime extensions receive `context.theme.preference` (`light`, `dark`, or
  `system`) and `context.theme.resolved` (`light` or `dark`). Use the resolved
  value when a third-party component needs an explicit theme prop; otherwise
  prefer CSS variables so the extension changes automatically with the host.

## Agent Awareness And Control

Runtime extensions should be authored as agent-visible surfaces. Even when an
extension is primarily visual, it should publish compact structured context for
the agent: current resource, route/view, selection, dirty state, active tool,
visible errors, and recent user operations. This is more important than exposing
a large manual feature set.

Extensions should also expose a small action map for operations the agent may
perform while the user observes the workspace tab. Good actions are explicit and
domain-shaped, for example `openFile`, `selectRange`, `scrollTo`, `setField`,
`applyCommand`, `save`, `export`, `undo`, and `focusObject`. Avoid exposing
opaque "run arbitrary script" actions as the main control surface.

The future runtime API should let an extension do the following from its frontend
entry:

```ts
context.host.publishContext({
  resource: { kind: "file", path: "design.svg" },
  view: { mode: "edit", zoom: 1 },
  selection: { objectIds: ["rect-12"] },
  dirty: true,
})

context.host.registerActions({
  async focusObject({ objectId }) {
    // Move the visible editor selection to the requested object.
  },
  async exportPng({ path }) {
    // Export the current visual artifact to a project file.
  },
})

context.host.emitUserActivity({
  type: "selection.changed",
  summary: "Selected rectangle rect-12",
})
```

The exact API is not implemented yet. Until it exists, first-party and runtime
extensions should keep internal state easy to summarize and avoid designs that
only expose important state through pixels or private component internals.

## Refresh

Ousia watches `~/.ousia/extensions` while the app is open. Creating, editing, or
removing extension files triggers an automatic workspace refresh.

Compile and load errors appear as workspace tabs so the agent can see what needs
fixing.
