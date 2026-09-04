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
//
// The timeline the fork proof reads.
//
// A note on fidelity, because it is the honest difference between this proof and the shielded and dust ones. Those two
// must re-frame or re-mint real ledger `Event` bytes across the boundary, because their state is shielded and only the
// ledger can say whether the tree they rebuild is the tree the fork produced. Unshielded has no such indirection: what
// the indexer serves is public UTXO data as JSON, and what the wallet stores is that same data. So the timeline here IS
// the wire format — one shape, read by both variants, exactly as the indexer would serve it before and after the fork.
// Nothing is being modelled away; there is no ledger encoding in this path to be unfaithful to.
//
// What the timeline does model is the CURSOR, and that is the load-bearing part: items are served to whichever variant
// asks, filtered by the cursor that variant presents. The boundary item is therefore genuinely re-fetched by the second
// variant rather than handed to it.
import { NetworkId } from '@midnightntwrk/wallet-sdk-abstractions';
import { createKeystore as createPostForkKeystore, PublicKey as PostForkPublicKey } from '../KeyStore.js';
import { createKeystore as createPreForkKeystore, PublicKey as PreForkPublicKey } from '../v1/KeyStore.js';

/** One indexer message, with the protocol version the indexer reported it under. */
export type TimelineItem = {
  readonly id: number;
  readonly protocolVersion: number;
  /** Structurally a `WalletSyncUpdate` of either ledger version — the two are the same decoded JSON shape. */
  readonly update: unknown;
};

/** A fixed 32-byte secret, so both variants derive the same identity from it. */
export const forkSeed = (): Uint8Array => Uint8Array.from({ length: 32 }, (_, i) => (i * 13 + 5) % 256);

/** The pre-fork (ledger-v8) identity: a bare hex verifying key. */
export const preForkIdentity = (networkId: NetworkId.NetworkId = NetworkId.NetworkId.Undeployed): PreForkPublicKey =>
  PreForkPublicKey.fromKeyStore(createPreForkKeystore(forkSeed(), networkId));

/** The post-fork (ledger-v9) identity derived from the same secret: a `{tag, value}` verifying key. */
export const postForkIdentity = (networkId: NetworkId.NetworkId = NetworkId.NetworkId.Undeployed): PostForkPublicKey =>
  PostForkPublicKey.fromKeyStore(createPostForkKeystore({ kind: 'schnorr', secret: forkSeed() }, networkId));

/**
 * The same secret read under the other signature scheme, which only the post-fork ledger version has.
 *
 * @remarks
 *   Ledger-v8 has exactly one scheme, and its keys are bare hex with no room to name one — so an ecdsa identity is not
 *   merely inconvenient to represent pre-fork, it is unrepresentable. It derives a different address, too, which is why
 *   nothing about it can be narrowed to the pre-fork shape and back.
 */
export const ecdsaIdentity = (networkId: NetworkId.NetworkId = NetworkId.NetworkId.Undeployed): PostForkPublicKey =>
  PostForkPublicKey.fromKeyStore(createPostForkKeystore({ kind: 'ecdsa', secret: forkSeed() }, networkId));

/** The token every UTXO on this timeline carries. Deliberately not Night, which the wallet balances differently. */
export const timelineTokenType = '0100000000000000000000000000000000000000000000000000000000000000';

/** A UTXO as it appears on the wire, in the shape both variants decode it to. */
export type TimelineUtxo = {
  readonly utxo: {
    readonly value: bigint;
    readonly owner: string;
    readonly type: string;
    readonly intentHash: string;
    readonly outputNo: number;
  };
  readonly meta: { readonly ctime: Date; readonly registeredForDustGeneration: boolean };
};

/**
 * A UTXO addressed to `owner`, deterministic in every field so the two sides can be compared exactly.
 *
 * @remarks
 *   The intent hash is derived from `outputNo` as 32 bytes of hex rather than as a readable label, because a UTXO here is
 *   not only compared — it can also be _spent_, and the ledger decodes an intent hash before it will build an offer
 *   from one. A label would make a UTXO the wallet holds happily and can never transact with.
 */
export const timelineUtxo = (owner: string, value: bigint, outputNo: number): TimelineUtxo => ({
  utxo: {
    value,
    owner,
    type: timelineTokenType,
    intentHash: outputNo.toString(16).padStart(64, '0'),
    outputNo,
  },
  meta: {
    ctime: new Date(1_700_000_000_000 + outputNo * 1000),
    registeredForDustGeneration: false,
  },
});

/**
 * One transaction on the timeline, creating a single UTXO of `value`.
 *
 * @remarks
 *   `spentUtxos` is what makes a transaction the wallet _built_ observable as one the chain confirmed: the indexer
 *   reports a confirmation as the UTXOs it consumed alongside the ones it produced, and the wallet clears a booking by
 *   seeing its UTXO listed as spent. Omitted, the transaction is pure income, which is what most of the timeline is.
 */
export const timelineTransaction = (params: {
  readonly id: number;
  readonly protocolVersion: number;
  readonly owner: string;
  readonly value: bigint;
  readonly spentUtxos?: readonly TimelineUtxo[];
}): TimelineItem => ({
  id: params.id,
  protocolVersion: params.protocolVersion,
  update: {
    type: 'UnshieldedTransaction',
    transaction: {
      id: params.id,
      hash: `hash-${params.id}`,
      type: 'RegularTransaction',
      protocolVersion: params.protocolVersion,
      identifiers: [],
      block: {
        hash: `block-${params.id}`,
        height: params.id,
        timestamp: new Date(1_700_000_000_000 + params.id * 6000),
      },
      fees: { paidFees: 0n, estimatedFees: 0n },
      transactionResult: { status: 'SUCCESS', segments: [{ id: 1, success: true }] },
    },
    createdUtxos: [timelineUtxo(params.owner, params.value, params.id)],
    spentUtxos: params.spentUtxos ?? [],
    status: 'SUCCESS',
  },
});
