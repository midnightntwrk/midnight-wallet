---
'@midnightntwrk/wallet-sdk-facade': minor
---

Additions since 4.x

- `validateTransaction(tx, { flags, blockData? })` checks that a transaction is well formed before it is submitted,
  against real ledger parameters, at the protocol version its handle carries. Recipes from the balancing methods carry
  the `blockData` they were priced with through `signRecipe`, so `balance → validate → submit` fetches no block twice. A
  ledger-v8 transaction validated without `blockData` once the chain is past `forks.v9` is refused with
  `LedgerParametersMismatchError`. Failures are tagged errors: `WellFormedError`, `ValidationFetchError`. `InitParams`
  gains `validationService` and `fetchBlockData`.
- `adoptTransaction(bytes, stage)` reads a transaction from bytes that name no protocol version, such as those the DApp
  Connector API passes, at the version the facade is acting at, and returns the sealed handle. Bytes written by the
  other ledger version are refused with a `WireFormatError` that names the version.
- `FacadeState.protocolVersion`, `activeProtocolVersion` and `protocol` report where the wallets are: `Settled`
  (`{ version }`) or `Crossing` (`{ from, to, behind }`).
- `start(material, { manualSync: true })` leaves the Dust wallet to be synchronized by hand, one pass per
  `doSync(material)`; this needs a Dust wallet built with the projections sync. Below `forks.v9`, where that sync cannot
  run, `start` refuses the option before starting anything, and `doSync` rejects, with `ManualSyncUnsupportedError`
  (`isManualSyncUnsupportedError`).
- Lifecycle records cover every transaction the facade balances, finalizes, submits or reverts, Dust (de)registrations
  included. A balanced transaction is saved with its proofs erased, so the store holds no secret key. A transaction
  still pending when the chain crosses the v9 fork can never be included: it is orphaned, its coins are released, and
  history records the rejection with reason `orphaned-by-protocol-upgrade`. `revert` and `revertTransaction` take an
  optional reason.
- New exports include `DefaultForkSchedule`, `ResolvedConfiguration`, `FacadeKeysByEpoch`, `FacadeStartMaterial`,
  `FacadeStartOptions`, `SignSegment`, `LifecycleEntry`, `LifecycleStatus`, `lifecycleEntriesOf`, `isAwaiting` and
  `lifecycleTransactionTraits`.
