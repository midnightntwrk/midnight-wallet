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
 * The fidelity link: what a wallet rebuilds from the replay is what the real translation produces.
 *
 * @remarks
 *   `forkSimulation.test.ts` proves the crossing — hand-over, fresh state, re-discovery by sync, spend — and needs no
 *   ledger translation to do it. What it cannot prove is that the modelling is faithful: its wallet learns its coins
 *   from a replayed timeline and spends against that same timeline, so it is self-consistent by construction.
 *
 *   This closes that gap against the ledger team's real v8-to-v9 state translation. The pre-fork chain hands its own
 *   serialized ledger to the translation and the post-fork chain continues from the result — the chain's own account of
 *   what survived the fork — while the wallet syncs the replayed timeline, which is the indexer's account of the same
 *   thing. Two independent reconstructions of one tree, checked against each other two ways:
 *
 *   - **The roots agree.** The tree the wallet rebuilds from replayed events has the same Merkle root as the tree the
 *       translation produced. A single number, and a byte-level claim: commitments are a function of coin and owner, so
 *       equality here means the two ledger versions computed every one of them identically.
 *   - **The translated chain accepts the wallet's spend.** A spend carries a Merkle path built from the wallet's tree, and
 *       the post-fork ledger recognises it only if that path resolves to a root the translated state holds. So the
 *       wallet — which never saw the translated tree — transacts against it.
 *
 *   **Integration tier because of a build step, not infra.** The translation is a WASM artifact built from
 *   `packages/state-translation/wasm`, so it has to be compiled first; this package's `turbo.json` declares
 *   `test:integration` dependent on that package's `build:wasm`, exactly as `capabilities` does. Nothing here needs
 *   Docker or a network, and nothing is skipped — if the artifact were missing these tests would fail rather than pass
 *   vacuously.
 */

