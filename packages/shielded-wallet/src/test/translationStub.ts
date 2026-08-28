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
 * The chain a fork leaves behind, for the tier that has no ledger translation to hand — test scaffolding only.
 *
 * @remarks
 *   A hard fork does not re-announce anything. The chain's state translation carries every commitment across in place:
 *   the post-fork chain opens holding the tree the pre-fork chain ended with, continues inserting at the index that
 *   tree reached, and the indexer numbers its events onwards from where it had got to. Nothing about the pre-fork
 *   timeline is served a second time — which is why a wallet crossing the boundary has to carry its coins and re-anchor
 *   them, and why these suites are built around a post-fork chain that announces **nothing**.
 *
 *   `ForkSimulator` already models that chain; what it needs is a {@link LedgerStateTranslator}, and the real one is a
 *   WASM artifact that only the integration tier builds. {@link translationStub} stands in for it here. It cannot read
 *   the pre-fork bytes it is handed — no ledger version can deserialize another's state — so it reconstructs the answer
 *   instead: a coin commitment is a function of the coin and its owner's public key alone, so re-paying _the same_
 *   coins — same token type, same nonce, same value, same recipients, same order — on a throwaway post-fork chain
 *   reproduces the pre-fork tree exactly, commitment for commitment. That chain's ledger is the translation's output.
 *   The re-payments are an internal construction detail and never reach any wallet: what leaves this module is a ledger
 *   state, which `ForkSimulator` installs in the post-fork chain's genesis block. `forkSimulation.integration.test.ts`
 *   swaps in the ledger team's real translation and asserts the same claims, which is what makes the substitution
 *   honest.
 *
 *   {@link makePayingPostForkChain} is the other post-fork chain a fork suite needs, and a different thing entirely: an
 *   ordinary chain that pays coins out after the fork, for wallets that _start_ past the boundary rather than cross it
 *   and so have nothing to carry.
 */

