---
'@midnight-ntwrk/wallet-sdk-facade': minor
---

Add `WalletFacade.validateTransaction` for pre-submission well-formedness checks. Validation logic lives in a new `ValidationService` (in `@midnight-ntwrk/wallet-sdk-capabilities/validation`); the facade method is a thin delegate.

The signature accepts an options bag — `validateTransaction(tx, { flags, blockData? })` — supporting `FinalizedTransaction`, `UnboundTransaction`, and `UnprovenTransaction`. Validation always uses real on-chain ledger parameters; if `blockData` is provided it is reused, otherwise the service fetches via the configured `fetchBlockData`. Recipes returned by balancing methods (`FinalizedTransactionRecipe`, `UnboundTransactionRecipe`, `UnprovenTransactionRecipe`) now expose an optional `blockData` field, carried through `signRecipe`, so callers can chain `balance → validate → submit` without a redundant fetch.

Errors are now typed: `WellFormedError` and `ValidationFetchError` (both `Data.TaggedError`), exported from the facade.

New `InitParams` factories:

- `validationService` — override the default validation service.
- `fetchBlockData` — override the default indexer-backed block-data fetcher (use `makeSimulatorBlockDataFetcher` for simulator-based tests).
