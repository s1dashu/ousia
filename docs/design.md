# Ousia Design System

This document is the single source of truth for Ousia Desktop UI architecture.
It is normative: future agents must follow it when adding components, changing
tokens, or modifying existing surfaces.

## Design System Contract

Ousia uses shadcn/ui Maia as its default design system. Ousia is not a second
global theme layered on top of shadcn/ui. Product-specific styling is added only
where the product has an explicit visual requirement that Maia does not cover.

The governing rule is:

> New UI is shadcn/ui Maia by default. A component may use Ousia styling only
> when it explicitly opts into an Ousia component or an `--ousia-*` token.

This contract gives us both outcomes we need:

- new and generic UI stays source-aligned with the `bbVKEbY` Maia preset;
- tuned product surfaces such as Sidebar, Composer, MessageBubble, Diff, and
  StreamingOutput keep their intentional Ousia appearance.

## Architecture

The design system has four layers. Do not collapse them into one global token
namespace.

```text
Base UI
  └── behavior primitives
      focus, keyboard navigation, state, accessibility, positioning

shadcn/ui Maia
  ├── global semantic tokens
  │   background, card, muted, border, input, popover, sidebar...
  └── default component recipes
      Button, Card, Select, Dialog, DropdownMenu, Input, Switch...

Ousia product semantics
  └── narrowly named product tokens
      sidebar-surface, composer-surface, message-user-surface,
      stream-muted, diff-added-surface, tool-warning...

Ousia product components
  └── components that shadcn/ui does not provide or that Ousia intentionally
      designs as a distinct product surface
      Sidebar, Composer, MessageBubble, StreamingOutput, Diff, ToolCall...
```

### Base UI is the behavior layer

Base UI owns primitive behavior. It provides accessible state machines and
interaction behavior for controls such as Select, Dialog, Menu, and Tooltip.
It does not define Ousia's product appearance.

Do not reintroduce Radix UI while the project uses the Base UI Maia preset.

### shadcn/ui Maia is the default system

The canonical preset is:

```bash
npx shadcn@latest init --preset bbVKEbY --template next --pointer
```

It defines both:

- the global semantic token values;
- the default component recipes and interaction styling.

The local generated reference and comparison workflow are documented in
`docs/shadcn-reference.md`.

The global light and dark shadcn tokens in `src/index.css` must remain aligned
with the generated `bbVKEbY` reference. In particular, light-mode
`background`, `card`, and `popover` are white; Paper or Tea must not tint them.

### Ousia semantics are additions, not replacements

Ousia may define product semantics when Maia does not describe the product
concept precisely enough. Every such token must:

- start with `--ousia-`;
- name a product role rather than a generic color;
- have the narrowest practical ownership;
- never redefine the meaning of a global shadcn token.

Good names:

```css
--ousia-sidebar-surface
--ousia-sidebar-selected-surface
--ousia-composer-surface
--ousia-composer-border
--ousia-message-user-surface
--ousia-message-user-foreground
--ousia-stream-muted-foreground
--ousia-diff-added-surface
--ousia-tool-warning-foreground
```

Bad names:

```css
--ousia-gray-1
--ousia-warm-background
--custom-card
--new-muted
```

Role names survive palette changes. Visual-value names do not.

## Token Ownership

### Global shadcn tokens

These are global Maia semantics and must not be changed by Ousia appearance
scales or product component scopes:

```text
--background
--foreground
--card
--card-foreground
--popover
--popover-foreground
--primary
--primary-foreground
--secondary
--secondary-foreground
--muted
--muted-foreground
--accent
--accent-foreground
--destructive
--border
--input
--ring
--sidebar-*
--chart-*
--radius
```

New generic components may depend on these without any Ousia wrapper.

### Ousia palette values

Paper, Tea, and other appearance scales are optional product palettes. They are
not alternative shadcn foundations.

An appearance selector may set only Ousia-prefixed values:

```css
:root[data-radix-color-scale="tea"] {
  --ousia-sidebar-surface: ...;
  --ousia-sidebar-hover-surface: ...;
  --ousia-composer-surface: ...;
  --ousia-message-user-surface: ...;
}
```

It must not do this:

```css
:root[data-radix-color-scale="tea"] {
  --background: ...;
  --card: ...;
  --muted: ...;
}
```

If an appearance setting affects only Sidebar and Chat, its description must
say so. Do not imply that it changes the entire shadcn design system.

### Component tokens

When a token belongs to one component, that component should consume it
directly:

```tsx
<div className="bg-[var(--ousia-message-user-surface)] text-[var(--ousia-message-user-foreground)]" />
```

Do not make a MessageBubble indirectly consume `bg-card`, and do not redefine
`--card` around MessageBubble to achieve a local product color.

Component-local fallback values are acceptable when the value is not themed:

```css
.ousia-message-bubble {
  --ousia-message-padding-inline: 0.75rem;
}
```

Values that change with appearance mode or color scale belong in the centralized
Ousia product token definitions in `src/index.css`.

