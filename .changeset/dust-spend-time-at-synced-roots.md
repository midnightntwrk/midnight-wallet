---
'@midnightntwrk/wallet-sdk-dust-wallet': patch
---

fix(dust-wallet): date a Dust spend only at a block whose roots the wallet holds

Paying a fee with Dust no longer dates the spend at a block whose Dust events the wallet has not applied, which the
node rejected with `Custom error: 170`. Without a `currentTime`, `balanceTransactions` dates the spend at the newest
block only once the wallet's Dust tree roots match that block's. Until then it reads the newest block again every
second, and after two minutes it fails with `SyncWalletError`. A `currentTime` the caller passes is used as it is, and
so is a block that reports no roots. The V1 variant's `BlockData` gains the optional `dustCommitmentMerkleTreeRoot` and
`dustGenerationMerkleTreeRoot` the indexer reports.
