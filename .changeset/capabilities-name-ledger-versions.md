---
'@midnightntwrk/wallet-sdk-capabilities': major
'@midnightntwrk/wallet-sdk-dust-wallet': patch
'@midnightntwrk/wallet-sdk-facade': patch
---

refactor(capabilities)!: name the ledger version of every proving and validation type and backend

The proving and validation types no longer default their transaction and parameters types to ledger-v9's, and every
factory that builds over one ledger version says which. A reference that left a type argument out meant ledger-v9's
without saying so, and for ledger parameters, which both ledger versions declare identically, that labelled ledger-v8's
as ledger-v9's without a compiler error. `DustWallet.balanceTransactions` now types its block data's parameters as either
ledger version's, which is what it returns on either side of `forks.v9`.

`V9UnprovenTransaction` now sits beside `V9UnboundTransaction`, and `V9ProvingServiceEffect` is added as the twin of
`V8ProvingServiceEffect`. Both are exported from `./proving`.

`makeDefaultSubmissionService` and `makeDefaultSubmissionServiceEffect` no longer default their transaction type to
ledger-v9's `FinalizedTransaction`. The node takes a transaction's bytes, so a service built without naming one now
submits either ledger version's transactions.

BREAKING CHANGE:

- `ProvingServiceEffect`, `ProvingService`, `VersionedProvingServiceEffect`, `VersionedProvingService` and
  `ProvingServices` require the unproven transaction they accept: write
  `ProvingService<V9UnboundTransaction, V9UnprovenTransaction>` where `ProvingService<V9UnboundTransaction>` was written.
- `BlockData`, `ValidateTxOptions`, `ValidationServiceDependencies`, `ValidationServiceEffect`, `ValidationService`,
  `VersionedValidationServiceEffect`, `VersionedValidationService` and `ValidationServices` require their type
  arguments: `AnyV9ValidatableTransaction` and ledger-v9's `LedgerParameters` for what the defaults meant, or
  `AnyLedgerParameters` for block data read on either side of `forks.v9`.
- `makeDefaultProvingServiceEffect` and `makeDefaultProvingService` are removed. They were
  `makeV9ServerProvingServiceEffect` and `makeV9ServerProvingService` under another name.
- Renamed after the ledger version they build over: `makeWasmProvingServices` is `makeV9WasmProvingServices`,
  `makeSimulatorProvingServiceEffect` is `makeV9SimulatorProvingServiceEffect`, `makeSimulatorProvingService` is
  `makeV9SimulatorProvingService`, `./validation`'s `makeSimulatorBlockDataFetcher` is
  `makeV9SimulatorBlockDataFetcher`, and `./submission`'s `makeSimulatorSubmissionService` is
  `makeV9SimulatorSubmissionService`.
