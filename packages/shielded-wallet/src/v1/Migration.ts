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
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { type NetworkId, type SyncProgress, WalletSeed } from '@midnightntwrk/wallet-sdk-abstractions';
import { Effect } from 'effect';
import { CoreWallet, PublicKeys } from './CoreWallet.js';
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
 *   wallet anybody can transact with. Preserved verbatim from the ledger-v8 implementation so that `startEmpty` behaves
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
 *   progress all remain valid, and nothing has to be re-read. This is the right strategy for a protocol bump that does
 *   not change serialization.
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
 *   projection reads is plain data — the ledger's key and network types are all string aliases — so a structural
 *   description is both sufficient and the only version-agnostic option.
 *
 *   `progress` is where a migrated wallet resumes from: event ids continue across a fork rather than restarting, so the
 *   previous variant's cursor is the position the next one has to start at. Nothing ever fills this shape in practice —
 *   see {@link makeCrossLedgerMigration} for why this variant is never on the receiving end of a crossing.
 */
export type PreviousLedgerWallet = Readonly<{
  publicKeys: { readonly coinPublicKey: string; readonly encryptionPublicKey: string };
  networkId: string;
  protocolVersion: bigint;
  progress: SyncProgress.SyncProgressData;
}>;

/**
 * The migration across a ledger-version boundary: for this variant, shape parity and nothing else.
 *
 * @remarks
 *   This is the oldest variant the wallet registers, and no ledger version below the one it is built on exists to be
 *   registered under it. Nothing can therefore ever hand a state _to_ here: this seam is never exercised by a real
 *   chain. It exists because both twins declare the same builder surface, and a builder that could not name a
 *   cross-ledger migration would be a different type on each side of the fork.
 *
 *   The twin at `src/v2` is where a crossing actually happens, and it does something this one deliberately does not
 *   mirror. The chain's state translation carries every commitment across the fork in place — the ledger-v9 tree
 *   continues at the index the ledger-v8 tree reached, and the indexer re-emits none of the ledger-v8 timeline — so a
 *   wallet that started coinless there would simply lose its coins. That migration therefore reads the previous
 *   wallet's local state across whole, by handing its serialization to this ledger version's deserializer: the two
 *   majors either side of that boundary share the `zswap-local-state` codec (see `src/v2/Migration.ts` and
 *   `src/v2/test/byteCrossing.test.ts`). Porting that back here would be machinery for a case that cannot arise, so it
 *   stays out: a deliberate, permanent exclusion of the kind the twin convention allows for, not a gap left to close.
 *
 *   What crosses here is public keys, the network, the protocol version that triggered the hand-over, and the cursor.
 *   Sync progress is **parked at the fork** rather than rewound, on the rule that outlives the design change: event ids
 *   continue across a fork rather than restarting from zero, so the inherited cursor is exactly where reading resumes.
 *   A wallet that rewound to zero would wait on a stretch of the timeline this ledger version's events do not occupy.
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
      }),
    ),
});
