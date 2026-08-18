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

/**
 * The indexer's post-fork replay, modelled as a chain — test scaffolding only.
 *
 * @remarks
 *   After the hard fork the indexer replays the timeline: the history a wallet already synced is served again, this time
 *   as events of the new ledger version. That is why a migrated wallet starts empty and simply syncs — it re-discovers
 *   its own coins from the replay rather than carrying them across.
 *
 *   Nothing simulates an indexer, so the replay is modelled with the thing the wallet's simulator sync path already
 *   consumes: a second chain that re-creates every pre-fork commitment as a post-fork transaction. A coin commitment is
 *   a function of the coin and its owner's public key alone, so re-paying _the same_ coin — same token type, same
 *   nonce, same value, same recipient — reproduces the pre-fork commitment exactly. Replay the whole pre-fork sequence
 *   in order and the resulting tree is the pre-fork tree, which is precisely what the integration proof checks against
 *   the ledger team's real v8-to-v9 translation.
 *
 *   Two modelling choices are load-bearing and deliberate:
 *
 *   - **The replayed chain continues the pre-fork chain's numbering.** Block numbers stand in for the indexer's event ids,
 *       and the indexer numbers its replay onwards from whatever id it had reached when the fork happened — never from
 *       zero. So the replay opens at the boundary height, the same convention the {@link ForkSimulator}'s own post-fork
 *       chain follows, and a migrated wallet parks its cursor there and meets the replay head-on. This is the half of
 *       the design that is behaviourally load-bearing in the harness: number the replay from zero while the migration
 *       parks and every replayed event falls behind the cursor, leaving the wallet with nothing. (The mirror image is
 *       not symmetric — a cursor behind the replay reads all of it anyway — so what separates parking from resetting is
 *       the migrated cursor itself, asserted where the migration produced it.)
 *   - **Every replayed block carries the post-fork protocol version**, the genesis one included. That block sits at the
 *       boundary height, which the pre-fork variant observed, annotated and deliberately left unapplied; re-delivering
 *       it as post-fork content is what hands that height to the new variant. Tagging the whole replay inside the new
 *       variant's activation range is what keeps any of it from being deferred back to a variant that has already
 *       handed over.
 *
 *   The chain the _ledger_ continues as is a different object: the {@link ForkSimulator}'s post-fork side, which holds the
 *   translated state and announces nothing. Sync reads the replay; spends are validated against the translation.
 */

