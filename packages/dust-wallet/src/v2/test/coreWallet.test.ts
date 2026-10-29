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
import {
  DustActions,
  DustSecretKey,
  dustFirstNonce,
  dustNullifier,
  Intent,
  LedgerParameters,
  Transaction,
  type UnprovenTransaction,
} from '@midnightntwrk/ledger-v9';
import { NetworkId } from '@midnightntwrk/wallet-sdk-abstractions';
import { describe, expect, it } from 'vitest';
import { CoreWallet } from '../CoreWallet.js';
import { type NewDustGeneration, DustUtxoMap } from '../SyncSchema.js';
import { ProofMarker, SignatureMarker } from '../Utils.js';

const networkId = NetworkId.NetworkId.Undeployed;
const dustParameters = LedgerParameters.initialParameters().dust;
const seedHex = '0000000000000000000000000000000000000000000000000000000000000001';

// Characterization coverage for the pure state-apply functions used by the projections sync capability. The
// collapsed-update paths need indexer-produced merkle payloads and stay covered by the projections e2e suite.
describe('CoreWallet dust apply functions', () => {
  const secretKey = DustSecretKey.fromSeed(Buffer.from(seedHex, 'hex'));

  const generation = (backingNightByte: string, mtIndex: bigint, generationMtIndex: number): NewDustGeneration => {
    const backingNight = backingNightByte.repeat(32);
    const qdo = {
      initialValue: 1_000_000_000n,
      owner: secretKey.publicKey,
      nonce: dustFirstNonce(backingNight, secretKey.publicKey),
      seq: 0,
      ctime: new Date(1_000_000),
      backingNight,
      mtIndex,
    };
    return {
      dustNullifier: dustNullifier(qdo, secretKey),
      genInfo: { value: 5_000_000_000n, owner: secretKey.publicKey, nonce: backingNight, dtime: undefined },
      generationMtIndex,
      qdo,
      transactionId: 7,
      transactionHash: 'cd'.repeat(32),
    };
  };

  it('applies new utxos and their commitments, then removes spent nullifiers', () => {
    const state = CoreWallet.initEmpty(dustParameters, secretKey, networkId);
    const generations = [generation('ab', 0n, 0), generation('ba', 1n, 1)];
    const utxoMap = DustUtxoMap.create(generations);

    const withUtxos = CoreWallet.applyNewDustUtxos(state, utxoMap);
    const withCommitments = CoreWallet.applyDustCommitments(withUtxos, utxoMap, []);

    expect(withCommitments.state.utxos).toHaveLength(2);
    expect(withCommitments.state.commitmentTreeFirstFree).toBe(2n);

    const afterSpend = CoreWallet.applySpentNullifiers(withCommitments, [generations[0].dustNullifier]);
    expect(afterSpend.state.utxos).toHaveLength(1);
    expect(afterSpend.state.utxos[0].backingNight).toBe(generations[1].qdo.backingNight);
  });

  it('inserts generation info for new generations', () => {
    const state = CoreWallet.initEmpty(dustParameters, secretKey, networkId);
    const generations = [generation('ab', 0n, 0), generation('ba', 1n, 1)];

    const withGenerations = CoreWallet.applyDustGenerations(state, [], generations, []);

    expect(withGenerations.state.generatingTreeFirstFree).toBe(2n);
    expect(state.state.generatingTreeFirstFree).toBe(0n);
  });
});

