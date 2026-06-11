# Terminal Extension Resources

This directory contains resources owned by the first-party Terminal extension.

Bundled Starship binaries should live under:

```text
vendor/starship/<platform>-<arch>/starship
```

Examples:

```text
vendor/starship/darwin-arm64/starship
vendor/starship/darwin-x64/starship
vendor/starship/linux-x64/starship
```

Electron main prepends the matching directory to `PATH` when it exists, then
uses Starship's `plain-text-symbols` preset for the workspace terminal prompt.
If no bundled binary is present, the terminal falls back to the user's installed
`starship`; if that is also unavailable, it uses a compact built-in prompt.

The default Starship preset is vendored at:

```text
presets/plain-text-symbols.toml
```

Keep this file aligned with Starship's official `plain-text-symbols` preset.
