---
'@midnightntwrk/wallet-sdk-dust-wallet': patch
---

fix(dust): reject a gapped or reordered event batch instead of applying it

Addresses the Least Authority audit suggestion "Handle Sync Updates Defensively" (25 March 2026) for the Dust wallet's
event sync. After dropping the boundary event the inclusive cursor re-delivers, a batch must run consecutively from
`appliedIndex + 1`. A batch that opens past a gap or has a hole inside it is refused whole with the new tagged
`OutOfOrderSyncUpdateError` (`Wallet.OutOfOrderSyncUpdate`, carrying `expected` and `received`): nothing in it is
applied and the cursor does not move. The running variant logs the error and retries from the same cursor, so a
transient reorder heals itself and a persistent one becomes a visible, repeating failure instead of a Dust commitment
tree that has silently run past events. Applies to both the V1 and V2 variants; the projections sync path is unchanged.