describe('CoreWallet pending Dust', () => {
  const secretKey = DustSecretKey.fromSeed(Buffer.from(seedHex, 'hex'));
  const created = new Date(1_000_000_000);
  const secondsAfterCreation = (seconds: number): Date => new Date(created.getTime() + seconds * 1000);
  const spendTime = secondsAfterCreation(150);

  // An own coin created with no value at `created`. Given a `dtime`, its backing Night was spent then: the coin stops
  // generating and decays back to nothing over the same span it generated for.
  const ownCoin = (backingNightByte: string, index: number, dtime: Date | undefined): NewDustGeneration => {
    const backingNight = backingNightByte.repeat(32);
    const qdo = {
      initialValue: 0n,
      owner: secretKey.publicKey,
      nonce: dustFirstNonce(backingNight, secretKey.publicKey),
      seq: 0,
      ctime: created,
      backingNight,
      mtIndex: BigInt(index),
    };
    return {
      dustNullifier: dustNullifier(qdo, secretKey),
      genInfo: { value: 5_000_000_000_000n, owner: secretKey.publicKey, nonce: backingNight, dtime },
      generationMtIndex: index,
      qdo,
      transactionId: 7,
      transactionHash: 'cd'.repeat(32),
    };
  };

  // Worth nothing 200 s after creation: 50 s after `spendTime`, well inside the dust grace period.
  const decaying = ownCoin('aa', 0, secondsAfterCreation(100));
  const first = ownCoin('bb', 1, undefined);
  const second = ownCoin('cc', 2, undefined);

  const syncedWallet = (): CoreWallet => {
    const generations = [decaying, first, second];
    const utxos = DustUtxoMap.create(generations);
    const withUtxos = CoreWallet.applyNewDustUtxos(CoreWallet.initEmpty(dustParameters, secretKey, networkId), utxos);
    return CoreWallet.applyDustGenerations(CoreWallet.applyDustCommitments(withUtxos, utxos, []), [], generations, []);
  };

  const spendInTransaction = (
    wallet: CoreWallet,
    coin: NewDustGeneration,
    ctime: Date,
  ): readonly [UnprovenTransaction, CoreWallet] => {
    const [spends, spent] = CoreWallet.spendCoins(wallet, secretKey, [{ token: coin.qdo, value: 1n }], ctime);
    const intent = Intent.new(secondsAfterCreation(86_400));
    intent.dustActions = new DustActions(SignatureMarker.signature, ProofMarker.preProof, ctime, [...spends], []);
    return [Transaction.fromParts(networkId, undefined, undefined, intent), spent];
  };

  const backingNightsOf = (wallet: CoreWallet): readonly string[] =>
    wallet.state.utxos.map((utxo) => utxo.backingNight).toSorted();

  it('should keep a decaying coin the reverted transaction never spent, because a revert releases only that transaction’s own coins', () => {
    const synced = syncedWallet();
    const [transaction, spent] = spendInTransaction(synced, first, spendTime);

    const reverted = CoreWallet.revertTransaction(spent, transaction);

    expect(backingNightsOf(reverted)).toEqual(backingNightsOf(synced));
    expect(reverted.state.walletBalance(spendTime)).toBe(synced.state.walletBalance(spendTime));
    expect(reverted.pendingDust).toEqual([]);
  });

  it('should keep the coin another pending transaction spent locked, because reverting one transaction must not release another’s', () => {
    const [, firstSpent] = spendInTransaction(syncedWallet(), first, spendTime);
    const [secondTransaction, bothSpent] = spendInTransaction(firstSpent, second, secondsAfterCreation(160));

    const reverted = CoreWallet.revertTransaction(bothSpent, secondTransaction);

    expect(backingNightsOf(reverted)).toEqual([decaying.qdo.backingNight, second.qdo.backingNight]);
    expect(reverted.pendingDust.map((coin) => coin.nonce)).toEqual([first.qdo.nonce]);
  });

  it('should add no value when reverting a spend whose coin decayed to nothing while pending, so the next sync leaves the state as it was', () => {
    const [transaction, spent] = spendInTransaction(syncedWallet(), decaying, spendTime);
    const afterDecay = secondsAfterCreation(400);
    const syncedAfterDecay: CoreWallet = { ...spent, state: spent.state.processTtls(afterDecay) };

    const reverted = CoreWallet.revertTransaction(syncedAfterDecay, transaction);

    expect(reverted.state.walletBalance(afterDecay)).toBe(syncedAfterDecay.state.walletBalance(afterDecay));
    expect(backingNightsOf({ ...reverted, state: reverted.state.processTtls(secondsAfterCreation(401)) })).toEqual(
      backingNightsOf(syncedAfterDecay),
    );
  });

  it('should keep a coin a pending transaction spent through a sync, so reverting that transaction still releases it', () => {
    const [transaction, spent] = spendInTransaction(syncedWallet(), first, spendTime);
    const [afterSync] = CoreWallet.applyEventsWithChanges(spent, secretKey, [], secondsAfterCreation(151));

    expect(afterSync.pendingDust.map((coin) => coin.nonce)).toEqual([first.qdo.nonce]);

    const reverted = CoreWallet.revertTransaction(afterSync, transaction);

    expect(backingNightsOf(reverted)).toContain(first.qdo.backingNight);
    expect(reverted.pendingDust).toEqual([]);
  });

  it('should stop counting a coin as pending once its lock runs out, so a transaction that never lands does not hide the coin for good', () => {
    const [, spent] = spendInTransaction(syncedWallet(), first, spendTime);
    const lockEnd = new Date(spendTime.getTime() + Number(dustParameters.dustGracePeriodSeconds) * 1000);
    const [afterLock] = CoreWallet.applyEventsWithChanges(spent, secretKey, [], lockEnd);

    expect(backingNightsOf(afterLock)).toContain(first.qdo.backingNight);
    expect(afterLock.pendingDust).toEqual([]);
  });
});
