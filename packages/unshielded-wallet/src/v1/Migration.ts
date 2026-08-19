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
import { type NetworkId, ProtocolVersion, WalletSeed } from '@midnightntwrk/wallet-sdk-abstractions';
import { Effect, HashMap } from 'effect';
import { CoreWallet } from './CoreWallet.js';
import { type SyncProgressData } from './SyncProgress.js';
import { createKeystore, PublicKey } from './KeyStore.js';
import { UnshieldedState, UtxoWithMeta } from './UnshieldedState.js';
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
 *   UTXOs and a public key derived from a fixed placeholder seed; it is a scaffold to be replaced by a real start, not
 *   a wallet anybody can transact with. Preserved verbatim from the pre-fork implementation so that `startEmpty`
 *   behaves exactly as it did.
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
      CoreWallet.init(PublicKey.fromKeyStore(createKeystore(seed, configuration.networkId)), configuration.networkId),
    );
  },
});

/**
 * The migration between two variants that share this ledger version.
 *
 * @remarks
 *   Both sides speak the same state type, so the carry is the identity. This is the right strategy for a protocol bump
 *   that does not change serialization.
 * @returns A migration from a {@link CoreWallet} of this ledger version.
 */
export const makeCarryOverMigration = (): StateMigration<CoreWallet> => ({
  migrate: (previousState) => Effect.succeed(previousState),
});

/**
 * The shape a wallet of the _previous_ ledger version must expose to be carried across a hard fork.
 *
 * @remarks
 *   Structural on purpose. The previous variant's `CoreWallet` is built on a different ledger module, and naming that
 *   module here would drag a second multi-megabyte WASM binary into this variant for the sake of a type. That is
 *   affordable precisely because unshielded state is public: UTXOs are plain records of value, owner, token type,
 *   intent hash and output number, with no ledger object anywhere in them.
 *
 *   The verifying key is the one place the two ledger versions genuinely disagree, and it is described here as the
 *   previous version has it — a bare hex string.
 */
export type PreviousLedgerWallet = Readonly<{
  state: {
    // Effect `HashMap`s, as the previous variant really holds them — not arrays. The distinction matters and is easy
    // to get wrong: iterating a `HashMap` yields `[key, value]` entries, so a type that merely said `Iterable<UtxoLike>`
    // would be satisfied by the real state and then silently carry across a list of malformed pairs. `HashMap` is an
    // Effect type, not a ledger one, so naming it here keeps this description version-agnostic.
    readonly availableUtxos: HashMap.HashMap<string, UtxoLike>;
    readonly pendingUtxos: HashMap.HashMap<string, UtxoLike>;
  };
  publicKey: {
    readonly publicKey: string;
    readonly addressHex: string;
    readonly address: string;
  };
  networkId: string;
  protocolVersion: bigint;
  progress: SyncProgressData;
}>;

/** A UTXO of the previous ledger version, as plain data. */
export type UtxoLike = {
  readonly utxo: {
    readonly value: bigint;
    readonly owner: string;
    readonly type: string;
    readonly intentHash: string;
    readonly outputNo: number;
  };
  readonly meta: {
    readonly ctime: Date;
    readonly registeredForDustGeneration: boolean;
  };
};

/**
 * The migration across a ledger-version boundary: a structural carry of everything the wallet holds.
 *
 * @remarks
 *   Kept symmetric with the ledger-v9 tree so the seam has the same shape on both sides, though nothing precedes
 *   ledger-v8 in this SDK: here the carry is purely structural, with no key widening to perform, because this ledger
 *   version's verifying keys are already bare hex strings.
 *
 *   This is where unshielded parts company with shielded and dust. Those two start the new variant on a **fresh, empty**
 *   state and let the indexer's post-fork replay hand their coins back, because their coins are shielded: re-deriving
 *   them means decrypting events with secret keys that migration, by design, never receives. Unshielded has no such
 *   problem. Its UTXOs are public ledger data that the wallet holds as plain records, so they can simply be rebuilt on
 *   the other side — no replay to wait for, no keys required, and no window in which the wallet reports a zero balance
 *   it does not have.
 *
 *   So everything crosses: available and pending UTXOs field for field, the address, the network, and the protocol
 *   version that triggered the hand-over. The one transformation is the verifying key, which gains the scheme tag that
 *   ledger-v9 requires and ledger-v8 had no room for — the same widening the deserializer already performs on legacy
 *   snapshots, which is where the `schnorr` default comes from: ledger-v8 had exactly one signature scheme, so a key
 *   that reaches here can only have been a schnorr key.
 *
 *   Sync progress is carried **unchanged** — parked, not rewound and not advanced. The boundary transaction was observed
 *   and annotated but deliberately never applied, so the cursor still points just before it; the new variant re-fetches
 *   it from there and applies it exactly once. Rewinding to zero would re-apply history the wallet already holds;
 *   advancing past it would lose the boundary transaction outright.
 * @returns A migration from a previous-ledger-version wallet.
 */
export const makeCrossLedgerMigration = (): StateMigration<PreviousLedgerWallet> => ({
  migrate: (previousState) =>
    Effect.succeed(
      CoreWallet.restore(
        UnshieldedState.restore(
          Array.from(HashMap.values(previousState.state.availableUtxos), carryUtxo),
          Array.from(HashMap.values(previousState.state.pendingUtxos), carryUtxo),
        ),
        {
          publicKey: previousState.publicKey.publicKey,
          addressHex: previousState.publicKey.addressHex,
          address: previousState.publicKey.address,
        },
        {
          appliedId: previousState.progress.appliedId,
          highestTransactionId: previousState.progress.highestTransactionId,
        },
        ProtocolVersion.ProtocolVersion(previousState.protocolVersion),
        previousState.networkId,
      ),
    ),
});

/** Rebuilds a previous-version UTXO as one of this version's, field for field. */
const carryUtxo = (carried: UtxoLike): UtxoWithMeta =>
  new UtxoWithMeta({
    utxo: {
      value: carried.utxo.value,
      owner: carried.utxo.owner,
      type: carried.utxo.type,
      intentHash: carried.utxo.intentHash,
      outputNo: carried.utxo.outputNo,
    },
    meta: {
      ctime: carried.meta.ctime,
      registeredForDustGeneration: carried.meta.registeredForDustGeneration,
    },
  });
