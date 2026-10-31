---
'@midnightntwrk/wallet-sdk-capabilities': major
'@midnightntwrk/wallet-sdk-facade': major
'@midnightntwrk/wallet-sdk': major
'@midnightntwrk/wallet-sdk-dust-wallet': patch
---

refactor(capabilities)!: name the ledger version of every proving and validation type and backend

The proving and validation types no longer default to ledger-v9's, and every factory that builds over one ledger version
says which. A prover over one ledger version is no longer accepted where either ledger version's transactions may reach
it. Both ledger versions declare `LedgerParameters` identically, so the compiler cannot tell them apart: each validator
now refuses the other ledger version's parameters with `LedgerParametersMismatchError` rather than reporting the
transaction as malformed. `DustWallet.balanceTransactions` types its block data's parameters as either ledger version's.

Added to `./proving`: `V9UnprovenTransaction`, `V9ProvingServiceEffect`, `V9ProvingService`, `V8ProvingService`,
`makeV8SimulatorProvingServiceEffect` and `makeV8SimulatorProvingService`; to `./validation`:
`LedgerParametersMismatchError`, `ValidationFailure` and `LedgerParametersReader`; to `./submission`:
`AnyVersionFinalizedTransaction`. The facade re-exports `AnyLedgerParameters`, `AnyVersionValidatableTransaction` and
`LedgerParametersMismatchError`.

BREAKING CHANGE:

- `ProvingServiceEffect`, `ProvingService`, `VersionedProvingServiceEffect`, `VersionedProvingService` and
  `ProvingServices` require the unproven transaction they accept, and check it contravariantly: a prover over one ledger
  version is not one over both. `InitParams.provingService` takes a prover over both; to prove with one ledger version's
  backend, name it in `provers` (`{ v9: { kind: 'wasm' } }`).
- `BlockData`, `ValidateTxOptions`, `ValidationServiceDependencies`, `ValidationServiceEffect`, `ValidationService`,
  `VersionedValidationServiceEffect`, `VersionedValidationService` and `ValidationServices` require their type
  arguments. `makeValidationServiceEffect` takes a `LedgerParametersReader` before its dependencies.
- `makeV9WasmProvingServices` is typed as a registry over both ledger versions, and refuses a ledger-v8 transaction in
  its range with `ProvingEpochMismatchError` rather than handing it to ledger-v9.
- `makeDefaultSubmissionService` and `makeDefaultSubmissionServiceEffect` submit `AnyVersionFinalizedTransaction` when no
  transaction type is named, so an unproven or unbound transaction no longer compiles.
- `makeDefaultProvingServiceEffect` and `makeDefaultProvingService` are removed: use `makeV9ServerProvingServiceEffect`
  and `makeV9ServerProvingService`.
- Renamed after their ledger version: `makeWasmProvingServices` → `makeV9WasmProvingServices`,
  `makeSimulatorProvingService(Effect)` → `makeV9SimulatorProvingService(Effect)`, `makeSimulatorBlockDataFetcher` →
  `makeV9SimulatorBlockDataFetcher`, `makeSimulatorSubmissionService` → `makeV9SimulatorSubmissionService` and
  `SimulatorSubmissionConfiguration` → `V9SimulatorSubmissionConfiguration`.
