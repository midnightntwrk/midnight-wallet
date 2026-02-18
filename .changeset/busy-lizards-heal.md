---
'@midnight-ntwrk/wallet-sdk-unshielded-wallet': patch
---

Fix `rollbackSpendByUtxo` to handle missing UTXOs gracefully instead of throwing an error. This resolves a race condition between sync and revert operations where `rollbackSpendByUtxo` could be called on a UTXO that's no longer in the pending state. The function now returns the state unchanged when a UTXO is not found, consistent with the behavior of `rollbackSpend`. Additionally, updated return types to `Either.Either<UnshieldedState, never>` for both `rollbackSpend` and `rollbackSpendByUtxo` to accurately reflect that these functions never return errors.
