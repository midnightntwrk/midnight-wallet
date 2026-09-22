---
'@midnightntwrk/wallet-sdk-shielded': patch
---

fix(shielded): reject a reordered event batch instead of applying it

Addresses the Least Authority audit suggestion "Handle Sync Updates Defensively" (25 March 2026) for the shielded
wallet's event sync. After dropping the boundary event the inclusive cursor re-delivers, a batch must arrive in strictly
ascending id order. A batch with an id at or below its predecessor, or at or below the cursor, is refused whole with the
new tagged `OutOfOrderSyncUpdateError` (`Wallet.OutOfOrderSyncUpdate`, carrying `expected` and `received`): nothing in
it is applied and the cursor does not move. The running variant logs the error and retries from the same cursor.

Only order is checked, never contiguity: in the indexer, zswap events share one id sequence with dust and contract
events, so gaps in a zswap stream are normal. A skipped commitment-inserting event is still caught by the ledger's own
insertion check. Applies to both the V1 and V2 variants.
