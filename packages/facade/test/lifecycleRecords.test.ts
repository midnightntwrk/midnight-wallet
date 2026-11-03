/*
 * This file is part of MIDNIGHT-WALLET-SDK.
 * Copyright (C) Midnight Foundation
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0 (the "License");
 * You may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Every entry point that balances a transaction leaves exactly one record of it, balanced, from the moment its coins
 * are booked: nothing else says those coins are spoken for until the transaction is finalized. The record holds the
 * whole transaction the recipe finalizes into, with its proofs erased, so it names every coin that transaction spends.
 */
import * as ledger from '@midnightntwrk/ledger-v9';
import { type AnyTx, NetworkId, ProtocolVersion, WalletTransaction } from '@midnightntwrk/wallet-sdk-abstractions';
import { type Lifecycle } from '@midnightntwrk/wallet-sdk-capabilities/pendingTransactions';
import { V9 } from '@midnightntwrk/wallet-sdk-capabilities/simulation';
import { Effect, Either, Option } from 'effect';
import * as rx from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { BalancingRecipe, type FacadeState, type WalletFacade } from '../src/index.js';
import { type LifecycleTx } from '../src/transaction.js';
import {
  createSimulatorWalletFactories,
  deriveWalletKeys,
  makeSimulatorFacade,
  tokenValue,
  waitForShieldedCoins,
  waitForUnshieldedBalance,
  type SimulatorConfig,
  type WalletKeys,
} from './utils/index.js';

vi.setConfig({ testTimeout: 30_000 });

const NETWORK_ID = NetworkId.NetworkId.Undeployed;
const NIGHT = ledger.nativeToken().raw;
const SHIELDED = ledger.shieldedToken().raw;
const SEED = '0000000000000000000000000000000000000000000000000000000000000001';

/**
 * An hour ahead of the facade's own clock, on a whole second: an intent's TTL is kept to the second, and the record's
 * TTL is read off it against that clock, whose Dust grace period of three hours comes later.
 */
const ttlOn = (facade: WalletFacade): Date =>
  new Date(Math.ceil((facade.clock.now().getTime() + 60 * 60 * 1000) / 1000) * 1000);

const utxoKey = (coin: { utxo: { intentHash: string; outputNo: number } }): string =>
  `${coin.utxo.intentHash}#${coin.utxo.outputNo}`;

const lifecycleOf = (facade: WalletFacade): Effect.Effect<Lifecycle.TransactionLifecycle<LifecycleTx>> =>
  Effect.promise(() => rx.firstValueFrom(facade.transactionLifecycleService.state()));

const stateOf = (facade: WalletFacade): Effect.Effect<FacadeState> =>
  Effect.promise(() => rx.firstValueFrom(facade.state()));

/** The simulator facade runs ledger-v9 from the bottom of the version range. */
const carried = <T>(handle: AnyTx): T =>
  Either.getOrThrow(
    WalletTransaction.unwrapWithin<T>(
      handle,
      ProtocolVersion.epochOf(handle.protocolVersion, ProtocolVersion.MinSupportedVersion),
    ),
  );

/** A facade holding shielded tokens and Night, with Dust generated from its Night to pay fees with. */
const fundedFacade = () =>
  Effect.gen(function* () {
    const keys = deriveWalletKeys(SEED, NETWORK_ID);
    const simulator = yield* V9.Simulator.init({
      genesisMints: [
        { type: 'shielded', tokenType: SHIELDED, amount: tokenValue(1_000n), recipient: keys.shieldedKeys },
        {
          type: 'unshielded',
          tokenType: NIGHT,
          amount: tokenValue(100_000n),
          recipient: keys.userAddress,
          verifyingKey: keys.signatureVerifyingKey,
        },
        {
          type: 'unshielded',
          tokenType: NIGHT,
          amount: tokenValue(100_000n),
          recipient: keys.userAddress,
          verifyingKey: keys.signatureVerifyingKey,
        },
      ],
      blockProducer: V9.immediateBlockProducer(),
    });
    const config: SimulatorConfig = { simulator, networkId: NETWORK_ID, costParameters: { feeBlocksMargin: 5 } };
    const facade = yield* makeSimulatorFacade(config, keys, createSimulatorWalletFactories(config));

    yield* waitForShieldedCoins(facade);
    yield* waitForUnshieldedBalance(facade, NIGHT, 1n);
    yield* simulator.fastForward(10_000n);

    return { facade, keys };
  });

