---
'@midnightntwrk/wallet-sdk-indexer-client': major
---

Breaking changes since 1.x

- The generated GraphQL types are scoped to the operations the client runs: the bare schema types are no longer exported
  (87 names, among them `Maybe`, `InputMaybe`, `Scalars`, `Exact`, object types such as `Block`, `Transaction` and
  `TransactionResult`, and the `Query*Args` and `Subscription*Args` types). Use the operation types, such as
  `TransactionStatusQuery`, instead.
- The transaction unions in `TransactionStatusQuery`, `TransactionHistoryDetailQuery` and
  `UnshieldedTransactionsSubscription` gain a `BridgeClaimTransaction` member, so an exhaustive match on `__typename` or
  `type` must handle it.
- The client is generated from a newer indexer schema and selects fields an older indexer does not serve, among them
  `protocolVersion` on the unshielded transactions' progress frame. The SDK is tested against indexer `4.4.0-rc.6`.
- Depends on `graphql` `^17` (was `^16`), and on `fflate` for subscription compression.