import * as v8 from '@midnight-ntwrk/ledger-v8';
import * as v9 from '@midnightntwrk/ledger-v9';
import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import {
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
} from '@midnightntwrk/wallet-sdk-address-format';
import {
  ForkSimulator,
  type Simulator,
  V8,
  genesisStrictness,
  immediateBlockProducer,
  translatorFromAsync,
} from '@midnightntwrk/wallet-sdk-capabilities/simulation';
import { translateLedgerState } from '@midnightntwrk/wallet-sdk-state-translation';
import { Deferred, Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { V1Tag } from '../v1/index.js';
import { V2Tag } from '../v2/index.js';
import { type ReplayedCoin, makeReplayChain, mintable, preForkPayment, simulatedChainRoot } from './forkReplay.js';
import { makeForkWallet } from './forkHarness.js';
import { carried, coinIndices, coinValues, merkleRoot, totalValue, treeSize } from './forkWalletAssertions.js';

const networkId = NetworkId.NetworkId.Undeployed;

const forkVersion = ProtocolVersion.ProtocolVersion(7n);
const forkBlock = 8n;

const seed = Buffer.alloc(32, 42);
const otherSeed = Buffer.alloc(32, 43);

const walletValues = [100n, 200n, 300n, 400n] as const;
const walletTotal = walletValues.reduce((sum, value) => sum + value, 0n);
const walletIndices = [0n, 1n, 2n, 4n];
const treeSizeAtFork = 6n;

const walletRecipient = () => {
  const keys = v9.ZswapSecretKeys.fromSeed(seed);
  return { coinPublicKey: keys.coinPublicKey, encryptionPublicKey: keys.encryptionPublicKey };
};

const strangerRecipient = () => {
  const keys = v9.ZswapSecretKeys.fromSeed(otherSeed);
  return { coinPublicKey: keys.coinPublicKey, encryptionPublicKey: keys.encryptionPublicKey };
};

const recipientAddress = (): ShieldedAddress => {
  const stranger = strangerRecipient();
  return new ShieldedAddress(
    ShieldedCoinPublicKey.fromHexString(stranger.coinPublicKey),
    ShieldedEncryptionPublicKey.fromHexString(stranger.encryptionPublicKey),
  );
};

/** The pre-fork commitment sequence: three to us, a stranger's, ours, a stranger's again. */
const chainCoins = (): readonly ReplayedCoin[] => {
  const tokenType = v8.shieldedToken().raw;
  const us = walletRecipient();
  const them = strangerRecipient();
  return [
    mintable(tokenType, 100n, us),
    mintable(tokenType, 200n, us),
    mintable(tokenType, 300n, us),
    mintable(tokenType, 50n, them),
    mintable(tokenType, 400n, us),
    mintable(tokenType, 50n, them),
  ];
};

const baseConfig = {
  networkId,
  forkBlock,
  forkVersion,
  // Genesis strictness throughout: the transfer below pays no fees, which a fee-enforcing chain would reject for
  // reasons that have nothing to do with the fork.
  preForkBlockProducer: V8.immediateBlockProducer(undefined, V8.genesisStrictness),
  postForkBlockProducer: immediateBlockProducer(undefined, genesisStrictness),
  translator: translatorFromAsync(translateLedgerState),
};

describe('the two ledger versions agree on what the wallet owns', () => {
  it('derives the same public keys from one seed, which is what makes a replayed coin the same coin', () => {
    // The lemma everything below rests on. A commitment is computed from the coin and its owner's coin public key; if
    // the two ledger versions derived different keys from one seed, a replayed payment would be a payment to somebody
    // else and no tree could ever line up.
    const preFork = v8.ZswapSecretKeys.fromSeed(seed);
    const postFork = v9.ZswapSecretKeys.fromSeed(seed);

    expect(postFork.coinPublicKey).toBe(preFork.coinPublicKey);
    expect(postFork.encryptionPublicKey).toBe(preFork.encryptionPublicKey);
    expect(v9.shieldedToken().raw).toBe(v8.shieldedToken().raw);
  });

  it('computes identical coin commitments for identical coins', () => {
    const coin = mintable(v8.shieldedToken().raw, 100n, walletRecipient());
    const plain = { type: coin.type, nonce: coin.nonce, value: coin.value };

    expect(v9.coinCommitment(plain, coin.recipient.coinPublicKey)).toBe(
      v8.coinCommitment(plain, coin.recipient.coinPublicKey),
    );
  });
});

describe('a shielded wallet crossing a byte-faithful hard fork', () => {
  it('rebuilds the translated commitment tree from the replay, and spends against the translation', async () =>
    Effect.gen(function* () {
      const coins = chainCoins();
      const fork = yield* ForkSimulator.init(baseConfig);
      const replayed = yield* Deferred.make<Simulator>();

      const wallet = yield* makeForkWallet({
        preFork: fork.preFork,
        replayed: Deferred.await(replayed),
        networkId,
        forkVersion,
        seed,
      });
      yield* Effect.addFinalizer(() => wallet.stop);
      yield* wallet.start;

      // --- pre-fork: a real ledger-v8 chain, synced by the ledger-v8 variant ------------------------------------
      yield* Effect.forEach(coins, (coin) => fork.preFork.submitTransaction(preForkPayment(networkId, coin)), {
        discard: true,
      });
      const preFork = yield* wallet.awaitState((state) => totalValue(state.state) === walletTotal);
      expect(yield* wallet.activeTag).toBe(V1Tag);
      expect(coinIndices(preFork.state)).toEqual(walletIndices);
      expect(treeSize(preFork.state)).toBe(treeSizeAtFork);
      const preForkRoot = merkleRoot(preFork.state);
      expect(preForkRoot).toBeDefined();

      // --- the chain forks: its ledger goes through the real v8-to-v9 translation --------------------------------
      const translated = yield* fork.advanceToFork();
      const translatedRoot = yield* translated.query(simulatedChainRoot);

      // The translation preserved the tree the pre-fork wallet was looking at. Asserted before the wallet is involved
      // so that a translation regression is distinguishable from a wallet one.
      expect(translatedRoot).toBe(preForkRoot);
      expect(yield* translated.query((state) => state.ledger.zswap.firstFree)).toBe(treeSizeAtFork);

      // --- the indexer replays the timeline ---------------------------------------------------------------------
      // Numbered and clocked from the boundary, exactly as the translated chain beside it is: the two reconstructions
      // are two accounts of one timeline continuing, not of two timelines starting.
      const replayChain = yield* makeReplayChain({
        networkId,
        protocolVersion: forkVersion,
        genesisBlockNumber: forkBlock,
        genesisTime: yield* fork.preFork.query((state) => state.currentTime),
        blockProducer: immediateBlockProducer(undefined, genesisStrictness),
        coins,
      });
      // The replay is a faithful stand-in for the translation precisely because these agree: the same commitments, in
      // the same order, therefore the same tree — reached by re-announcing coins rather than by converting bytes.
      expect(yield* replayChain.query(simulatedChainRoot)).toBe(translatedRoot);
      yield* Deferred.succeed(replayed, replayChain);

      // --- the wallet hands over with nothing, then re-earns it all ---------------------------------------------
      const migration = yield* wallet.awaitMigration;
      expect(yield* wallet.activeTag).toBe(V2Tag);
      expect(migration.from.protocolVersion).toBe(forkVersion);
      expect(migration.from.appliedIndex).toBe(forkBlock);
      expect(migration.to.coinCount).toBe(0);
      expect(migration.to.firstFree).toBe(0n);
      // Parked on the boundary, not rewound: the replay continues the indexer's event ids rather than restarting them.
      expect(migration.to.appliedIndex).toBe(forkBlock);

      const postFork = yield* wallet.awaitState(
        (state) => state.version >= forkVersion && totalValue(state.state) === walletTotal,
      );
      expect(coinValues(postFork.state)).toEqual([...walletValues]);
      expect(coinIndices(postFork.state)).toEqual(walletIndices);
      expect(treeSize(postFork.state)).toBe(treeSizeAtFork);

      // **The fidelity link.** The wallet has never seen the translated state; it read replayed events and rebuilt a
      // tree from them. That tree is the translated tree, down to its root.
      expect(merkleRoot(postFork.state)).toBe(translatedRoot);

      // --- and it can transact against the translation ----------------------------------------------------------
      const transferred = 150n;
      const transfer = yield* Effect.promise(() =>
        wallet.shielded.transferTransaction([
          { amount: transferred, type: v9.shieldedToken().raw, receiverAddress: recipientAddress() },
        ]),
      );
      const spend = carried<v9.UnprovenTransaction>(transfer, forkVersion).eraseProofs();

      // Submitted to the chain that holds the *translated* ledger, not to the replay the wallet learned from. The
      // Merkle path in this spend was built from the wallet's own tree; the translated chain recognises it only if
      // that root is one it holds. This is the claim in full, and nothing short of a real translation can support it.
      const onTranslatedChain = yield* translated.submitTransaction(spend);
      expect(onTranslatedChain.transactions[0].result.type).toBe('success');
      expect(onTranslatedChain.number).toBeGreaterThan(forkBlock);

      // The indexer reports the same spend, which is how the wallet learns of it. The same transaction object serves
      // both chains: applying it neither consumes nor mutates it.
      const onReplay = yield* replayChain.submitTransaction(spend);
      expect(onReplay.transactions[0].result.type).toBe('success');
      // Past the boundary on the replay too — both accounts of the timeline count on from the fork height.
      expect(onReplay.number).toBeGreaterThan(forkBlock);

      const afterSpend = yield* wallet.awaitState((state) => state.state.progress.appliedIndex > onReplay.number);
      expect(totalValue(afterSpend.state)).toBe(walletTotal - transferred);
    }).pipe(Effect.scoped, Effect.runPromise));
});
