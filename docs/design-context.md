# Design Context

## Visual Direction

The current UI should feel closer to Codex desktop in density and seriousness, but not copy Codex exactly.

The app uses a shadcn preset as the visual base. The user explicitly asked not to keep the earlier Pie-client styling. The color theme was changed from Mauve to Neutral.

Light mode should not use pure white for every surface. `background`, `card`,
`popover`, `muted`, and sidebar tokens intentionally use slightly different
neutral lightness values so light mode mirrors the dark-mode surface hierarchy
instead of flattening inputs and extension surfaces into white rectangles.

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

- Sidebar: projects and sessions.
- Chat area: conversation with the agent.
- Workspace: open extension surface.

The three sections support horizontal resize. The sidebar and workspace can be
collapsed; when the workspace is collapsed, the chat header shows an expand
icon.

Electron uses a hidden inset title bar. The macOS traffic lights sit directly in the top-left content area. The app provides its own draggable top rows via `.window-drag`.

The sidebar has no visible collapse/expand title-bar control. `Command+B`
toggles it, and dragging the sidebar resize handle below the collapse threshold
folds the sidebar away. When the sidebar is collapsed, the chat header keeps a
traffic-light spacer so the title does not sit under the macOS window controls.
In macOS fullscreen, the traffic-light spacer shows the product name `Ousia`.

## Sidebar

Sidebar requirements:

- High information density.
- Small project folder icons.
- Project names and session names align in a Codex-like hierarchy.
- `Projects` has an open-project action on the right.
- Each project row has a new-session action on the right.
- Sessions support rename and delete.
- The sidebar can be collapsed with `Command+B` or by dragging below the
  collapse threshold.
- The sidebar session list uses a thin, low-contrast scrollbar that appears only
  on hover or focus.
- Settings lives at bottom left.

## Chat

Chat requirements:

- Header title is the current session name.
- Current default session title is `新会话`.
- Code comment notes that AI-generated session naming should connect here later.
- User message bubbles hug content width.
- Agent messages render Markdown through Vercel Streamdown.
- Chat typography favors compact reading density: tighter message spacing,
  tighter line-height, and reduced Markdown paragraph/list margins.
- Streamdown's default external-link confirmation modal is disabled; links should not show the extra Streamdown modal.
- Thinking is a weak quote-style block: left vertical line, muted italic text.
- Thinking collapses after completion.
- Message role labels like "You" and "Agent" are not shown.
- The chat transcript uses a thin, low-contrast scrollbar that appears only on
  hover or focus.
- The chat transcript auto-follows new messages only while the user is at the
  latest message. Scrolling upward pauses auto-follow and shows a centered
  circular down-arrow above the input; clicking it or manually returning to the
  bottom resumes auto-follow.

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
  above, centered extension name below. Choosing an extension turns that tab into
  the selected extension page.
- Horizontal tab overflow must not consume header height.
- The workspace is not a fixed review/code surface. It stays open/free for browser, editor, terminal, runtime extensions, and future surfaces.
