---
'@midnightntwrk/wallet-sdk-unshielded-wallet': patch
---

fix(unshielded): reject out-of-order sync updates and unknown spends instead of applying them

Addresses the Least Authority audit suggestion "Handle Sync Updates Defensively" (25 March 2026) for the unshielded
wallet. The sync capability now classifies every delivered transaction against the applied cursor before touching
state:

- an id below the cursor is refused with the new tagged `OutOfOrderSyncUpdateError` (`Wallet.OutOfOrderSyncUpdate`,
  carrying `expected` and `received`);
- an id equal to the cursor is a re-delivered boundary transaction and a no-op: no UTXO change, no cursor move, no
  transaction-history write;
- a spend of a UTXO the wallet holds neither as available nor as pending is refused (`UtxoNotFoundError`, wrapped in
  `ApplyTransactionError`) instead of being silently ignored, on the success and the failure path alike, so a spend
  delivered ahead of its create can no longer leave the UTXO available.

On refusal the state and cursor are left untouched; the running variant logs the error and retries from the same
cursor. Applies to both the V1 and V2 variants.
