# shadcn Reference

Generated shadcn/ui reference projects belong under local `ref/`. The directory
is intentionally ignored so generated preset output does not ship in the public
repository.

## Reference Project

Generate the current Radix reference when you need to compare local component
edits against upstream preset output:

```bash
npx shadcn@latest init --preset bbVJxYW --template vite --pointer --name shadcn-bbVJxYW-radix-vite --cwd ref/shadcn-bbVJxYW-radix-vite --yes
npx shadcn@latest add dialog dropdown-menu select tooltip input textarea table --cwd ref/shadcn-bbVJxYW-radix-vite/shadcn-bbVJxYW-radix-vite --yes
```

Reference root:

```text
ref/shadcn-bbVJxYW-radix-vite/shadcn-bbVJxYW-radix-vite
```

Important reference files:

- `ref/shadcn-bbVJxYW-radix-vite/shadcn-bbVJxYW-radix-vite/components.json`
- `ref/shadcn-bbVJxYW-radix-vite/shadcn-bbVJxYW-radix-vite/src/index.css`
- `ref/shadcn-bbVJxYW-radix-vite/shadcn-bbVJxYW-radix-vite/src/components/ui/button.tsx`
- `ref/shadcn-bbVJxYW-radix-vite/shadcn-bbVJxYW-radix-vite/src/components/ui/dialog.tsx`
- `ref/shadcn-bbVJxYW-radix-vite/shadcn-bbVJxYW-radix-vite/src/components/ui/dropdown-menu.tsx`
- `ref/shadcn-bbVJxYW-radix-vite/shadcn-bbVJxYW-radix-vite/src/components/ui/select.tsx`
- `ref/shadcn-bbVJxYW-radix-vite/shadcn-bbVJxYW-radix-vite/src/components/ui/tooltip.tsx`

## Usage Rules

- Treat `ref/` as local generated reference material, not app source.
- Do not commit `ref/`; regenerate it locally when needed.
- Before changing a shadcn/ui primitive in `src/components/ui/`, compare it with the matching file in the local `ref/`.
- Prefer keeping structure, state selectors, spacing, focus styles, and menu padding aligned with the reference unless the app has an explicit design reason to diverge.
- For theme-wide changes, update tokens in `src/index.css` such as `--radius` before rewriting many component classes.
- For local product fit, small component-level overrides are acceptable because shadcn/ui components are owned in this repo.

## Primitive Notes

The app shadcn primitives are Radix-backed. Do not reintroduce `@base-ui/react`
unless the branch direction changes explicitly.

## Select Notes

The reference Radix Select uses:

- `SelectContent` popup radius `rounded-md`
- `SelectGroup` with `p-1`, which creates the gap between menu edge and hovered items
- `SelectItem` radius `rounded-sm`
- item vertical padding `py-1.5`

When using Select, wrap option lists in `SelectGroup` unless there is a specific reason not to. Without the group padding, hovered items can touch the menu edge.
