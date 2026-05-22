# Product Context

## Product Shape

Ousia is a programmable desktop agent client. The core product bet is that the app itself is extension-native: native UI surfaces are assembled from React surfaces, and users can ask an agent to create or modify runtime extensions during normal use.

The intended first version is not a marketplace ecosystem. It is live extension authoring inside a desktop agent client.

## MVP Scope

Current MVP scope:

- Three-column desktop shell: sidebar, chat area, workspace.
- Project list in sidebar.
- Session list under each project.
- Real chat with pi coding agent.
- pi tools available through the agent: read, write, edit, bash, grep, find, ls.
- Workspace tabs as the first customizable extension surface.
- Project-aware agent cwd: selected project path becomes the agent work dir.
- User-configurable default work dir, defaulting to `~/Desktop`.

Deferred scope:

- Full extension host.
- Plugin marketplace.
- Sandboxed third-party extension execution.
- Native extension packaging/distribution.
- First-party optional extension install flow.
- Community extension install flow.
- AI-generated session titles.
- Deep settings for all model/provider/runtime parameters.

## Product Principles

- Runtime extension frontends are React apps.
- Extensions should use familiar React/Vite conventions, with minimal custom protocol for agents to learn.
- The app's own native interface should also be composed from replaceable React surfaces.
- Users should be able to replace native surfaces over time, but the MVP starts with workspace extensions.
- The workspace should remain open and free-form, not forced into a review/code-only surface.
- Extension distribution levels are explicit: first-party bundled,
  first-party optional, community, and user-local.

## Current User-Facing Concepts

- Project: a local directory the agent can work inside.
- Session: a conversation under a project.
- Workspace: right-side open surface for extensions and system surfaces such as browser, editor, terminal, and custom apps.
- Default work dir: initial directory used to create the default project, currently `~/Desktop`.
