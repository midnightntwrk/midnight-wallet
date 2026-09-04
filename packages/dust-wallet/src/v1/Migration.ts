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
import { type DustParameters, DustSecretKey } from '@midnight-ntwrk/ledger-v8';
import { type SyncProgress, WalletSeed } from '@midnightntwrk/wallet-sdk-abstractions';
import { Effect } from 'effect';
import { CoreWallet } from './CoreWallet.js';
import { type NetworkId } from './types/ledger.js';
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
  networkId: NetworkId;
  /**
   * The dust parameters the fresh state is built on.
   *
   * @remarks
   *   Dust's local state is parameterised where shielded's is not: generation and decay rates live on the state itself,
   *   so there is no such thing as a parameterless empty dust wallet.
   */
  dustParameters: DustParameters;
};

/**
 * The migration used when there is no previous wallet at all.
 *
 * @remarks
 *   It backs `WalletLike.startEmpty`, which builds a wallet before any key material exists. The resulting state holds no
 *   dust and has a public key derived from a fixed placeholder seed; it is a scaffold to be replaced by a real start,
 *   not a wallet anybody can pay fees with.
 * @example
 *   ```typescript
 *   const builder = new V1Builder().withDefaults().withMigration(makeEmptyWalletMigration({ networkId, dustParameters }));
 *   ```;
 *
 * @param configuration Supplies the network the scaffold state claims to be on, and the dust parameters it uses.
 * @returns A migration from `null`.
 */
export const makeEmptyWalletMigration = (configuration: EmptyWalletMigrationConfiguration): StateMigration<null> => ({
  migrate: () => {
    const seed = WalletSeed.fromString('0000000000000000000000000000000000000000000000000000000000000001');
    return Effect.succeed(
      CoreWallet.initEmpty(configuration.dustParameters, DustSecretKey.fromSeed(seed), configuration.networkId),
    );
  },
});

/**
 * The migration between two variants that share this ledger version.
 *
 * @remarks
 *   Both sides speak the same state type, so the carry is the identity: the generation and commitment trees, the dust
 *   UTXOs and sync progress all remain valid. This is the right strategy for a protocol bump that does not change
 *   serialization.
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
 *   projection reads is plain data — the dust public key is a `bigint` and the network id a string — so a structural
 *   description is both sufficient and the only version-agnostic option.
 *
 *   `progress` is where the migrated wallet resumes from: the replayed timeline continues the indexer's event ids rather
 *   than restarting them, so the previous variant's cursor is the position the next one has to start at (see
 *   {@link makeCrossLedgerMigration}).
 */
export type PreviousLedgerWallet = Readonly<{
  publicKey: { readonly publicKey: bigint };
  networkId: string;
  protocolVersion: bigint;
  progress: SyncProgress.SyncProgressData;
}>;

export type CrossLedgerMigrationConfiguration = {
  /**
   * This ledger version's dust parameters.
   *
   * @remarks
   *   Supplied rather than carried, and this is where dust departs from shielded. `DustLocalState` is parameterised by
   *   the ledger's dust parameters, and those are a WASM object belonging to whichever ledger module produced them —
   *   the previous variant's copy cannot be handed to this one, and its values need not even still be current.
   */
  dustParameters: DustParameters;
};

/**
 * The migration across a ledger-version boundary: a dustless state of this version, carrying identity and position.
 *
 * @remarks
 *   The indexer replays the timeline after the hard fork, re-emitting the wallet's history as events of the new ledger
 *   version. A migrated wallet therefore does not need — and must not attempt — to carry its dust: exactly the same
 *   dust is generated again by ordinary sync, from the replayed registration events, and valued against this version's
 *   parameters. Carrying it across as well would double-count what the replay is about to deliver, on top of requiring
 *   generation and commitment trees that this ledger's WASM module cannot read.
 *
 *   So what crosses is the dust public key, the network, the protocol version that triggered the hand-over, and the
 *   cursor. Sync progress is **parked at the fork** rather than rewound: the indexer numbers the replayed events
 *   onwards from whatever id it had reached when the fork happened, never from zero, so the inherited cursor is exactly
 *   where the replay begins. A wallet that rewound to zero would wait on a stretch of the timeline this ledger
 *   version's events do not occupy.
 *
 *   If the ledger team ships a byte-level translation for wallet local state, it replaces this instance without touching
 *   anything around it — that is the point of the {@link StateMigration} seam.
 * @param configuration Supplies this ledger version's dust parameters for the fresh state.
 * @returns A migration from a previous-ledger-version wallet.
 */
export const makeCrossLedgerMigration = (
  configuration: CrossLedgerMigrationConfiguration,
): StateMigration<PreviousLedgerWallet> => ({
  migrate: (previousState) =>
    Effect.succeed(
      CoreWallet.fromPreviousVersion({
        publicKey: { publicKey: previousState.publicKey.publicKey },
        networkId: previousState.networkId,
        protocolVersion: previousState.protocolVersion,
        progress: previousState.progress,
        dustParameters: configuration.dustParameters,
      }),
    ),
});
