---
'@midnightntwrk/wallet-sdk': major
---

Breaking changes since 1.x

Hard-fork support: the wallets run `@midnight-ntwrk/ledger-v8` below the chain's `forks.v9` and
`@midnightntwrk/ledger-v9` from it, and follow a live chain across that boundary, carrying balances, coins and
transaction history over. This package re-exports the others, so their breaking changes reach it; the most visible are:

- Wallets and the facade start from seeds (`WalletSeeds.fromMasterSeed`) or from each ledger version's keys, and no
  transacting method takes secret keys.
- Transactions are `WalletTransaction` handles that carry the protocol version they were built for. Build your own with
  `./ledger/v8` or `./ledger/v9`, and seal them with `WalletTransaction.adopt`.
- Signers are asynchronous (`SignSegment`), and keys and signatures are tagged `{ tag, value }` objects.
- `FacadeState.pending` and the pending-transactions service are replaced by one lifecycle record per transaction:
  `FacadeState.lifecycle` and `facade.transactionLifecycleService`.
- `FacadeState.isSynced` and `waitForSyncedState()` also wait for the indexer's reported tip to be checked against a
  node's finalized head, and keep waiting while the check finds the indexer behind the node or on another network.
- `Roles.Metadata` is now `Roles.EcdsaUnshielded`.

The `@midnightntwrk/wallet-sdk-facade` notes carry the migration guide, and each package's notes list its own changes.
In this package itself:

- `./capabilities/pendingTransactions` is now `./capabilities/transactionLifecycle`, with no alias.
- `Capabilities.Simulator` and its helpers are now under `Capabilities.V8`, beside ledger-v9's under `Capabilities.V9`.
  Likewise the `./capabilities/simulation` subpath exports `V8`, `V9` and `ForkSimulator` in place of the unqualified
  `Simulator`, `SimulatorConfig`, `immediateBlockProducer` and the other helpers.
- It depends on `@midnight-ntwrk/ledger-v8` `^8.1.0` and `@midnightntwrk/ledger-v9` `1.0.0-rc.7`, and on its sibling
  packages at exact versions.
