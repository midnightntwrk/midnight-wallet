---
'@midnightntwrk/wallet-sdk-capabilities': major
'@midnightntwrk/wallet-sdk-facade': major
---

Prove a transaction with the backend registered for the protocol version it was built for, instead of with the one
proof server the wallet happened to be configured with.

The two ledger versions want different proving key material, so one prover cannot serve both sides of a fork. Proving
backends are now registered in a `ProtocolVersion.Registry` — the same primitive variant, codec and pending-trait
selection use — and `VersionedProvingService.prove(tx, protocolVersion)` routes on the version.

The version consulted is the transaction's own stamp, taken when it was built, and deliberately not the version the
chain has reached by the time proving happens: a fork can land between balancing and proving, and the bytes the prover
has to read were already fixed. `BalancingRecipe` therefore carries a `protocolVersion`, and `finalizeRecipe` proves
each of a recipe's parts at it.

A version with no registered backend is an `UnsupportedProvingVersionError` naming that version, rather than a proof
built from the wrong key material. That is also how in-process WASM proving states its limit: `makeWasmProvingServices`
registers the bundled prover only from the version its key material covers, so asking it for anything below is a typed
refusal.

**What you must change**

- Proof servers are configured as `provingServers: [{ sinceVersion, url }]`, in ascending order. The existing
  `provingServerUrl` still works and reads as one server for every protocol version; giving both means the list wins,
  and giving neither is now a typed `ProvingConfigurationError` rather than a bare `Error`.
- A custom `provingService` passed to `WalletFacade.init` must be a `VersionedProvingService` — `prove` takes the
  protocol version as a second argument. Wrap a single-version backend with `singleVersionProvingServiceEffect`, which
  says out loud what an unversioned service was implicitly claiming.
- `BalancingRecipe` has a required `protocolVersion`. Recipes the facade builds carry it already; only code that
  constructs a recipe by hand has to say which version it was built for.
- `facade.finalizeTransaction(tx)` briefly took an optional second argument naming the version the transaction was
  built for. As released it takes none: a transaction crosses the facade as a `WalletTransaction` handle carrying its
  own stamp, which is authoritative, so there is nothing left to pass and no fallback to the version the wallets have
  reached (see *The facade speaks transaction handles*).
- `makeDefaultProvingService` / `makeDefaultProvingServiceEffect` take a `ServerProvingConfiguration` (required URL).
  `makeDefaultVersionedProvingService` is the version-routed equivalent and returns an `Either`.
- `ProvingService<TProven>` is now `ProvingService<TProven, TUnproven = ledger.UnprovenTransaction>`. Existing
  single-parameter annotations compile unchanged.