/** Registers every Night coin for Dust generation and waits until the Dust it generates can pay fees. */
const withDust = (facade: WalletFacade, keys: WalletKeys) =>
  Effect.gen(function* () {
    const registering = yield* stateOf(facade);
    const recipe = yield* Effect.promise(() =>
      facade.registerNightUtxosForDustGeneration(
        registering.unshielded.availableCoins,
        keys.signatureVerifyingKey,
        keys.unshieldedKeystore.signDataAsync,
      ),
    );
    const registration = yield* Effect.promise(() => facade.finalizeRecipe(recipe));
    yield* Effect.promise(() => facade.submitTransaction(registration));
    yield* Effect.promise(() =>
      rx.firstValueFrom(
        facade
          .state()
          .pipe(
            rx.filter(
              (s) =>
                s.dust.availableCoins.length > 0 &&
                s.unshielded.availableCoins.length > 0 &&
                s.unshielded.pendingCoins.length === 0,
            ),
          ),
      ),
    );
  });

/**
 * A caller's transaction paying out shielded tokens and Night it does not hold, and spending `spends` of the wallet's
 * own Night when given, so balancing it books coins in both wallets and, in place, adds to what the caller spent.
 */
const callersTransaction = (
  keys: WalletKeys,
  ttl: Date,
  spends: ReadonlyArray<FacadeState['unshielded']['availableCoins'][number]> = [],
) => {
  const shieldedCoin = ledger.createShieldedCoinInfo(SHIELDED, tokenValue(1n));
  const shieldedOffer = ledger.ZswapOffer.fromOutput(
    ledger.ZswapOutput.new(shieldedCoin, 0, keys.shieldedKeys.coinPublicKey, keys.shieldedKeys.encryptionPublicKey),
    shieldedCoin.type,
    shieldedCoin.value,
  );
  const intent = ledger.Intent.new(ttl);
  intent.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new(
    spends.map((coin) => ({ ...coin.utxo, owner: keys.signatureVerifyingKey })),
    [
      {
        owner: keys.userAddress,
        type: NIGHT,
        value: spends.reduce((sum, coin) => sum + coin.utxo.value, 0n) + tokenValue(1n),
      },
    ],
    [],
  );
  return ledger.Transaction.fromParts(NETWORK_ID, shieldedOffer, undefined, intent);
};

/**
 * A caller's transaction paying out shielded tokens it does not hold and carrying no intent: an unbound transaction's
 * intents are already proven, so the unshielded wallet does not balance it in place, and only balancing books here.
 */
const callersShieldedTransaction = (keys: WalletKeys) => {
  const shieldedCoin = ledger.createShieldedCoinInfo(SHIELDED, tokenValue(1n));
  return ledger.Transaction.fromParts(
    NETWORK_ID,
    ledger.ZswapOffer.fromOutput(
      ledger.ZswapOutput.new(shieldedCoin, 0, keys.shieldedKeys.coinPublicKey, keys.shieldedKeys.encryptionPublicKey),
      shieldedCoin.type,
      shieldedCoin.value,
    ),
  );
};

const unproven = (tx: ledger.UnprovenTransaction) =>
  WalletTransaction.adopt('Unproven', tx, ProtocolVersion.MinSupportedVersion);
const unbound = (tx: ledger.UnprovenTransaction) =>
  WalletTransaction.adopt('Unbound', tx.mockProve(), ProtocolVersion.MinSupportedVersion);
const finalized = (tx: ledger.UnprovenTransaction) =>
  WalletTransaction.adopt('Finalized', tx.mockProve().bind(), ProtocolVersion.MinSupportedVersion);

type Built = Readonly<{ recipe: BalancingRecipe; callersCoins: readonly string[] }>;

