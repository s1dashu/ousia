# Sentry Error Monitoring

Ousia owns the reusable Electron Sentry integration used by downstream desktop
products. Product composition supplies only the product id, release prefix, and
environment-variable prefix in the three Vite configs. Do not add downstream
product names or DSNs inside the reusable runtime modules.

## Runtime boundary

The official `@sentry/electron` SDK initializes in Electron main, preload, and
renderer entrypoints. The main-process framework also exposes a validated
handled-error boundary for failures that application code catches and converts
into UI state. Its metadata is limited to lowercase diagnostic tokens for
`subsystem`, `operation`, and `error_code`, plus boolean handled/retryable tags;
never pass messages, paths, account identifiers, provider responses, or user
content as diagnostic metadata. Update checks/downloads and telemetry delivery
use this boundary so operational failures do not disappear into local logs.

A build with no product DSN is explicitly disabled and
records `sentry.init` with `dsn_not_configured` in the local runtime log.
Development builds also require `<PRODUCT>_SENTRY_ENABLE_IN_DEVELOPMENT=1`.
The Vite composition explicitly loads the normal mode-specific Vite environment
files, including ignored `.env.local`, from the repository root before applying
process-environment overrides. Never derive that root from `process.cwd()`:
Electron Forge's programmatic packager may run config evaluation with a
different working directory. Keep this behavior covered by
`sentry-vite.test.ts`.

Every outbound JavaScript error passes through one sanitizer. It removes user,
request, breadcrumb, extra, message, log, fingerprint, server-name, device, and
local-variable data. Exception values are reduced to the exception type, while
stack frames retain function/module information and replace local home-directory
segments with `~/`. Events receive only `product_id` and `process_type` tags.
Do not weaken this boundary to make a single incident easier to inspect.

Screenshots, Sentry logs, tracing, and session replay are disabled. Native crash
minidumps are also disabled by default because they can contain process memory;
enable them only after an explicit privacy/retention decision with
`<PRODUCT>_SENTRY_ENABLE_NATIVE_CRASH_REPORTS=1`.

## Build and source maps

An enabled production build fails unless all three build-only source-map values
are present:

- `SENTRY_AUTH_TOKEN`
- `SENTRY_ORG`
- `<PRODUCT>_SENTRY_PROJECT`

For local macOS releases, `SENTRY_AUTH_TOKEN` may instead live in the login
Keychain under service `sidasoftware-sentry-build` and account
`source-map-upload`. The build reads it only when the environment variable is
unset and never prints the value. Create or rotate that entry interactively:

```sh
security add-generic-password -U -s sidasoftware-sentry-build \
  -a source-map-upload -w
```

The public DSN is embedded in the application. The auth token is consumed only
by `@sentry/vite-plugin` and must never be shipped. Source maps are generated as
hidden maps, uploaded to the exact `<release-name>@<package-version>` release,
and excluded from the packaged application by Forge.

The build rejects malformed DSNs, partial upload credentials, and non-boolean
feature flags instead of silently producing an unobservable release. Every DMG
and full macOS release additionally inspects the packaged main bundle for the
exact enabled release marker and refuses to create a distributable when Sentry
was compiled out. Development-only `npm run package` may remain explicitly
disabled for credential-free local packaging.

Electron Forge builds main, preload, and renderer targets concurrently. Each
Sentry Vite plugin must scan only the source maps owned by that target: main
excludes `preload.js`, preload selects only `preload.js`, and renderer selects
only `.vite/renderer`. Scanning the shared build directory from every target can
read a large map while another target is still writing it. The plugin error
handler must throw so parse and upload failures stop the production build.

## Product configuration

Ousia Desktop uses:

- product id `ousia`
- release prefix `ousia-desktop`
- environment prefix `OUSIA`

Downstream products port the framework files and change only these composition
values. Each product must use its own Sentry project and public DSN. Never send
Ousia and a downstream product into the same Sentry project as a substitute for
product isolation.

## Verification

Without credentials, run the normal checks and package command and confirm the
runtime log contains the explicit disabled state. With a real project, build a
separate release using the ignored/CI environment, trigger a deliberate test
exception in a non-user-data code path, verify its product/release/process tags
and symbolicated stack in Sentry, then remove the trigger before merging.