## Component Ownership

### `src/components/ui`

This directory contains the default shadcn/ui layer.

Components here should stay aligned with Maia structure, state selectors,
geometry, focus treatment, and semantic token usage. They may include changes
that are valid for every consumer, such as:

- Base UI API adaptation;
- HugeIcons integration;
- accessibility fixes;
- generic bug fixes;
- compatibility behavior required by the application runtime.

The target state is that components in this directory must not:

- import from `src/features`;
- consume `--ousia-*` product tokens;
- contain Chat-, Settings-, or Sidebar-specific styling;
- be modified only to satisfy one feature's layout.

Some existing globally customized primitives still contain Ousia surface
tokens. Treat those as migration debt: do not add new product coupling, and
remove existing coupling only after its consumers have an explicit wrapper and
visual regression coverage.

If a change is not correct for every consumer, create a feature wrapper or an
Ousia product component instead.

### shadcn components inside features

Feature code should use `src/components/ui` directly whenever the default Maia
component is correct:

```tsx
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Select } from "@/components/ui/select"
```

Small composition-level adjustments are expected:

```tsx
<Button size="sm" />
<Card className="gap-0 py-0" />
<SelectTrigger className="w-full" />
```

Controls in the same group must use a shared size contract. For example, the
default Maia Input and Button are both `h-9`; do not pair an `h-9` Input with a
`size="sm"` (`h-8`) Button unless the mismatch is intentional and documented.

### Feature wrappers

Create a wrapper when a feature needs a repeatable adaptation of a shadcn
component:

```tsx
function ComposerButton(props: ButtonProps) {
  return <Button className="...composer-specific classes..." {...props} />
}
```

The wrapper belongs with the feature or under `src/components/ousia` if it is
reused across features. Do not push its styling back into the global Button.

### Ousia product components

Use an Ousia component when shadcn/ui has no equivalent or when the product has
an intentionally distinct interaction and visual recipe. Current examples:

- project/session Sidebar;
- Chat Composer;
- user MessageBubble;
- streaming response presentation;
- tool call disclosure;
- file Diff preview;
- queued message presentation.

These components may consume `--ousia-*` tokens. They should not redefine
global shadcn semantics for their descendants.

## Settings Policy

Settings is the reference surface for default Maia behavior.

Settings should use shadcn/ui components wherever they exist: Card, Button,
Input, Select, Switch, Dialog, DropdownMenu, and related primitives. Settings
must not enter a broad Chat or Sidebar product theme scope. The current
feature-local Settings primitives are source-aligned copies of Maia used while
global primitives still carry product customization. They are migration
adapters; do not introduce another Settings visual system or add more copies
without a concrete isolation need.

The Settings sidebar has one explicit exception: it reuses the product
`--ousia-sidebar` background alias and `--ousia-sidebar-accent` navigation
state alias so switching between the session sidebar and Settings preserves the
same appearance scale. The target component semantic names are
`--ousia-sidebar-surface` and `--ousia-sidebar-hover-surface`; rename the aliases
only as part of the reviewed Sidebar token migration. Settings navigation text,
focus, border, and control semantics remain Maia.

Settings-specific layout is allowed:

- settings navigation and provider-aware sections;
- grouped row composition;
- responsive row breakpoints;
- content width constraints;
- directory picker composition.

Fixed Settings colors, an alternative Settings theme, or duplicated shadcn
semantic tokens are not allowed.

Portaled Select, Dialog, DropdownMenu, and Tooltip content naturally reads the
global Maia tokens. Do not require a Settings-only class on `html` or `body` to
make portals look correct.

## Product Surface Rules

### Sidebar

- The session/project sidebar is an Ousia product component.
- Its surface, selected row, hover treatment, spacing, and shadows use explicit
  `--ousia-sidebar-*` tokens or component recipe classes.
- Settings may share the Sidebar surface and navigation state backgrounds for
  transition and appearance-scale continuity.
- Keep rows inset with explicit margins; do not use negative margins that make
  selected rows consume the sidebar padding.

### Chat panel

- The main Chat panel is a product composition surface, while ordinary controls
  inside it remain shadcn/ui unless explicitly wrapped.
- Light-mode main panels, menus, popovers, dialogs, and dropdowns are white.
- The panel uses the shared half-pixel border and main-panel shadow.
- Chat and Settings share their left-corner geometry, not their entire theme.

### Composer

- Composer geometry, border, ring, surface, and shadows are Ousia product
  semantics.
- Composer controls should still compose shadcn Buttons, Menus, Selects, and
  Tooltips unless a product wrapper is needed.
- Composer styling must not change the global Button, Input, or Select recipe.

### Messages and streaming output

- User bubbles use explicit `--ousia-message-user-*` semantics.
- Assistant text should use the normal content foreground unless a specific
  streaming state requires an Ousia token.
- Streaming cursors, transient muted states, and tool disclosures use narrowly
  named `--ousia-stream-*` or `--ousia-tool-*` tokens.
