# Product Context

## Product Shape

Ousia is a programmable desktop agent client. The core product bet is that the app itself is extension-native: native UI surfaces are assembled from React surfaces, and users can ask an agent to create or modify runtime extensions during normal use.

The intended first version is not a marketplace ecosystem. It is live extension authoring inside a desktop agent client.

## Core Blueprint

Ousia is an agent client whose soul is a powerful, flexible agent paired with a
rich extension ecosystem. The agent is the primary worker: it should complete the
majority of the user's work across projects, files, commands, browser state, and
generated artifacts. Extensions are the user's observable workbench around that
agent.

Extensions are not meant to become a second set of full manual applications that
compete with the agent. Their default role is to help the human user inspect,
audit, preview, compare, and lightly intervene in the agent's work. A PDF editor,
spreadsheet surface, SVG editor, browser, terminal, or custom GUI can expose
manual controls, but those controls should stay lightweight and targeted so the
agent remains the main path for doing substantial work.

The intended agent-extension relationship:

- Agent does most of the work and owns long-running execution.
- Extensions make work visible, reviewable, and interruptible by the user.
- Extensions expose enough manual control for quick human correction.
- Extensions publish structured context that the agent can fully perceive:
  active page/tab, opened file or resource, selected object/text/range, cursor or
  viewport position, unsaved edits, mode/tool, recent user operations, errors,
  and domain-specific state.
- Extensions expose common operations as agent-callable actions, so the agent
  can drive the UI while the user watches: open, select, scroll, navigate,
  filter, edit field, apply command, export, save, undo, and domain-specific
  transforms.

This gives Ousia a clear product boundary: the agent is the operator, extensions
are transparent instruments and review surfaces. When a workflow needs deep
automation, implement it in the agent or host capability layer; when a workflow
needs visual confirmation, lightweight steering, or domain-specific inspection,
surface it as an extension.

## MVP Scope

Current MVP scope:

- Three-column desktop shell: sidebar, chat area, workspace.
- Session list in sidebar.
- Project list below sessions in sidebar.
- Real chat with pi coding agent.
- pi tools available through the agent: read, write, edit, bash, grep, find, ls.
- Workspace tabs as the first customizable extension surface.
- Session-aware agent cwd: unassigned sessions use the default work dir; project
  sessions use their selected project path.
- User-configurable default work dir, defaulting to `~/Ousia`.

Deferred scope:

- Full extension host.
- Plugin marketplace.
- Sandboxed third-party extension execution.
- Native extension packaging/distribution.
- First-party optional extension install flow.
- Community extension install flow.
- Deep settings for all model/provider/runtime parameters.

## Product Principles

- Runtime extension frontends are React apps.
- Extensions should use familiar React/Vite conventions, with minimal custom protocol for agents to learn.
- The app's own native interface should also be composed from replaceable React surfaces.
- Users should be able to replace native surfaces over time, but the MVP starts with workspace extensions.
- The workspace should remain open and free-form, not forced into a review/code-only surface.
- Extension distribution levels are explicit: first-party preinstalled,
  first-party optional, community, and user-local.
- Prefer agent-first workflows: add extension UI when humans need visibility,
  auditability, quick intervention, or a specialized visual surface.
- Extension state and user actions should be representable as structured context,
  not only as pixels.
- Extension actions should be narrow, inspectable, and reversible where possible,
  because they are meant to be invoked while the user can observe the surface.

## Current User-Facing Concepts

- Project: a local directory the agent can work inside.
- Session: a conversation that may be unassigned or associated with a project.
- Top-level sessions are unassigned and run in the default work dir.
- Creating a project creates/selects a default session under that project; the
  project row itself only expands or collapses its session list.
- Workspace: right-side open surface for extensions and system surfaces such as browser, editor, terminal, and custom apps.
- Default work dir: directory used by unassigned sessions, currently `~/Ousia`.
