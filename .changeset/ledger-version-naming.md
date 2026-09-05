---
'@midnightntwrk/wallet-sdk-capabilities': major
'@midnightntwrk/wallet-sdk-shielded': major
'@midnightntwrk/wallet-sdk': major
---

refactor(sdk)!: name the two sides of a fork by version, never by position

Every name that placed itself relative to the `forks.v9` boundary, or called one side "current", now names a version
instead: wallet code by variant, `V1`/`V2`; ledger material by ledger version, `V8`/`V9`. Positional names stop meaning
anything once a second fork exists, and "current" is wrong the day after it; version numbers do not move. The rule lives
in CLAUDE.md under "Naming the two sides of a fork", and `scripts/check-fork-vocabulary.mjs` enforces it in
`verify:check` and CI. The hard-fork API this renames has not shipped, so the pending release notes simply use the final
names.

BREAKING CHANGE — the ledger-v9 twins of exports that already carried `V8` now carry `V9` too, and these had shipped.
In `@midnightntwrk/wallet-sdk-capabilities/proving`, present since 3.3.1:

| Before                                                                                                                                                   | After                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fromProvingProviderEffect`, `fromProvingProvider`, `makeServerProvingServiceEffect`, `makeWasmProvingServiceEffect`, `makeServerProvingService`, `makeWasmProvingService` | `fromV9ProvingProviderEffect`, `fromV9ProvingProvider`, `makeV9ServerProvingServiceEffect`, `makeV9WasmProvingServiceEffect`, `makeV9ServerProvingService`, `makeV9WasmProvingService` |
| `UnboundTransaction`                                                                                                                                     | `V9UnboundTransaction`                                                                                                                                               |

Published in the 4.0.0 betas only: in `…/validation`, `AnyValidatableTransaction`, `makeDefaultValidationServiceEffect`
and `makeDefaultValidationService` are now `AnyV9ValidatableTransaction`, `makeV9ValidationServiceEffect` and
`makeV9ValidationService` (the versioned router `makeDefaultVersionedValidationService*` keeps its name), and
`@midnightntwrk/wallet-sdk-shielded` re-exports `V9UnboundTransaction` in place of `UnboundTransaction`.
`@midnightntwrk/wallet-sdk` exposes the same names through its `./capabilities/proving` subpath.
