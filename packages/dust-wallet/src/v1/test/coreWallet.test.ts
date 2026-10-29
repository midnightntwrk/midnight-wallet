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
  dustNullifier,
  Intent,
  LedgerParameters,
  type QualifiedDustOutput,
  Transaction,
  type UnprovenTransaction,
} from '@midnight-ntwrk/ledger-v8';
import { NetworkId } from '@midnightntwrk/wallet-sdk-abstractions';
import { describe, expect, it } from 'vitest';
import { CoreWallet } from '../CoreWallet.js';
import { ProofMarker, SignatureMarker } from '../Utils.js';

const networkId = NetworkId.NetworkId.Undeployed;
const dustParameters = LedgerParameters.initialParameters().dust;
const seedHex = '0000000000000000000000000000000000000000000000000000000000000001';

describe('CoreWallet pending Dust', () => {
  const secretKey = DustSecretKey.fromSeed(Buffer.from(seedHex, 'hex'));
  const created = new Date(1_000_000_000);
  const secondsAfterCreation = (seconds: number): Date => new Date(created.getTime() + seconds * 1000);
  const spendTime = secondsAfterCreation(150);

  type OwnCoin = { readonly qdo: QualifiedDustOutput; readonly dtime: Date | undefined };

  // An own coin created with no value at `created`. Given a `dtime`, its backing Night was spent then: the coin stops
  // generating and decays back to nothing over the same span it generated for.
  const ownCoin = (backingNightByte: string, index: number, dtime: Date | undefined): OwnCoin => ({
    qdo: {
      initialValue: 0n,
      owner: secretKey.publicKey,
      nonce: BigInt(index + 1),
      seq: 0,
      ctime: created,
      backingNight: backingNightByte.repeat(32),
      mtIndex: BigInt(index),
    },
    dtime,
  });

  // Worth nothing 200 s after creation: 50 s after `spendTime`, well inside the dust grace period.
  const decaying = ownCoin('aa', 0, secondsAfterCreation(100));
  const first = ownCoin('bb', 1, undefined);
  const second = ownCoin('cc', 2, undefined);

  const syncedWallet = (): CoreWallet => {
    const wallet = CoreWallet.initEmpty(dustParameters, secretKey, networkId);
    const state = [decaying, first, second].reduce(
      (current, { qdo, dtime }) =>
        current
          .addUtxo(dustNullifier(qdo, secretKey), qdo)
          .insertCommitment(qdo.mtIndex, qdo, true)
          .insertGenerationInfo(
            qdo.mtIndex,
            { value: 5_000_000_000_000n, owner: secretKey.publicKey, nonce: qdo.backingNight, dtime },
            qdo.backingNight,
          ),
      wallet.state,
    );
    return { ...wallet, state };
  };

  const spendInTransaction = (
    wallet: CoreWallet,
    coin: OwnCoin,
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

  it('should stop counting a coin as pending once it decays to nothing, because the state no longer holds it to spend or release', () => {
    const [, spent] = spendInTransaction(syncedWallet(), decaying, spendTime);
    const lockEnd = new Date(spendTime.getTime() + Number(dustParameters.dustGracePeriodSeconds) * 1000);

    const [afterDecay] = CoreWallet.applyEventsWithChanges(spent, secretKey, [], secondsAfterCreation(300));

    expect(backingNightsOf(afterDecay)).not.toContain(decaying.qdo.backingNight);
    expect(afterDecay.pendingDust).toEqual([]);

    const [afterLock] = CoreWallet.applyEventsWithChanges(afterDecay, secretKey, [], lockEnd);

    expect(afterLock.pendingDust).toEqual([]);
  });

  it('should keep a coin pending at the moment it was created, because the ledger keeps a coin worth nothing until time has passed', () => {
    const [, spent] = CoreWallet.spendCoins(syncedWallet(), secretKey, [{ token: first.qdo, value: 0n }], created);

    const [atCreation] = CoreWallet.applyEventsWithChanges(spent, secretKey, [], created);

    expect(atCreation.pendingDust.map((coin) => coin.nonce)).toEqual([first.qdo.nonce]);
  });

  it('should keep a coin pending within the second it was created, because the ledger counts time in whole seconds', () => {
    const [, spent] = CoreWallet.spendCoins(syncedWallet(), secretKey, [{ token: first.qdo, value: 0n }], created);

    const [withinCreationSecond] = CoreWallet.applyEventsWithChanges(
      spent,
      secretKey,
      [],
      new Date(created.getTime() + 500),
    );

    expect(withinCreationSecond.pendingDust.map((coin) => coin.nonce)).toEqual([first.qdo.nonce]);
  });

  it('should stop counting a coin as pending when the state has no generation for it, because the ledger drops such a coin', () => {
    const synced = syncedWallet();
    const orphan = { ...second.qdo, backingNight: 'dd'.repeat(32), nonce: second.qdo.nonce + 1n };
    const withOrphanPending: CoreWallet = {
      ...synced,
      pendingDust: [{ ...orphan, nullifier: dustNullifier(orphan, secretKey) }],
    };

    const [afterSync] = CoreWallet.applyEventsWithChanges(withOrphanPending, secretKey, [], spendTime);

    expect(afterSync.pendingDust).toEqual([]);
  });
});
