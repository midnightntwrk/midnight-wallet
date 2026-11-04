---
'@midnightntwrk/wallet-sdk-indexer-client': minor
---

Additions since 1.x

- New operations: `ZswapEventTip` and `DustLedgerEventTip`, which read only the newest event id, for watching the
  chain's protocol version, and `DustNullifierTransactions`, `DustGenerationEvents` (its types are named
  `DustGenerations*`) and `DustCommitmentMerkleTreeUpdate`, which the Dust wallet's projections sync uses; each comes
  with its document and result types. `BlockHash` returns the block's `protocolVersion`, its zswap and Dust end indices
  and the two Dust Merkle roots; `DustLedgerEvents` and the unshielded transactions' progress frame carry
  `protocolVersion`; `TransactionHistoryDetail` returns the block hash and height, the transaction's identifiers and its
  paid fees, and unshielded transactions their block hash and height.
- Subscriptions negotiate the indexer's `graphql-transport-ws+deflate` subprotocol and inflate the compressed frames,
  falling back to plain `graphql-transport-ws` against an indexer that does not offer it. There is nothing to configure.
