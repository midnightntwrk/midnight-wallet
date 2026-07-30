---
'@midnightntwrk/wallet-sdk-indexer-client': major
---

feat(indexer-client): automate the GraphQL schema sync and bump to indexer v4.3.2 (#305)

A new `schema:sync` script keeps the committed schema (`indexer.gql`) and its generated types locked to a pinned
indexer release, replacing the manual copy that used to drift. The pinned schema is bumped to v4.3.2.

BREAKING CHANGE: the generated types are now produced by graphql-codegen's operation-scoped `client` preset, so the
package no longer re-exports bare schema types. Names like `Maybe`, `InputMaybe`, `Scalars`, and object types such as
`Block` and `TransactionResult` are no longer exported — use the operation types (e.g. `TransactionStatusQuery`)
instead.
