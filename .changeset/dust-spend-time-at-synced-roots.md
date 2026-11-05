---
'@midnightntwrk/wallet-sdk-dust-wallet': patch
'@midnightntwrk/wallet-sdk-facade': patch
---

fix(dust-wallet): date a Dust spend only at a block whose roots the wallet holds

Paying a fee with Dust no longer dates the spend at a block whose Dust events the wallet has not applied, which the
node rejected with `Custom error: 170`. Without a `currentTime`, `balanceTransactions` dates the spend at the newest
block when the wallet's Dust tree roots match that block's. A wallet on the event-less sync otherwise dates it at the
block its last pass verified, when that block is within the Dust grace period of the newest. When neither holds,
balancing reads the newest block again every second, reserving nothing, and after two minutes fails with
`SyncWalletError`, whose cause names the wallet's roots and the block's. A `currentTime` the caller passes is used at
once. When the newest block reports no roots at all, as the simulator's do, the spend is dated at it at once and a
warning is logged. The V1 variant's `BlockData` gains the optional `dustCommitmentMerkleTreeRoot` and
`dustGenerationMerkleTreeRoot` the indexer reports. The facade's balancing and transfer methods document the possible
wait.