import * as v8 from '@midnight-ntwrk/ledger-v8';
import * as v9 from '@midnightntwrk/ledger-v9';
import { type NetworkId, type ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { type BlockProducer, Simulator, type SimulatorState } from '@midnightntwrk/wallet-sdk-capabilities/simulation';
import { type LedgerOps } from '@midnightntwrk/wallet-sdk-utilities';
import { Effect, type Scope } from 'effect';

/** Public keys as both ledger versions express them: hex strings, identical for identical seeds. */
export type Recipient = Readonly<{ coinPublicKey: string; encryptionPublicKey: string }>;

/**
 * One coin, as it exists on the pre-fork chain and again in the replay.
 *
 * @remarks
 *   The nonce is sampled once, by the pre-fork ledger, and then reused verbatim: that is what makes the replayed
 *   commitment the pre-fork commitment rather than merely a commitment of the same value.
 */
export type ReplayedCoin = Readonly<{
  type: string;
  nonce: string;
  value: bigint;
  recipient: Recipient;
}>;

/** Samples a coin of `value` for `recipient`, using the pre-fork ledger's own nonce sampling. */
export const mintable = (tokenType: string, value: bigint, recipient: Recipient): ReplayedCoin => {
  const sampled = v8.createShieldedCoinInfo(tokenType, value);
  return { type: sampled.type, nonce: sampled.nonce, value: sampled.value, recipient };
};

/** The pre-fork transaction that creates `coin`: one output, therefore one commitment, therefore one Merkle index. */
export const preForkPayment = (networkId: NetworkId.NetworkId, coin: ReplayedCoin): v8.ProofErasedTransaction => {
  const output = v8.ZswapOutput.new(
    { type: coin.type, nonce: coin.nonce, value: coin.value },
    0,
    coin.recipient.coinPublicKey,
    coin.recipient.encryptionPublicKey,
  );
  const offer = v8.ZswapOffer.fromOutput<v8.PreProof>(output, coin.type, coin.value);
  return v8.Transaction.fromParts(networkId, offer).eraseProofs();
};

/** The replayed transaction for `coin` — the same coin, re-announced by the post-fork ledger version. */
export const replayPayment = (networkId: NetworkId.NetworkId, coin: ReplayedCoin): v9.ProofErasedTransaction => {
  const output = v9.ZswapOutput.new(
    { type: coin.type, nonce: coin.nonce, value: coin.value },
    0,
    coin.recipient.coinPublicKey,
    coin.recipient.encryptionPublicKey,
  );
  const offer = v9.ZswapOffer.fromOutput<v9.PreProof>(output, coin.type, coin.value);
  return v9.Transaction.fromParts(networkId, offer).eraseProofs();
};

export type ReplayChainConfig = Readonly<{
  networkId: NetworkId.NetworkId;
  /** The version the post-fork variant is registered at: every replayed block must sit inside its range. */
  protocolVersion: ProtocolVersion.ProtocolVersion;
  /**
   * The boundary height — the replay continues the pre-fork chain's numbering rather than restarting it.
   *
   * Block numbers stand in for the indexer's event ids here, and the indexer's replay counts on from the id it had
   * reached at the fork. This is therefore where a migrated wallet's parked cursor expects to find it.
   */
  genesisBlockNumber: bigint;
  /** The pre-fork chain's clock at the boundary — the replay continues time rather than restarting it. */
  genesisTime: Date;
  blockProducer: BlockProducer;
  /** Every pre-fork commitment, in the order the pre-fork chain created them. */
  coins: readonly ReplayedCoin[];
}>;

/**
 * Builds the replayed post-fork timeline: one block per replayed coin, in pre-fork order.
 *
 * @remarks
 *   Submitted one at a time and awaited, so each transaction gets a block of its own and the commitments land in exactly
 *   the order they did before the fork. Batching them would leave the within-block ordering to the block producer, and
 *   the Merkle indices are the whole point.
 * @param config The network, the post-fork version, the inherited numbering and clock, the producer and the coins to
 *   replay.
 * @returns The chain, once every coin has been re-announced.
 */
export const makeReplayChain = (
  config: ReplayChainConfig,
): Effect.Effect<Simulator, LedgerOps.LedgerError, Scope.Scope> =>
  Effect.gen(function* () {
    const chain = yield* Simulator.init({
      networkId: config.networkId,
      protocolVersion: config.protocolVersion,
      // The fork height, not zero: see the file's remarks — this is an event-id cursor, and the replay counts on from
      // where the fork found it.
      genesisBlockNumber: config.genesisBlockNumber,
      genesisTime: config.genesisTime,
      blockProducer: config.blockProducer,
    });

    yield* Effect.forEach(config.coins, (coin) => chain.submitTransaction(replayPayment(config.networkId, coin)), {
      discard: true,
    });

    return chain;
  });

/** The Merkle root of a chain's commitment tree, read through a local state — the chain state does not expose one. */
export const chainMerkleRoot = (chain: v9.ZswapChainState): bigint | undefined =>
  chain.firstFree === 0n
    ? new v9.ZswapLocalState().merkleTreeRoot
    : new v9.ZswapLocalState().applyCollapsedUpdate(new v9.MerkleTreeCollapsedUpdate(chain, 0n, chain.firstFree - 1n))
        .merkleTreeRoot;

/** The commitment tree of a simulated chain, as a root. */
export const simulatedChainRoot = (state: SimulatorState): bigint | undefined => chainMerkleRoot(state.ledger.zswap);
