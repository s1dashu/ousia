# `@ousia/extension-api`

Environment-neutral contracts for compile-time Ousia product extensions.

The package contains strict product identity/path-policy definitions,
provider-neutral Agent tool contracts, and Workspace App codec/registry
contracts. It does not load arbitrary local code and is not the removed Ousia
runtime-extension system.

Runtime codecs receive validated, deeply frozen JSON snapshots at decode
boundaries and must return valid JSON from encode. Values such as `undefined`,
class instances, sparse arrays, and circular structures fail before product
codec logic runs.

Agent tool product-event and progress callbacks also cross strict JSON snapshot
boundaries. History-only Workspace App ingress must not produce ephemeral
effects; reducers that do so fail instead of silently replaying UI behavior.

Ousia Desktop consumes this package before downstream products do. Published
releases use exact semantic versions so products such as Miki can upgrade the
host boundary through reviewed dependency changes.