import * as v8 from '@midnight-ntwrk/ledger-v8';
import * as v9 from '@midnightntwrk/ledger-v9';
import { type NetworkId, type ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import {
  type BlockProducer,
  LedgerTranslationError,
  type LedgerStateTranslator,
  Simulator,
  type SimulatorState,
  genesisStrictness,
  immediateBlockProducer,
} from '@midnightntwrk/wallet-sdk-capabilities/simulation';
import { type LedgerOps } from '@midnightntwrk/wallet-sdk-utilities';
import { Effect, type Scope } from 'effect';

/** Public keys as both ledger versions express them: hex strings, identical for identical seeds. */
export type Recipient = Readonly<{ coinPublicKey: string; encryptionPublicKey: string }>;

/**
 * One coin, sampled once and mintable by either ledger version.
 *
 * @remarks
 *   The nonce is sampled by the pre-fork ledger and then reused verbatim wherever the coin is re-created: that is what
 *   makes a post-fork payment of it produce the pre-fork commitment rather than merely a commitment of the same value.
 */
export type MintedCoin = Readonly<{
  type: string;
  nonce: string;
  value: bigint;
  recipient: Recipient;
}>;

/** Samples a coin of `value` for `recipient`, using the pre-fork ledger's own nonce sampling. */
export const mintable = (tokenType: string, value: bigint, recipient: Recipient): MintedCoin => {
  const sampled = v8.createShieldedCoinInfo(tokenType, value);
  return { type: sampled.type, nonce: sampled.nonce, value: sampled.value, recipient };
};

/** The pre-fork transaction that creates `coin`: one output, therefore one commitment, therefore one Merkle index. */
export const preForkPayment = (networkId: NetworkId.NetworkId, coin: MintedCoin): v8.ProofErasedTransaction => {
  const output = v8.ZswapOutput.new(
    { type: coin.type, nonce: coin.nonce, value: coin.value },
    0,
    coin.recipient.coinPublicKey,
    coin.recipient.encryptionPublicKey,
  );
  const offer = v8.ZswapOffer.fromOutput<v8.PreProof>(output, coin.type, coin.value);
  return v8.Transaction.fromParts(networkId, offer).eraseProofs();
};

/** The same payment, built by the post-fork ledger version. */
export const postForkPayment = (networkId: NetworkId.NetworkId, coin: MintedCoin): v9.ProofErasedTransaction => {
  const output = v9.ZswapOutput.new(
    { type: coin.type, nonce: coin.nonce, value: coin.value },
    0,
    coin.recipient.coinPublicKey,
    coin.recipient.encryptionPublicKey,
  );
  const offer = v9.ZswapOffer.fromOutput<v9.PreProof>(output, coin.type, coin.value);
  return v9.Transaction.fromParts(networkId, offer).eraseProofs();
};

export type TranslationStubConfig = Readonly<{
  networkId: NetworkId.NetworkId;
  /** Every pre-fork commitment, in the order the pre-fork chain created them. */
  coins: readonly MintedCoin[];
}>;

/**
 * A stand-in for the ledger team's v8-to-v9 state translation, for the tier that cannot build the real one.
 *
 * @remarks
 *   The pre-fork bytes it is handed are deliberately ignored: this ledger version cannot deserialize them, which is the
 *   very reason the seam is stated in bytes. The output is reconstructed from `config.coins` instead — see the module
 *   remarks for why re-paying the same coins reproduces the same tree — and returned serialized, because that is what
 *   the {@link LedgerStateTranslator} contract carries and what `ForkSimulator` deserializes into the post-fork chain's
 *   genesis ledger.
 *
 *   The throwaway chain used to build it is minted under genesis strictness and torn down with the effect's scope; only
 *   its ledger state escapes.
 * @param config The network the reconstructed chain claims to be on, and the commitments it must end up holding.
 * @returns A translator producing a post-fork ledger whose commitment tree is the pre-fork one.
 */
export const translationStub =
  (config: TranslationStubConfig): LedgerStateTranslator =>
  () =>
    Effect.gen(function* () {
      const chain = yield* Simulator.init({
        networkId: config.networkId,
        blockProducer: immediateBlockProducer(undefined, genesisStrictness),
      });
      // One payment per block, awaited in turn, so the commitments land in exactly the pre-fork order. Batching them
      // would leave the within-block ordering to the block producer, and the Merkle indices are the whole point.
      yield* Effect.forEach(config.coins, (coin) => chain.submitTransaction(postForkPayment(config.networkId, coin)), {
        discard: true,
      });
      return yield* chain.query((state) => state.ledger.serialize());
    }).pipe(
      Effect.scoped,
      Effect.mapError(
        (cause) =>
          new LedgerTranslationError({ message: 'The translation stub could not rebuild the pre-fork tree', cause }),
      ),
    );

export type PayingPostForkChainConfig = Readonly<{
  networkId: NetworkId.NetworkId;
  /** The version the post-fork variant is registered at: every block must sit inside its range. */
  protocolVersion: ProtocolVersion.ProtocolVersion;
  genesisBlockNumber: bigint;
  genesisTime: Date;
  blockProducer: BlockProducer;
  /** The coins to pay out, one block each. */
  coins: readonly MintedCoin[];
}>;

/**
 * A post-fork chain that pays `coins` out as ordinary post-fork transactions.
 *
 * @remarks
 *   For wallets that start _after_ the fork rather than crossing it: they have nothing carried and no anchor to perform,
 *   so the only way they can come to hold anything is the ordinary one — somebody pays them, and they sync it. Nothing
 *   here models a fork; a chain that has crossed one announces no pre-fork coin.
 * @param config The network, the version its blocks are stamped with, where its numbering and clock start, the producer
 *   and the coins.
 * @returns The chain, once every coin has been paid.
 */
export const makePayingPostForkChain = (
  config: PayingPostForkChainConfig,
): Effect.Effect<Simulator, LedgerOps.LedgerError, Scope.Scope> =>
  Effect.gen(function* () {
    const chain = yield* Simulator.init({
      networkId: config.networkId,
      protocolVersion: config.protocolVersion,
      genesisBlockNumber: config.genesisBlockNumber,
      genesisTime: config.genesisTime,
      blockProducer: config.blockProducer,
    });

    yield* Effect.forEach(config.coins, (coin) => chain.submitTransaction(postForkPayment(config.networkId, coin)), {
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