/**
 * Builds through one entry point, then returns the one record the call added, beside what the call booked: the
 * unshielded coins and the number of shielded coins it moved out of the spendable set.
 */
const balancedThrough = (facade: WalletFacade, build: () => Promise<Built>) =>
  Effect.gen(function* () {
    const before = yield* stateOf(facade);
    const recordsBefore = (yield* lifecycleOf(facade)).records;

    const { recipe, callersCoins } = yield* Effect.promise(build);

    const after = yield* stateOf(facade);
    const isNew = (record: Lifecycle.LifecycleRecord<LifecycleTx>): boolean =>
      !recordsBefore.some((earlier) => earlier.identifiers.some((id) => record.identifiers.includes(id)));
    const added = (yield* lifecycleOf(facade)).records.filter(isNew);
    const stillAvailable = new Set(after.unshielded.availableCoins.map(utxoKey));
    const bookedUnshielded = before.unshielded.availableCoins.map(utxoKey).filter((id) => !stillAvailable.has(id));
    const bookedShielded = before.shielded.availableCoins.length - after.shielded.availableCoins.length;
    const parts = BalancingRecipe.getTransactions(recipe);
    const identifiers = parts.flatMap((part) => carried<{ identifiers(): string[] }>(part).identifiers());

    const intentTtls = parts.flatMap((part) => [
      ...(carried<{ intents?: ReadonlyMap<number, { ttl: Date }> }>(part).intents?.values() ?? []),
    ]);
    const intentTtl = new Date(Math.min(...intentTtls.map((intent) => intent.ttl.getTime())));

    return { added, bookedUnshielded, bookedShielded, callersCoins, identifiers, parts, intentTtl };
  });

/** Checks the record a balancing call left against what the call booked and the recipe it returned. */
const expectOneBalancedRecord = (result: Effect.Effect.Success<ReturnType<typeof balancedThrough>>, ttl: Date) => {
  const { added, bookedUnshielded, bookedShielded, callersCoins, identifiers, parts } = result;

  expect(added).toHaveLength(1);
  const [record] = added;
  expect(record.state).toStrictEqual({ _tag: 'Balanced' });
  expect([...record.identifiers].sort()).toStrictEqual([...identifiers].sort());
  expect([...record.inputs.unshielded].sort()).toStrictEqual([...bookedUnshielded, ...callersCoins].sort());
  expect(record.inputs.shielded ?? []).toHaveLength(bookedShielded);
  expect(record.ttl).toStrictEqual(ttl);
  expect(record.protocolVersion).toStrictEqual(Option.some(parts[0].protocolVersion));
  expect(Option.isSome(record.tx)).toBe(true);
};

