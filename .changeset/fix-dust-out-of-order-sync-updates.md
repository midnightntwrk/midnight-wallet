---
'@midnightntwrk/wallet-sdk-dust-wallet': patch
---

fix(dust): reject a reordered event batch instead of applying it

Addresses the Least Authority audit suggestion "Handle Sync Updates Defensively" (25 March 2026) for the Dust wallet's
event sync. After dropping the boundary event the inclusive cursor re-delivers, a batch must arrive in strictly
ascending id order. A batch with an id at or below its predecessor, or at or below the cursor, is refused whole with the
new tagged `OutOfOrderSyncUpdateError` (`Wallet.OutOfOrderSyncUpdate`, carrying `expected` and `received`): nothing in
it is applied and the cursor does not move. The running variant logs the error and retries from the same cursor.

Only order is checked, never contiguity: in the indexer, dust events share one id sequence with zswap and contract
events, so gaps in a dust stream are normal. A skipped commitment-inserting event is still caught by the ledger's own
insertion check. Applies to both the V1 and V2 variants; the projections sync path is unchanged.
