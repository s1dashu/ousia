# shadcn Reference

Generated shadcn/ui reference projects belong under local `ref/`. The directory
is intentionally ignored so generated preset output does not ship in the public
repository.

## Reference Project

Generate the current Base UI reference when you need to compare local component
edits against upstream preset output:

```bash
npx shadcn@latest init --preset bbVKEbY --template next --pointer --name shadcn-bbVKEbY-next --cwd ref/shadcn-bbVKEbY-next --yes
npx shadcn@latest add button card dialog dropdown-menu input select separator sidebar switch tooltip textarea table --cwd ref/shadcn-bbVKEbY-next/shadcn-bbVKEbY-next --yes
```

Preset `bbVKEbY` is the Base UI Maia style with neutral colors, Figtree,
HugeIcons, default radii, and subtle menu accents.

Reference root:

```text
ref/shadcn-bbVKEbY-next/shadcn-bbVKEbY-next
```

Important reference files:

- `ref/shadcn-bbVKEbY-next/shadcn-bbVKEbY-next/components.json`
- `ref/shadcn-bbVKEbY-next/shadcn-bbVKEbY-next/app/globals.css`
- `ref/shadcn-bbVKEbY-next/shadcn-bbVKEbY-next/components/ui/button.tsx`
- `ref/shadcn-bbVKEbY-next/shadcn-bbVKEbY-next/components/ui/card.tsx`
- `ref/shadcn-bbVKEbY-next/shadcn-bbVKEbY-next/components/ui/input.tsx`
- `ref/shadcn-bbVKEbY-next/shadcn-bbVKEbY-next/components/ui/select.tsx`
- `ref/shadcn-bbVKEbY-next/shadcn-bbVKEbY-next/components/ui/separator.tsx`
- `ref/shadcn-bbVKEbY-next/shadcn-bbVKEbY-next/components/ui/sidebar.tsx`
- `ref/shadcn-bbVKEbY-next/shadcn-bbVKEbY-next/components/ui/switch.tsx`

## Usage Rules

- Treat `ref/` as local generated reference material, not app source.
- Do not commit `ref/`; regenerate it locally when needed.
- Before changing a shadcn/ui primitive in `src/components/ui/`, compare it with the matching file in the local `ref/`.
- Prefer keeping structure, state selectors, spacing, focus styles, and menu padding aligned with the reference unless the app has an explicit design reason to diverge.
- For theme-wide changes, update tokens in `src/index.css` such as `--radius` before rewriting many component classes.
- For local product fit, small component-level overrides are acceptable because shadcn/ui components are owned in this repo.
- Settings uses feature-local primitives under `src/features/settings/` so its
  Maia controls can remain source-aligned with `bbVKEbY`.
- The global shadcn semantic tokens in `src/index.css` must match the generated
  `bbVKEbY` light and dark values. Appearance scales may change only
  `--ousia-app-*` product tokens, never the global shadcn token set.
- Tuned chat and session-sidebar surfaces opt into local token scopes at their
  component roots. Settings deliberately does not enter those scopes, so its
  controls, menus, dialogs, and content use Maia semantics directly. Its sidebar
  reuses only `--ousia-sidebar` for background continuity; all other navigation
  semantics remain Maia.
- Keep only shell-level classes in `settings-local-styles.ts`; primitive styles
  belong beside their feature-local components and must match the Maia source.

## Primitive Notes

The app shadcn primitives are Base UI-backed. Do not reintroduce `radix-ui`
unless the branch direction changes explicitly.

After generating the reference, verify that `components.json` uses
`"style": "base-maia"`, `"iconLibrary": "hugeicons"`, and Base UI imports.
Treat Radix or non-Maia output as an invalid
reference and regenerate it with `--base base`.

## Select Notes

The reference Base UI Maia Select uses the following treatment:

- `SelectTrigger` uses `rounded-4xl`, `bg-input/30`, and Maia focus rings.
- `SelectContent` uses `rounded-2xl`, `bg-popover`, `shadow-2xl`, and a subtle
  foreground ring.
- `SelectGroup` with `p-1`, which creates the gap between menu edge and hovered items
- `SelectItem` uses `rounded-xl`, `px-3`, and `py-2`.
- control and item icons sized at `size-4`

When using Select, wrap option lists in `SelectGroup` unless there is a specific reason not to. Without the group padding, hovered items can touch the menu edge.

## Dropdown Menu Notes

- Base UI `Menu.GroupLabel` requires a `Menu.Group` or `Menu.RadioGroup`
  ancestor. Every `DropdownMenuLabel` must stay inside the group it labels;
  rendering a label directly under `DropdownMenuContent` is a runtime error.
- Keep collision padding on `DropdownMenuContent`; the Ousia wrapper forwards
  it to the Base UI positioner rather than leaking it onto the popup DOM node.

## Settings Maia Control Notes

- Settings Card, Button, Input, Select, Switch, and Dialog copy their class
  structure from `bbVKEbY`; do not replace their semantic tokens with fixed
  hex colors or Nova radii.
- Settings group cards use the feature-local Maia Card and retain only the
  application-specific row-list composition override.
- The settings switch is 32 by 18 pixels with a 16-pixel thumb. Its
  Base UI-backed implementation lives in `SettingsSwitch.tsx`, preserving focus,
  checked, and disabled states without inheriting the global Switch treatment.
- Settings buttons, inputs, and dialogs likewise use feature-local wrappers;
  the experiment must not import their equivalents from `src/components/ui/`.
