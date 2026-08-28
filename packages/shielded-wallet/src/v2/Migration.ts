// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
// http://www.apache.org/licenses/LICENSE-2.0
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
import * as ledger from '@midnightntwrk/ledger-v9';
import { type NetworkId, type SyncProgress, WalletSeed } from '@midnightntwrk/wallet-sdk-abstractions';
import { Array as EArray, Effect, Order, pipe } from 'effect';
import { type CarriedCoin, CoreWallet, PublicKeys } from './CoreWallet.js';
import { type WalletError } from './WalletError.js';

/**
 * How this variant produces its first state from whatever came before it.
 *
 * @remarks
 *   The strategy is injected through the builder rather than hard-coded into the variant, because "whatever came before"
 *   is not one thing: an empty wallet at first start, a wallet of this same ledger version, or a wallet of the ledger
 *   version this one replaced. Those are different functions with different input types, and the runtime only ever
 *   needs one of them per registration — so which one is a build-time decision, expressed as a dictionary in the
 *   repository's usual dictionary-passing style.
 * @typeParam TPreviousState The state this migration consumes.
 */
export type StateMigration<TPreviousState> = {
  migrate: (previousState: TPreviousState) => Effect.Effect<CoreWallet, WalletError>;
};

export type EmptyWalletMigrationConfiguration = {
  networkId: NetworkId.NetworkId;
};

/**
 * The migration used when there is no previous wallet at all.
 *
 * @remarks
 *   It backs `WalletLike.startEmpty`, which builds a wallet before any key material exists. The resulting state has no
 *   coins and public keys derived from a fixed placeholder seed; it is a scaffold to be replaced by a real start, not a
 *   wallet anybody can transact with. Preserved verbatim from the pre-fork implementation so that `startEmpty` behaves
 *   exactly as it did.
 * @example
 *   ```typescript
 *   const builder = new V2Builder().withDefaults().withMigration(makeEmptyWalletMigration({ networkId }));
 *   ```;
 *
 * @param configuration Supplies the network the scaffold state claims to be on.
 * @returns A migration from `null`.
 */
export const makeEmptyWalletMigration = (configuration: EmptyWalletMigrationConfiguration): StateMigration<null> => ({
  migrate: () => {
    const seed = WalletSeed.fromString('0000000000000000000000000000000000000000000000000000000000000001');
    return Effect.succeed(
      CoreWallet.empty(PublicKeys.fromSecretKeys(ledger.ZswapSecretKeys.fromSeed(seed)), configuration.networkId),
    );
  },
});

/**
 * The migration between two variants that share this ledger version.
 *
 * @remarks
 *   Both sides speak the same state type, so the carry is the identity: local Merkle tree, coins, coin hashes and sync
 *   progress all remain valid, and there is nothing to re-anchor. This is the right strategy for a protocol bump that
 *   does not change serialization.
 * @returns A migration from a {@link CoreWallet} of this ledger version.
 */
export const makeCarryOverMigration = (): StateMigration<CoreWallet> => ({
  migrate: (previousState) => Effect.succeed(previousState),
});

/**
 * The shape a wallet of the _previous_ ledger version must expose to be projected across a hard fork.
 *
 * @remarks
 *   Structural on purpose. The previous variant's `CoreWallet` is built on a different ledger module, and naming that
 *   module here would drag a second multi-megabyte WASM binary into this variant for the sake of a type. Everything the
 *   projection reads is plain data — the ledger's key and network types are all string aliases, and its
 *   `QualifiedShieldedCoinInfo` is a bare record of strings and bigints — so a structural description is both
 *   sufficient and the only version-agnostic option. That goes for `state` too: it names exactly the two members of the
 *   previous ledger's `ZswapLocalState` the projection reads — the set of unspent coins and `firstFree`, the size the
 *   commitment tree had reached — which that ledger's own state object satisfies as it is. The values behind the
 *   description may live in WASM; the projection copies them out eagerly and keeps no reference (see
 *   {@link makeCrossLedgerMigration}).
 *
 *   `progress` is where the migrated wallet resumes from: the post-fork timeline continues the indexer's event ids rather
 *   than restarting them, so the previous variant's cursor is the position the next one has to start at (see
 *   {@link makeCrossLedgerMigration}).
 */
export type PreviousLedgerWallet = Readonly<{
  publicKeys: { readonly coinPublicKey: string; readonly encryptionPublicKey: string };
  networkId: string;
  protocolVersion: bigint;
  progress: SyncProgress.SyncProgressData;
  state: Readonly<{
    coins: ReadonlySet<Readonly<{ type: string; nonce: string; value: bigint; mt_index: bigint }>>;
    firstFree: bigint;
  }>;
}>;

/**
 * The migration across a ledger-version boundary: identity, position, and the coins flattened to plain data.
 *
 * @remarks
 *   The chain's state translation carries every commitment across the fork in place — the post-fork tree continues at the
 *   index the pre-fork tree reached, and the indexer does **not** replay the pre-fork timeline as new-version events.
 *   So the coins must cross with the wallet, or they are gone. What migration cannot do is carry them as a ledger
 *   state: the previous version's serialized local state is unreadable here, and rebuilding a Merkle tree takes the
 *   secret keys — coins are indexed by nullifier — which migration by design does not hold.
 *
 *   The projection therefore flattens each coin to a {@link CarriedCoin} — nothing but strings and bigints, copied out
 *   **eagerly** so no reference to the previous ledger's WASM-backed state or its collections survives the crossing —
 *   sorted by Merkle index, together with the tree size the gaps will be measured against. `CoreWallet.anchor`, run by
 *   the sync layer that does hold the keys, is what folds that payload back into a local state before any post-fork
 *   event is applied.
 *
 *   Sync progress is **parked at the fork** rather than rewound: the indexer numbers post-fork events onwards from
 *   whatever id it had reached when the fork happened, never from zero, so the inherited cursor is exactly where this
 *   wallet's reading resumes. A wallet that rewound to zero would wait on a stretch of the timeline this ledger
 *   version's events do not occupy.
 *
 *   If the ledger team ships a byte-level translation for wallet local state, it replaces this instance without touching
 *   anything around it — that is the point of the {@link StateMigration} seam.
 * @returns A migration from a previous-ledger-version wallet.
 */
export const makeCrossLedgerMigration = (): StateMigration<PreviousLedgerWallet> => ({
  migrate: (previousState) =>
    Effect.succeed(
      CoreWallet.fromPreviousVersion({
        publicKeys: previousState.publicKeys,
        networkId: previousState.networkId,
        protocolVersion: previousState.protocolVersion,
        progress: previousState.progress,
        pendingAnchor: {
          coins: pipe(
            [...previousState.state.coins],
            EArray.map((coin) => ({ type: coin.type, nonce: coin.nonce, value: coin.value, mtIndex: coin.mt_index })),
            EArray.sort(Order.mapInput(Order.bigint, (coin: CarriedCoin) => coin.mtIndex)),
          ),
          treeSize: previousState.state.firstFree,
        },
      }),
    ),
});
