---
'@midnightntwrk/wallet-sdk-capabilities': minor
---

Additions since 3.x

- **Proving by ledger version.** A `VersionedProvingService` routes each transaction to the backend of the ledger
  version it was built for. `makeDefaultVersionedProvingService(Effect)(configuration, forks)` builds one from
  `provers: { v8?, v9 }` (each `{ kind: 'server', url }` or `{ kind: 'wasm' }`) or from `provingServerUrl`, a proof
  server under both keys; `provers` wins when both are given. It returns an `Either` that fails with
  `ProvingConfigurationError` when neither is given. A version with no backend fails with
  `UnsupportedProvingVersionError`, and a backend handed the other ledger version's transaction fails with
  `ProvingEpochMismatchError`. Ledger-v9 backends: `fromV9ProvingProvider(Effect)`,
  `makeV9ServerProvingService(Effect)`, `makeV9WasmProvingService(Effect)`, `makeV9WasmProvingServices` and
  `makeV9SimulatorProvingService(Effect)`, with the `V8`, `V9` and `AnyVersion` transaction types. The in-process
  backend proves each ledger version with that version's key material.
- **Transaction lifecycle.** `TransactionLifecycleService` keeps one record per transaction from balancing to its final
  state: `Balanced`, `Finalized` and `Submitted`, ending `Confirmed`, `Rejected`, `Orphaned`, `Expired` or `Reverted`.
  The wallet reports each step (`balanced`, `finalized`, `submitted`, `reverted`, and `included` for an inclusion its
  own sync sees first), and the service settles submitted transactions against the indexer; `orphanBeyond(chainNow)`
  ends every live record a protocol upgrade stranded. `balanced(facts)` expects the transaction with its proofs erased,
  so a saved store holds no proof. An ended record stays until its TTL passes (`Lifecycle.isLive`). `serializeState()`
  saves the store and `TransactionLifecycleServiceImpl.restore` reads it back, keeping fields it does not declare.
  `stop()` guarantees that no indexer query runs after it resolves.
- **Validation** (`./validation`). A well-formedness check per ledger version, routed by
  `makeDefaultVersionedValidationService(Effect)(dependencies, forks.v9)`:
  `validateTx(tx, protocolVersion, { flags, blockData? })`. It validates against real ledger parameters, taken from
  `blockData` when given and fetched otherwise (`makeDefaultBlockDataFetcher`), and refuses the other ledger version's
  parameters with `LedgerParametersMismatchError`. Failures are tagged errors: `WellFormedError`,
  `ValidationFetchError`. `withLedgerParameters` types block data whose parameters arrive as `unknown`.
- **New subpaths.** `./chainVersion` (`makeIndexerChainVersionProbe`, which asks the indexer the protocol version of the
  chain's first block), `./codecs` (`LedgerParametersCodec`) and `./signatures` (`Signing`, the SDK's own signature,
  signing-key and verifying-key shapes, with converters to and from ledger-v8's).
- **Fork simulation.** `ForkSimulator` drives one simulated chain across a protocol boundary, and the `V8` and `V9`
  simulators schedule protocol versions (`scheduleFork`, `setProtocolVersion`).
- **Indexer liveness.** `LivenessServiceImpl` and `makeDefaultLivenessReads` cross-check an indexer's reported tip
  against a node's finalized head, with `DEFAULT_LIVENESS_CONFIGURATION`, `DEFAULT_POLL_INTERVAL` (30 s) and
  `DEFAULT_POLL_TIMEOUT` (20 s).