- Do not use `card` or `muted` as aliases for a message concept merely because
  their current colors happen to match.

### Diff and tool output

- Diff additions, deletions, context, warnings, and failure states are product
  semantics because shadcn/ui does not define them.
- Keep those values under `--ousia-diff-*` and `--ousia-tool-*`.
- Avoid leaking diff colors into generic destructive, muted, Card, or Border
  tokens.

## Icons

Use HugeIcons for interface icons. Route icon imports through
`src/components/icons/huge-icons.tsx` so sizing and stroke behavior stay
consistent.

An upstream shadcn recipe may be adapted to HugeIcons without becoming an Ousia
product component. Icon-library adaptation is a global implementation choice,
not product styling.

## Styling Rules

### Prefer semantic tokens over fixed values

Use fixed values for geometry when the design intentionally requires an exact
measurement. Use semantic tokens for colors and themed surfaces.

Good:

```tsx
className="rounded-[18px] bg-[var(--ousia-message-user-surface)]"
```

Bad:

```tsx
className="bg-[#f2ebe7] text-[#241f1b]"
```

### Do not create broad product theme scopes

Avoid scopes that remap the complete shadcn namespace:

```css
.ousia-chat-theme {
  --background: var(--ousia-app-background);
  --card: var(--ousia-app-card);
  --muted: var(--ousia-app-muted);
  --popover: var(--ousia-app-popover);
}
```

Such scopes are acceptable only as temporary migration boundaries. They make
future shadcn components inherit product colors invisibly and create mismatches
with content portaled to `body`.

The target architecture is direct component semantics:

```css
--ousia-sidebar-surface
--ousia-composer-surface
--ousia-message-user-surface
--ousia-stream-muted-foreground
```

### Respect portal boundaries

Base UI portal content normally inherits from `body`, not from the trigger's
feature subtree. Default popup styling must therefore work from global Maia
tokens. If a product-specific popup is genuinely required, pass an explicit
product class or portal container; do not mutate `html` or `body` while the
feature is open.

## Adding New UI

Follow this decision sequence:

1. Does shadcn/ui provide the component?
   - Yes: generate or reuse the Maia component from `src/components/ui`.
   - No: continue to step 2.
2. Is the concept a generic UI primitive or an Ousia product concept?
   - Generic: add a Maia-aligned component under `src/components/ui`.
   - Product concept: add an Ousia component under its feature or
     `src/components/ousia`.
3. Does the component require a color not described by Maia semantics?
   - No: use the existing shadcn token.
   - Yes: add the narrowest possible `--ousia-<component>-<role>` token.
4. Does an existing shadcn component need a feature-only adjustment?
   - Wrap or compose it locally; do not modify the global recipe.
5. Does the component portal content?
   - Verify trigger and popup independently because their inheritance roots may
     differ.

Before finishing, confirm that a newly imported shadcn component with no extra
classes renders as Maia.

## Enforcement

Architecture should be protected by automation, not memory alone.

Maintain tests or lint rules for these invariants:

- global shadcn tokens match the generated `bbVKEbY` light and dark values;
- appearance selectors do not assign unprefixed shadcn semantic tokens;
- files under `src/components/ui` do not contain `--ousia-` or import features;
- Settings does not opt into broad Chat or Sidebar product scopes;
- same-row controls use compatible size contracts;
- portal surfaces remain Maia unless explicitly product-specific;
- Sidebar, Composer, MessageBubble, StreamingOutput, and Diff retain visual
  regression coverage as they are migrated to direct component tokens.

Run type checks, lint, component tests, and visual QA after token or primitive
changes.

## Migration Direction

The repository may temporarily contain `.ousia-chat-theme` or
`.ousia-sidebar-theme` mappings that rebind broad shadcn semantics. These are
migration adapters, not the desired final design system.

Migrate them incrementally, one visually reviewed product surface at a time:

1. Sidebar to `--ousia-sidebar-*`;
2. Composer to `--ousia-composer-*`;
3. user messages to `--ousia-message-user-*`;
4. streaming and tool output to `--ousia-stream-*` and `--ousia-tool-*`;
5. Diff to `--ousia-diff-*`;
6. remove each broad shadcn token remapping after its consumers are migrated.

Do not perform a blind global replacement. Preserve the existing tuned visual
result and verify each surface before removing its migration scope.

## Review Checklist

For every UI change, answer:

- Is this default shadcn/ui Maia or an explicit Ousia product component?
- If it is Ousia-specific, is that ownership visible in the component or token
  name?
- Did the change alter a global shadcn token for a local requirement?
- Could an unrelated new shadcn component inherit this styling accidentally?
- Does portal content receive the intended tokens?
- Are control sizes consistent within the same row or group?
- Does Settings still render from global Maia semantics?
- Did Sidebar, Composer, MessageBubble, StreamingOutput, or Diff regress?

If ownership is unclear, keep the global Maia system unchanged and implement
the requirement locally.
