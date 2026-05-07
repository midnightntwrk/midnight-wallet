---
'@midnight-ntwrk/wallet-sdk-facade': minor
---

Add `WalletFacade.validateTransaction` for pre-submission well-formedness checks. Exposes `WellFormedError` and `WellFormedStrictnessFlags` so callers can validate any transaction type (`FinalizedTransaction`, `UnboundTransaction`, `UnprovenTransaction`) with configurable strictness before calling submit or balance methods. The method is async; when `enforceBalancing` is `true` it fetches the latest on-chain ledger parameters via the dust wallet, otherwise it uses the initial parameters.
