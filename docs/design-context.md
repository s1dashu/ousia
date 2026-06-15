# Design Context

The `simple-gui` branch keeps the interface quiet and direct: sidebar, chat, and
a right-side terminal. Avoid reintroducing app-launcher, marketplace, tabbed
workspace, or extension-management UI.

## Shell

- Left sidebar: projects, sessions, and settings.
- Center: chat and model controls.
- Right: terminal only.
- The chat header shows a terminal icon when the right panel is collapsed. Click
  opens the terminal directly.
- Keep resize handles thin and unobtrusive.
- Preserve current shadcn theme direction and compact desktop density.

## Icon Policy

- Use HugeIcons for all interface icons, including ordinary utility controls
  and workspace-level signals.
- Route icon imports through `src/components/icons/huge-icons.tsx` so icon
  sizing and stroke handling stay consistent.
- Use the exported `SquareTerminal` HugeIcons mapping for the right-panel
  open/collapse action.

## Terminal Panel

- No tab strip, picker, or separate "Workspace" title row.
- The panel should fill the available right-side area edge to edge.
- Terminal colors must track the resolved light/dark theme.
- Terminal text should use the bundled terminal mono font stack and avoid
  viewport-scaled font sizing.

## Settings

- Settings sections are vertically stacked.
- Do not add a left settings navigation rail.
- Appearance settings include mode and Radix color scale.
- Model settings manage provider API keys; model and thinking level selection
  stay in the chat input controls.

## Sidebar

- `会话` and `项目` are top-level sortable sections.
- Section drag overlays should cover the full section row area, including the
  empty-state row when present.
