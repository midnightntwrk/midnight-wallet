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

/** An hour ahead, on a whole second: an intent's TTL is kept to the second, and the record's TTL is read off it. */
const TTL = new Date(Math.ceil((Date.now() + 60 * 60 * 1000) / 1000) * 1000);

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
  spends: ReadonlyArray<FacadeState['unshielded']['availableCoins'][number]> = [],
) => {
  const shieldedCoin = ledger.createShieldedCoinInfo(SHIELDED, tokenValue(1n));
  const shieldedOffer = ledger.ZswapOffer.fromOutput(
    ledger.ZswapOutput.new(shieldedCoin, 0, keys.shieldedKeys.coinPublicKey, keys.shieldedKeys.encryptionPublicKey),
    shieldedCoin.type,
    shieldedCoin.value,
  );
  const intent = ledger.Intent.new(TTL);
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

    return { added, bookedUnshielded, bookedShielded, callersCoins, identifiers, parts };
  });

/** Checks the record a balancing call left against what the call booked and the recipe it returned. */
const expectOneBalancedRecord = (result: Effect.Effect.Success<ReturnType<typeof balancedThrough>>) => {
  const { added, bookedUnshielded, bookedShielded, callersCoins, identifiers, parts } = result;

  expect(added).toHaveLength(1);
  const [record] = added;
  expect(record.state).toStrictEqual({ _tag: 'Balanced' });
  expect([...record.identifiers].sort()).toStrictEqual([...identifiers].sort());
  expect([...record.inputs.unshielded].sort()).toStrictEqual([...bookedUnshielded, ...callersCoins].sort());
  expect(record.inputs.shielded ?? []).toHaveLength(bookedShielded);
  expect(record.ttl).toStrictEqual(TTL);
  expect(record.protocolVersion).toStrictEqual(Option.some(parts[0].protocolVersion));
  expect(Option.isSome(record.tx)).toBe(true);
};

describe('A balanced transaction’s lifecycle record', () => {
  it.each([
    {
      entryPoint: 'transferTransaction',
      build: (facade: WalletFacade) => async (): Promise<Built> => {
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
          { ttl: TTL },
        );
        return { recipe, callersCoins: [] };
      },
    },
    {
      entryPoint: 'initSwap',
      build: (facade: WalletFacade) => async (): Promise<Built> => {
        const unshieldedAddress = await facade.unshielded.getAddress();
        const recipe = await facade.initSwap(
          { shielded: { [SHIELDED]: tokenValue(1n) } },
          [
            {
              type: 'unshielded',
              outputs: [{ type: NIGHT, amount: tokenValue(1n), receiverAddress: unshieldedAddress }],
            },
          ],
          { ttl: TTL, payFees: true },
        );
        return { recipe, callersCoins: [] };
      },
    },
    {
      entryPoint: 'balanceFinalizedTransaction',
      build: (facade: WalletFacade, keys: WalletKeys) => async (): Promise<Built> => ({
        recipe: await facade.balanceFinalizedTransaction(finalized(callersTransaction(keys)), { ttl: TTL }),
        callersCoins: [],
      }),
    },
    {
      entryPoint: 'balanceUnboundTransaction',
      build: (facade: WalletFacade, keys: WalletKeys) => async (): Promise<Built> => ({
        recipe: await facade.balanceUnboundTransaction(unbound(callersTransaction(keys)), { ttl: TTL }),
        callersCoins: [],
      }),
    },
    {
      entryPoint: 'balanceUnprovenTransaction',
      build: (facade: WalletFacade, keys: WalletKeys) => async (): Promise<Built> => ({
        recipe: await facade.balanceUnprovenTransaction(unproven(callersTransaction(keys)), { ttl: TTL }),
        callersCoins: [],
      }),
    },
  ])('should be left by $entryPoint, balanced, naming the coins it booked and the TTL it was given', ({ build }) =>
    Effect.gen(function* () {
      const { facade, keys } = yield* fundedFacade();
      yield* withDust(facade, keys);

      expectOneBalancedRecord(yield* balancedThrough(facade, build(facade, keys)));
    }).pipe(Effect.scoped, Effect.runPromise),
  );

  // In-place balancing hands back the caller's transaction with the wallet's inputs added: the record names every
  // coin that transaction spends, the caller's as well as the ones balancing booked, because each stays spent by it
  // until the record ends.
  it('should name every coin a transaction balanced in place spends, the caller’s as well as the wallet’s', () =>
    Effect.gen(function* () {
      const { facade, keys } = yield* fundedFacade();
      yield* withDust(facade, keys);
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
          { ttl: TTL, payFees: false },
        ),
      );
      const [callersCoin] = (yield* stateOf(facade)).unshielded.pendingCoins;

      const result = yield* balancedThrough(facade, async () => ({
        recipe: await facade.balanceUnprovenTransaction(unproven(callersTransaction(keys, [callersCoin])), {
          ttl: TTL,
        }),
        callersCoins: [utxoKey(callersCoin)],
      }));

      expect(result.bookedUnshielded).not.toContain(utxoKey(callersCoin));
      expectOneBalancedRecord(result);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('should be left by registerNightUtxosForDustGeneration, naming the Night coins it registers', () =>
    Effect.gen(function* () {
      const { facade, keys } = yield* fundedFacade();
      const registering = yield* stateOf(facade);

      expectOneBalancedRecord(
        yield* balancedThrough(facade, async () => ({
          recipe: await facade.registerNightUtxosForDustGeneration(
            registering.unshielded.availableCoins,
            keys.signatureVerifyingKey,
            keys.unshieldedKeystore.signDataAsync,
          ),
          callersCoins: [],
        })),
      );
    }).pipe(Effect.scoped, Effect.runPromise));

  it('should be left by deregisterFromDustGeneration, naming the Night coins it deregisters', () =>
    Effect.gen(function* () {
      const { facade, keys } = yield* fundedFacade();
      yield* withDust(facade, keys);
      const registered = (yield* stateOf(facade)).unshielded.availableCoins.filter(
        (coin) => coin.meta.registeredForDustGeneration,
      );
      expect(registered.length).toBeGreaterThan(0);

      expectOneBalancedRecord(
        yield* balancedThrough(facade, async () => ({
          recipe: await facade.deregisterFromDustGeneration(
            registered,
            keys.signatureVerifyingKey,
            keys.unshieldedKeystore.signDataAsync,
          ),
          callersCoins: [],
        })),
      );
    }).pipe(Effect.scoped, Effect.runPromise));
});
