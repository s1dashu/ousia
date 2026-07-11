# Contributing

Thanks for helping improve Ousia Desktop.

## Development Setup

```bash
npm install
npm run start
```

Before opening a pull request, run:

```bash
npm run check
```

For packaging changes, also run:

```bash
npm run package
```

## Project Direction

This repository is the simplified desktop agent client. Keep changes aligned
with the current product boundary:

- Chat is the primary agent surface.
- The sidebar owns project, session, and settings navigation.
- The Electron main process hosts Pi coding agent sessions.
- The removed Ousia extension/runtime-extension/workspace-tab surfaces should
  not be reintroduced unless that direction changes explicitly.

## Code Style

- Follow the existing React, Electron, and shadcn/ui patterns.
- Use HugeIcons through `src/components/icons/huge-icons.tsx` for interface
  icons.
- Keep floating panels, popovers, dialogs, and dropdowns consistent with the
  shared design direction in `docs/design.md`.
- Update the relevant docs when changing product behavior or architecture.

## Pull Requests

Use focused pull requests with a short description of the user-facing behavior,
implementation notes, and verification commands that were run.
