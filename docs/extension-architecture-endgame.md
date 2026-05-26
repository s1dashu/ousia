# Extension Architecture Endgame

## Positioning

Ousia's extension architecture should not converge on a traditional plugin
marketplace, a VS Code clone, or a suite of embedded productivity apps. Its
endgame is an agent-native desktop workbench:

- The agent is the primary operator.
- Extensions are observable, structured, and interruptible work surfaces around
  that agent.
- Humans use extensions to inspect, audit, preview, compare, and lightly
  intervene in the agent's work.

The product boundary is therefore: deep automation belongs in the agent or host
capability layer; visual confirmation, lightweight correction, and
domain-specific inspection belong in extensions.

## Product Bet

Chat alone is too narrow for complex desktop work. Real workflows involve files,
web pages, terminal state, PDFs, spreadsheets, diagrams, generated artifacts,
selections, errors, and partially completed edits. Extensions give those
materials a visible surface, but their purpose is not to become a second manual
application layer that competes with the agent.

The strongest version of Ousia is a client where the user can ask for an
outcome, the agent chooses or creates the needed surfaces, work appears in those
surfaces while it happens, and the user can correct or interrupt the process
without leaving the agent-led workflow.

## Endgame Shape

Ousia should evolve around three layers:

1. Agent core: the agent understands projects, sessions, files, commands, web
   state, generated artifacts, and extension state. It owns long-running work
   and cross-surface orchestration.
2. Observable surfaces: Browser, Editor, Terminal, PDF, Sheets, Excalidraw,
   and user-authored extensions are workspace surfaces for
   showing and shaping work.
3. Extension protocol: every serious extension exposes structured context and a
   small action map, so the agent can perceive and operate the surface while the
   user watches.

The desired loop is:

1. The user asks the agent for an outcome.
2. The agent opens, selects, or creates the right extension surface.
3. The extension publishes the relevant resource, view, selection, dirty state,
   visible errors, and recent user activity.
4. The agent invokes documented extension actions when visual work is needed.
5. The user can inspect, correct, interrupt, or continue from the visible
   surface.
6. The agent incorporates the updated context and keeps working.

## Core Principles

### Every Surface Is Agent-Visible

An Ousia extension should publish compact structured context. Important state
must not live only in pixels, private React state, or hidden component internals.

Useful context includes active tab state, opened resource, route or mode, scroll
position, zoom, selected text or object, focused field, dirty state, visible
errors, busy state, and recent meaningful user operations.

### Every Important Operation Is Agent-Callable

The key operations a user would expect the agent to perform should be exposed as
explicit actions with structured arguments. Good actions are domain-shaped and
observable: open, select, scroll, search, set field, apply command, save, export,
undo, redo, focus object, and close.

Avoid making opaque arbitrary script execution the primary control surface. The
agent should call actions the user can understand and the extension can
validate.

### Agent-Facing Instructions Stay Discoverable

Agent-facing extension usage should live with the extension action surface. The
agent should list extensions, call each extension's `help` action before use,
and only invoke documented actions.

Do not grow the agent's global prompt with extension-specific command details.
When an action changes, update that extension's `help` output first.

### Extensions Are Observable By Default

Agent-invoked extension actions should be visible in the workspace whenever
practical. The user should be able to see what changed, understand where the
agent is operating, and intervene through normal UI.

Destructive, externally visible, or hard-to-reverse actions should have an
explicit confirmation policy even for trusted extensions.

### Privileged Capability Stays In The Host

Extension does not mean unprivileged runtime code, and distribution labels are
not a security sandbox. Filesystem access, PTY sessions, webview policy, OAuth,
system integration, and other privileged effects should remain behind Electron
main process host APIs.

Runtime extensions can provide frontend surfaces and later optional backends,
but privileged host work should be explicit, scoped, and routed through Ousia's
controlled IPC or CLI bridge.

### Manual UI Is For Correction, Not Full Replacement

Ousia should avoid rebuilding complete professional applications inside the
workspace. Extension UI should provide enough manual control for quick
inspection and correction, while the agent remains the main path for substantial
work.

This keeps first-party extension scope focused: open artifacts, inspect state,
make small corrections, expose actions, save or export, and report context back
to the agent.

### User-Local Authoring Comes Before Marketplace

The first ecosystem to prove is local extension authoring by the agent and user.
The high-leverage flow is asking the agent to create a purpose-built extension
under `~/.ousia/extensions`, seeing it compile into the workspace, and using it
immediately.

A community marketplace can come later. Starting with marketplace dynamics too
early would pull the architecture toward installation, moderation, and
third-party distribution before the agent-extension loop is proven.

## Product Risks

The main risk is product boundary drift. If extensions become full manual apps,
Ousia will inherit the maintenance burden of a productivity suite while losing
the clarity of an agent-native client.

Specific risks to watch:

- Adding more surface area without context and action contracts.
- Treating extension count as product progress before agent-visible control is
  reliable.
- Moving privileged behavior into runtime extension code.
- Promising sandbox semantics that the current install-as-trust model does not
  provide.
- Encoding extension-specific behavior in the agent prompt instead of extension
  `help`.
- Building rich manual workflows that bypass the agent rather than improving
  agent-human collaboration.

## Near-Term Architectural Priority

Before adding many more first-party extensions, Ousia should complete the
minimal agent-extension contract:

1. Track mounted extension instances, active state, and last published context.
2. Add `publishContext`, `registerActions`, and `emitUserActivity` host
   callbacks.
3. Expose `ousia extension context` through the local CLI bridge.
4. Route `ousia extension invoke` through documented action handlers with
   structured results.
5. Add action visibility, confirmation, timeout, cancellation, and error-report
   policy.

After that contract is stable, new surfaces will compound the core product
advantage instead of only increasing the number of embedded tools.

## One-Sentence Strategy

Ousia should become an agent-native desktop workbench where extensions are not
mini apps competing with the agent, but structured, visible instruments the
agent can perceive and operate under the user's observation.