describe('A balanced transaction’s lifecycle record', () => {
  it.each([
    {
      entryPoint: 'transferTransaction',
      build: (facade: WalletFacade, _keys: WalletKeys, ttl: Date) => async (): Promise<Built> => {
        const [shieldedAddress, unshieldedAddress] = await Promise.all([
          facade.shielded.getAddress(),
          facade.unshielded.getAddress(),
        ]);
        const recipe = await facade.transferTransaction(
          [
            {
              type: 'shielded',
              outputs: [{ type: SHIELDED, receiverAddress: shieldedAddress, amount: tokenValue(1n) }],
            },
            {
              type: 'unshielded',
              outputs: [{ type: NIGHT, receiverAddress: unshieldedAddress, amount: tokenValue(1n) }],
            },
          ],
          { ttl },
        );
        return { recipe, callersCoins: [] };
      },
    },
    {
      entryPoint: 'initSwap',
      build: (facade: WalletFacade, _keys: WalletKeys, ttl: Date) => async (): Promise<Built> => {
        const unshieldedAddress = await facade.unshielded.getAddress();
        const recipe = await facade.initSwap(
          { shielded: { [SHIELDED]: tokenValue(1n) } },
          [
            {
              type: 'unshielded',
              outputs: [{ type: NIGHT, amount: tokenValue(1n), receiverAddress: unshieldedAddress }],
            },
          ],
          { ttl, payFees: true },
        );
        return { recipe, callersCoins: [] };
      },
    },
    {
      entryPoint: 'balanceFinalizedTransaction',
      build: (facade: WalletFacade, keys: WalletKeys, ttl: Date) => async (): Promise<Built> => ({
        recipe: await facade.balanceFinalizedTransaction(finalized(callersTransaction(keys, ttl)), { ttl }),
        callersCoins: [],
      }),
    },
    {
      entryPoint: 'balanceUnboundTransaction',
      build: (facade: WalletFacade, keys: WalletKeys, ttl: Date) => async (): Promise<Built> => ({
        recipe: await facade.balanceUnboundTransaction(unbound(callersShieldedTransaction(keys)), { ttl }),
        callersCoins: [],
      }),
    },
    {
      entryPoint: 'balanceUnprovenTransaction',
      build: (facade: WalletFacade, keys: WalletKeys, ttl: Date) => async (): Promise<Built> => ({
        recipe: await facade.balanceUnprovenTransaction(unproven(callersTransaction(keys, ttl)), { ttl }),
        callersCoins: [],
      }),
    },
  ])('should be left by $entryPoint, balanced, naming the coins it booked and the TTL it was given', ({ build }) =>
    Effect.gen(function* () {
      const { facade, keys } = yield* fundedFacade();
      yield* withDust(facade, keys);

      const ttl = ttlOn(facade);

      expectOneBalancedRecord(yield* balancedThrough(facade, build(facade, keys, ttl)), ttl);
    }).pipe(Effect.scoped, Effect.runPromise),
  );

  // In-place balancing hands back the caller's transaction with the wallet's inputs added: the record names every
  // coin that transaction spends, the caller's as well as the ones balancing booked, because each stays spent by it
  // until the record ends.
  it('should name every coin a transaction balanced in place spends, the caller’s as well as the wallet’s', () =>
    Effect.gen(function* () {
      const { facade, keys } = yield* fundedFacade();
      yield* withDust(facade, keys);
      const ttl = ttlOn(facade);
      // A transaction of the caller's own, built through the wallet, books the coin the caller then reuses: the state a
      // caller's coin is in when it hands the wallet a transaction that already spends it.
      const unshieldedAddress = yield* Effect.promise(() => facade.unshielded.getAddress());
      yield* Effect.promise(() =>
        facade.transferTransaction(
          [
            {
              type: 'unshielded',
              outputs: [{ type: NIGHT, receiverAddress: unshieldedAddress, amount: tokenValue(1n) }],
            },
          ],
          { ttl, payFees: false },
        ),
      );
      const [callersCoin] = (yield* stateOf(facade)).unshielded.pendingCoins;

      const result = yield* balancedThrough(facade, async () => ({
        recipe: await facade.balanceUnprovenTransaction(unproven(callersTransaction(keys, ttl, [callersCoin])), {
          ttl,
        }),
        callersCoins: [utxoKey(callersCoin)],
      }));

      expect(result.bookedUnshielded).not.toContain(utxoKey(callersCoin));
      expectOneBalancedRecord(result, ttl);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('should be left by registerNightUtxosForDustGeneration, naming the Night coins it registers', () =>
    Effect.gen(function* () {
      const { facade, keys } = yield* fundedFacade();
      const registering = yield* stateOf(facade);

      const result = yield* balancedThrough(facade, async () => ({
        recipe: await facade.registerNightUtxosForDustGeneration(
          registering.unshielded.availableCoins,
          keys.signatureVerifyingKey,
          keys.unshieldedKeystore.signDataAsync,
        ),
        callersCoins: [],
      }));

      // A Dust action is built with the facade's own TTL, so the record's is the one its intent carries.
      expectOneBalancedRecord(result, result.intentTtl);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('should be left by deregisterFromDustGeneration, naming the Night coins it deregisters', () =>
    Effect.gen(function* () {
      const { facade, keys } = yield* fundedFacade();
      yield* withDust(facade, keys);
      const registered = (yield* stateOf(facade)).unshielded.availableCoins.filter(
        (coin) => coin.meta.registeredForDustGeneration,
      );
      expect(registered.length).toBeGreaterThan(0);

      const result = yield* balancedThrough(facade, async () => ({
        recipe: await facade.deregisterFromDustGeneration(
          registered,
          keys.signatureVerifyingKey,
          keys.unshieldedKeystore.signDataAsync,
        ),
        callersCoins: [],
      }));

      // A Dust action is built with the facade's own TTL, so the record's is the one its intent carries.
      expectOneBalancedRecord(result, result.intentTtl);
    }).pipe(Effect.scoped, Effect.runPromise));
});

/** The records that hold any identifier of `tx`. */
const recordsCovering = (lifecycle: Lifecycle.TransactionLifecycle<LifecycleTx>, tx: AnyTx) => {
  const ids = carried<{ identifiers(): string[] }>(tx).identifiers();
  return lifecycle.records.filter((record) => record.identifiers.some((id) => ids.includes(id)));
};

describe('A finalized transaction’s lifecycle record', () => {
  it.each([
    {
      recipe: 'an unproven recipe of one part',
      balance: (facade: WalletFacade, _keys: WalletKeys, ttl: Date) =>
        facade.unshielded
          .getAddress()
          .then((address) =>
            facade.transferTransaction(
              [{ type: 'unshielded', outputs: [{ type: NIGHT, receiverAddress: address, amount: tokenValue(1n) }] }],
              { ttl },
            ),
          ),
    },
    {
      recipe: 'a finalized recipe of two parts',
      balance: (facade: WalletFacade, keys: WalletKeys, ttl: Date) =>
        facade.balanceFinalizedTransaction(finalized(callersTransaction(keys, ttl)), { ttl }),
    },
    {
      recipe: 'an unbound recipe',
      balance: (facade: WalletFacade, keys: WalletKeys, ttl: Date) =>
        facade.balanceUnboundTransaction(unbound(callersShieldedTransaction(keys)), { ttl }),
    },
  ])(
    'should fold $recipe into one finalized record holding the finalized transaction, begun when it was balanced by the facade’s clock',
    ({ balance }) =>
      Effect.gen(function* () {
        const { facade, keys } = yield* fundedFacade();
        yield* withDust(facade, keys);
        const ttl = ttlOn(facade);
        const balancedAt = facade.clock.now();

        const recipe = yield* Effect.promise((): Promise<BalancingRecipe> => balance(facade, keys, ttl));
        const finalizedTx = yield* Effect.promise(() => facade.finalizeRecipe(recipe));

        const records = recordsCovering(yield* lifecycleOf(facade), finalizedTx);
        expect(records).toHaveLength(1);
        const [record] = records;
        expect(record.state).toStrictEqual({ _tag: 'Finalized' });
        expect([...record.identifiers].sort()).toStrictEqual(
          [...carried<{ identifiers(): string[] }>(finalizedTx).identifiers()].sort(),
        );
        expect(
          Option.map(record.tx, (held) => Buffer.from(held.transaction.serialize()).toString('hex')),
        ).toStrictEqual(
          Option.some(Buffer.from(carried<{ serialize(): Uint8Array }>(finalizedTx).serialize()).toString('hex')),
        );
        expect(record.createdAt.epochMillis).toBe(balancedAt.getTime());
        expect(record.submittedAt).toStrictEqual(Option.none());
      }).pipe(Effect.scoped, Effect.runPromise),
  );

  it('should begin a finalized record for a transaction the facade did not balance, when the facade’s clock says', () =>
    Effect.gen(function* () {
      const { facade, keys } = yield* fundedFacade();
      const finalizedAt = facade.clock.now();

      const finalizedTx = yield* Effect.promise(() =>
        facade.finalizeTransaction(unproven(callersShieldedTransaction(keys))),
      );

      const records = recordsCovering(yield* lifecycleOf(facade), finalizedTx);
      expect(records.map((record) => record.state)).toStrictEqual([{ _tag: 'Finalized' }]);
      expect(records.map((record) => record.createdAt.epochMillis)).toStrictEqual([finalizedAt.getTime()]);
    }).pipe(Effect.scoped, Effect.runPromise));
});
