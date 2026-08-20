---
'@midnightntwrk/wallet-sdk-capabilities': minor
---

Validate a transaction at the protocol version it was authored for, rather than assuming every transaction belongs to
the current ledger.

`@midnightntwrk/wallet-sdk-capabilities/validation` gains the same version-routing shape proving already has:

- `ValidationServices` — a `ProtocolVersion.Registry` of validators, keyed by the version range each one serves.
- `makeVersionedValidationServiceEffect(services)` / `VersionedValidationServiceEffect` — `validateTx(tx,
protocolVersion, options)`, routing on the version the transaction was **authored** for, never on where the chain has
  since got to. A version no validator covers fails with the typed `UnsupportedValidationVersionError`, which names it.
- `singleVersionValidationServiceEffect(service)` — one validator answering for every version, which is what an
  unversioned validation service was implicitly claiming. True on one side of a fork, a lie the moment it crosses, so it
  now has to be written down.
- `wrapVersionedValidationService(effectService)` — the promise-facing surface, rejecting with the typed error itself
  rather than a fiber wrapper around it.
- `makePreForkValidationServiceEffect(deps)` — a genuine pre-fork (`@midnight-ntwrk/ledger-v8`) validator that runs that
  ledger's own `wellFormed` against its own `LedgerState`, alongside `preForkWellFormedCheck` and
  `AnyPreForkValidatableTransaction`.
- `makeValidationServiceEffect(check, deps)` and `WellFormedCheck` — the ledger-neutral core both validators are built
  from.

`BlockData`, `ValidateTxOptions`, `ValidationServiceDependencies`, `ValidationServiceEffect` and `ValidationService`
gained type parameters for the ledger version they speak, each defaulting to the current ledger. Every existing
annotation keeps naming exactly what it named before, and `makeDefaultValidationService(Effect)` is unchanged in
signature and behaviour — this release is additive.

Not yet wired: nothing registers the pre-fork validator, because the default block-data fetcher's codec registry is
open-ended from the minimum supported version and holds only the current ledger's codec, so the block data reaching
validation is always current-ledger parameters. Routing the block-data fetch on the version a block reports is what
closes that.
