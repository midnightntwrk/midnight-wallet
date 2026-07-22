# @midnightntwrk/wallet-sdk-dust-fast-sync

Projections-based ("fast") synchronization for the Midnight dust wallet. Instead of replaying every ledger event, the
wallet state is recovered from indexer projections: dust generation events, nullifier-transaction lookups (with a
configurable anonymity set), and collapsed merkle-tree updates.

## Usage

Wire the sync service and capability into a dust wallet through the `V1Builder` sync seam:

```typescript
import { CustomDustWallet, V1Builder } from '@midnightntwrk/wallet-sdk-dust-wallet/v1';
import { makeEventLessSyncCapability, makeEventLessSyncService } from '@midnightntwrk/wallet-sdk-dust-fast-sync';

const FastSyncDustWallet = CustomDustWallet(
  { ...dustWalletConfig, dustKeySeed },
  new V1Builder().withDefaults().withSync(makeEventLessSyncService, makeEventLessSyncCapability),
);
```

`dustKeySeed` is the same seed the wallet is started with (`startWithSeed`). The sync re-derives the dust secret key
from it internally (see below) and fails with a `SyncWalletError` if it does not match the key passed to
`start`/`doSync`.

Drive the sync manually through the facade (`WalletFacade.start(keys, dustKey, /* manualSync */ true)` +
`WalletFacade.doSync(dustKey)`) or let it run in the background like the default sync.

## Why this package pins ledger `8.2.0-rc.1`

The projections sync needs ledger APIs that `@midnight-ntwrk/ledger-v8@8.1.0` does not have
(`DustGenerationTreeInsertionPath`, `DustLocalState.updateGenerationTreeFromEvidence`, `successorDustUtxo`,
`dustFirstNonce`, the `nullifiers`/`*TreeFirstFree` accessors). `8.2.0-rc.1` will likely never get a stable release —
these APIs land properly in ledger 9 — so the RC dependency is isolated here instead of forcing it on the whole SDK:

- The rest of the SDK (including `dust-wallet`) depends on `@midnight-ntwrk/ledger-v8@^8.1.0`.
- This package additionally depends on the RC under the npm alias `@midnight-ntwrk/ledger-v8-rc`.

That means **two copies of the ledger WASM module are loaded** when this package is used. wasm-bindgen instances cannot
cross module copies, so the boundary rules are:

- `DustLocalState` crosses as **serialized bytes** (`toRcState`/`toBaseState` in `StateOps.ts`); the serialization
  format is identical in `8.1.0` and `8.2.0-rc.1`.
- The dust secret key cannot be re-materialized from a `DustSecretKey` instance, so the rc-side key is **re-derived from
  `dustKeySeed`** in the sync configuration.
- Everything else that crosses the seam is plain data (`QualifiedDustOutput`, nullifiers/nonces as `bigint`s,
  `DustStateChanges` as plain objects).

When the SDK moves to a ledger version that contains these APIs natively, this package can drop the alias and the
bridging can be simplified away.
