# Design Context

## Visual Direction

The current UI should feel closer to Codex desktop in density and seriousness, but not copy Codex exactly.

The app uses a shadcn preset as the visual base. The user explicitly asked not to keep the earlier Pie-client styling. The light color theme uses a warm tea/coffee neutral palette inspired by Radix Sand, but pushed warmer than stock Sand so bubbles and controls do not read as cold gray.
`Cloud Tea` is an additional experimental light neutral option based on sampled
reference colors `#eee6df` and `#f3f2ee`.

Light mode uses pure white for primary work canvases: chat, workspace, settings,
and other main detail surfaces. `background`, `card`, `popover`, `muted`, and
sidebar tokens intentionally use slightly different warm neutral lightness
values for secondary surfaces, controls, message bubbles, active states, borders,
and nested UI. The selected Radix-style color scale should tint those supporting
layers without washing the main reading/work areas.

Generated shadcn/ui reference files live under `ref/`; see `docs/shadcn-reference.md`. Before changing shared UI primitives in `src/components/ui/`, compare against the reference component so state styles, menu padding, focus rings, and radius choices stay intentional.

## Icon Policy

Ousia intentionally uses two primary icon families:

- Hugeicons: use for ordinary, quiet, utility-style UI controls that should feel
  familiar and not visually loud, such as sidebar project/session actions,
  settings, attach/send controls, collapse controls, search, delete, rename, and
  similar tool actions.
- Solar icons: use for areas that need stronger expression or heavier visual
  identity, especially workspace extension/tab signals such as Browser, Editor,
  Terminal, Extensions, and other major navigation-level icons.

Avoid adding new icon families for routine UI. If an icon currently comes from
another set, prefer replacing it with Hugeicons unless it is intentionally acting
as a high-expression Solar signal.

## Layout

The shell has three primary sections:

- Sidebar: sessions, followed by projects.
- Chat area: conversation with the agent.
- Workspace: open extension surface.

The three sections support horizontal resize. The sidebar and workspace can be
collapsed; when the workspace is collapsed, the chat header shows an expand
icon. The app's minimum window width matches the chat area's minimum width; as
the window narrows, the workspace collapses first, then the sidebar collapses,
leaving a single-column chat surface. Sidebar and workspace expand/collapse are
immediate, without panel animation. If the user expands a collapsed workspace
while the window is too narrow to show it, the native window grows in the needed
direction only enough to keep the chat at or above its minimum width. Workspace
responsive reopen also preserves the current chat column width when possible
and uses a 448px minimum so the extension picker can show at least three icon
columns.

Electron uses a hidden inset title bar. The macOS traffic lights sit directly in the top-left content area. The app provides its own draggable top rows via `.window-drag`.

All regular scroll containers use Ousia's weak scrollbar treatment: thin,
low-contrast tracks/thumbs that stay visually quiet until hover or focus.
Purposefully hidden scrollers, such as overflowing tab rows, may still opt out
with `scrollbar-none`.

The sidebar has a quiet title-bar collapse/expand icon that matches the workspace
collapse control style. `Command+B` also toggles it, and dragging the sidebar
resize handle below the collapse threshold folds the sidebar away. When the
sidebar is collapsed, the chat header keeps a traffic-light spacer so the title
does not sit under the macOS window controls. In macOS fullscreen, the
traffic-light spacer is removed so the sidebar expand/collapse icon stays pinned
to the far-left edge in both expanded and collapsed states.

## Sidebar

Sidebar requirements:

- High information density.
- `会话` is the primary sidebar list and has a new-session action on the right.
- Newly created default sessions are unassigned and use the default work dir.
- `项目` sits directly below the conversation list and has a create-project
  action on the right.
- Project creation opens the native folder picker and supports creating a new
  folder from that picker.
- Project rows are expandable containers, not selectable conversation targets.
  Clicking a project row only expands or collapses the project sessions under it.
- Project rows use small folder icons.
- Sessions support rename and delete.
- The active background state belongs only to session rows, never project rows.
- Deleting all sessions shows a muted `无会话` fallback.
- The sidebar can be collapsed with `Command+B` or by dragging below the
  collapse threshold.
- The sidebar title bar shows the sidebar collapse control after the macOS
  traffic-light area; in fullscreen, the same control moves to the far-left
  title-bar position. When collapsed, the expand control appears before the chat
  session title.
- Settings lives at bottom left.
- Settings use a VS Code-like two-column layout with a compact floating tab list
  to the left of the detail pane for `外观设置`, `通用设置`, and `Agent 设置`.
  The tab list should be inset from the shell edge with comfortable horizontal
  padding, not a full-height rail pressed against the border. Settings do not
  have a save button: selects apply immediately, while text inputs apply on
  blur.

## Chat

Chat requirements:

- Header title is the current session name.
- Current default session title is `新会话`.
- New default sessions are automatically renamed after the first user message
  with a lightweight model-generated title capped at 16 characters.
- User message bubbles hug content width.
- Agent messages render Markdown through Vercel Streamdown.
- Chat typography favors compact reading density: tighter message spacing,
  tighter line-height, and reduced Markdown paragraph/list margins.
- Streamdown's default external-link confirmation modal is disabled; links should not show the extra Streamdown modal.
- Thinking is a weak quote-style block: left vertical line, muted italic text.
- Thinking collapses after completion.
- Message role labels like "You" and "Agent" are not shown.
- The chat transcript auto-follows new messages only while the user is at the
  latest message. Scrolling upward pauses auto-follow and shows a centered
  circular down-arrow above the input; clicking it or manually returning to the
  bottom resumes auto-follow. If the user sends a new message while auto-follow
  is paused, the transcript resumes auto-follow for the new user message and the
  agent response that follows.

## Workspace

Workspace requirements:

- No separate "Workspace" title row.
- Top row is open extension tabs directly.
- The tab row supports multiple open tab instances. Hovering a tab swaps the
  tab icon to a close icon, and clicking it closes that tab.
- A new-tab button is always visible at the right edge of the tab row. When tab
  overflow scrolls horizontally, the new-tab button stays fixed in the visible
  header controls.
- A new workspace tab opens an extension picker page with an app-launcher-style
  adaptive grid of all available workspace extensions: large rounded-square icon
  above, centered extension name below. The picker grid is centered and sized so
  the default workspace view shows four large extension entries per row, then
  automatically reduces columns as the workspace narrows. Choosing an extension
  turns that tab into the selected extension page.
- Horizontal tab overflow must not consume header height.
- The workspace is not a fixed review/code surface. It stays open/free for browser, editor, terminal, runtime extensions, and future surfaces.
