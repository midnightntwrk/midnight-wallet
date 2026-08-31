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
 * The fidelity link: the tree a crossing wallet carries is the tree the real translation produced.
 *
 * @remarks
 *   `forkSimulation.test.ts` proves the crossing — hand-over, the state arriving whole, a post-fork payment, a spend —
 *   and needs no ledger translation to do it, because `translationStub.ts` reconstructs the post-fork ledger from the
 *   same coins the pre-fork chain was paid. What it cannot prove is that the reconstruction is faithful: the chain the
 *   wallet's tree is compared against is one the suite built itself.
 *
 *   This closes that gap against the ledger team's real v8-to-v9 state translation. The pre-fork chain hands its own
 *   serialized ledger to the translation and the post-fork chain continues from the result — the chain's own account of
 *   what survived the fork — while the wallet crosses independently, by handing its own serialized local state to this
 *   ledger version's deserializer. Two independent crossings of one tree, checked against each other two ways:
 *
 *   - **The roots agree.** The tree the wallet carried has the same Merkle root as the tree the translation produced. A
 *       single number, and a byte-level claim: commitments are a function of coin and owner, so equality here means the
 *       two ledger versions computed every one of them identically.
 *   - **The translated chain accepts the wallet's spend.** A spend carries a Merkle path built from the wallet's tree, and
 *       the post-fork ledger recognises it only if that path resolves to a root the translated state holds. So a wallet
 *       whose state crossed as bytes transacts against the real translation. That is the money test, and nothing short
 *       of a real translation can support it.
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
  V8,
  genesisStrictness,
  immediateBlockProducer,
  translatorFromAsync,
} from '@midnightntwrk/wallet-sdk-capabilities/simulation';
import { translateLedgerState } from '@midnightntwrk/wallet-sdk-state-translation';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { V1Tag } from '../v1/index.js';
import { V2Tag } from '../v2/index.js';
import { type MintedCoin, mintable, preForkPayment, simulatedChainRoot } from './translationStub.js';
import { makeForkWallet } from './forkHarness.js';
import {
  awaitingCoinHashes,
  carried,
  coinIndices,
  coinValues,
  merkleRoot,
  totalValue,
  treeSize,
} from './forkWalletAssertions.js';

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
const chainCoins = (): readonly MintedCoin[] => {
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
  it('derives the same public keys from one seed, which is what lets a carried coin be re-inserted as itself', () => {
    // The lemma everything below rests on. A commitment is computed from the coin and its owner's coin public key; a
    // coin carried across the boundary is re-inserted with the _new_ ledger version's keys, so if the two versions
    // derived different keys from one seed the rebuilt leaf would be somebody else's and no tree could ever line up.
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
  it('arrives holding the truly translated tree, and spends against it', async () =>
    Effect.gen(function* () {
      const coins = chainCoins();
      const fork = yield* ForkSimulator.init(baseConfig);

      const wallet = yield* makeForkWallet({
        preFork: fork.preFork,
        postFork: fork.awaitPostFork(),
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

      // --- the wallet hands over carrying its whole local state -------------------------------------------------
      const migration = yield* wallet.awaitMigration;
      expect(yield* wallet.activeTag).toBe(V2Tag);
      expect(migration.from.protocolVersion).toBe(forkVersion);
      expect(migration.from.appliedIndex).toBe(forkBlock);
      // Complete at the moment of the hand-over: the tree crossed as bytes, so the coins are there and the height is
      // the height the pre-fork chain reached.
      expect(migration.to.coinCount).toBe(walletValues.length);
      expect(migration.to.firstFree).toBe(treeSizeAtFork);
      // Everything except the hashes, which need secret keys a migration is not given.
      expect(migration.to.coinHashesPending).toBe(true);
      // Parked on the boundary, not rewound: the post-fork timeline continues the indexer's event ids.
      expect(migration.to.appliedIndex).toBe(forkBlock);

      const postFork = yield* wallet.awaitState(
        (state) =>
          state.version >= forkVersion &&
          totalValue(state.state) === walletTotal &&
          state.state.progress.appliedIndex > forkBlock,
      );
      expect(coinValues(postFork.state)).toEqual([...walletValues]);
      expect(coinIndices(postFork.state)).toEqual(walletIndices);
      expect(treeSize(postFork.state)).toBe(treeSizeAtFork);
      expect(awaitingCoinHashes(postFork.state)).toBe(false);

      // **The fidelity link.** The wallet's tree was decoded out of the pre-fork ledger's bytes by the post-fork
      // ledger; the chain's was produced by the ledger team's own state translation from the same pre-fork ledger.
      // Two independent crossings of one tree, and they agree down to the root.
      expect(merkleRoot(postFork.state)).toBe(translatedRoot);

      // Nothing was re-announced. The translated chain has produced exactly one block — its genesis, holding the
      // translated ledger — and it contains no transactions at all, so there was nothing here to re-discover from.
      expect(yield* translated.query((state) => state.blocks.flatMap((block) => block.transactions))).toEqual([]);
      expect(postFork.state.progress.appliedIndex).toBe(forkBlock + 1n);

      // --- the money test: a carried coin is spent against the translation ---------------------------------------
      const transferred = 150n;
      const transfer = yield* Effect.promise(() =>
        wallet.shielded.transferTransaction([
          { amount: transferred, type: v9.shieldedToken().raw, receiverAddress: recipientAddress() },
        ]),
      );
      const spend = carried<v9.UnprovenTransaction>(transfer, forkVersion).eraseProofs();

      // Submitted to the chain that holds the *translated* ledger. The Merkle path in this spend was built from the
      // tree the wallet carried across the boundary; the chain recognises it only if the root it resolves to is one
      // that ledger holds.
      const onTranslatedChain = yield* translated.submitTransaction(spend);
      expect(onTranslatedChain.transactions[0].result.type).toBe('success');
      expect(onTranslatedChain.number).toBeGreaterThan(forkBlock);

      const afterSpend = yield* wallet.awaitState(
        (state) => state.state.progress.appliedIndex > onTranslatedChain.number,
      );
      expect(totalValue(afterSpend.state)).toBe(walletTotal - transferred);
    }).pipe(Effect.scoped, Effect.runPromise));
});
