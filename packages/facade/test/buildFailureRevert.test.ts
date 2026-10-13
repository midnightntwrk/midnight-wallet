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
 * A builder that rejects hands the caller no transaction, so the caller has nothing to revert. Whatever the builder
 * booked before the failing step must therefore be released by the builder itself, in every wallet that booked, along
 * with the reservation record that stood for the booking.
 *
 * Each builder books in up to three wallets in sequence, so it can fail at three kinds of step:
 *
 * - Fee payment, after the shielded and unshielded wallets have booked: the wallet has no Dust to pay with.
 * - The second of the shielded and unshielded wallets, after the first has booked: it cannot cover its part.
 * - After fee payment, once Dust has booked as well: the merge that folds the fee-paying transaction into the rest. In
 *   the field this is where a protocol fork landing mid-build is caught, which the simulator cannot stage on demand, so
 *   the failure is injected there.
 */
import * as ledger from '@midnightntwrk/ledger-v9';
import {
  type FinalizedTx,
  NetworkId,
  ProtocolVersion,
  type UnprovenTx,
  WalletTransaction,
} from '@midnightntwrk/wallet-sdk-abstractions';
import { type PendingTransactions } from '@midnightntwrk/wallet-sdk-capabilities/pendingTransactions';
import { Simulator, immediateBlockProducer } from '@midnightntwrk/wallet-sdk-capabilities/simulation';
import { Effect } from 'effect';
import * as rx from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { type FacadeState, type WalletFacade } from '../src/index.js';
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
const SHIELDED_HELD = tokenValue(1_000n);
const NIGHT_HELD = tokenValue(100_000n);
const MORE_NIGHT_THAN_HELD = NIGHT_HELD * 10n;
const MORE_SHIELDED_THAN_HELD = SHIELDED_HELD * 10n;

const hourFromNow = (): Date => new Date(Date.now() + 60 * 60 * 1000);

const utxoKey = (coin: { utxo: { intentHash: string; outputNo: number } }): string =>
  `${coin.utxo.intentHash}#${coin.utxo.outputNo}`;

const pendingSet = (facade: WalletFacade): Effect.Effect<PendingTransactions.PendingTransactions<FinalizedTx>> =>
  Effect.promise(() => rx.firstValueFrom(facade.pendingTransactionsService.state()));

/** What a booking would move out of the spendable set, in each of the three wallets. */
const spendable = (state: FacadeState) => ({
  shielded: state.shielded.availableCoins.map((c) => c.coin.nonce).sort(),
  unshielded: state.unshielded.availableCoins.map(utxoKey).sort(),
  dust: state.dust.availableCoins.map((c) => String(c.token.nonce)).sort(),
});

/**
 * A facade funded with shielded tokens and Night. Without Dust, any builder that pays fees fails at that step; with
 * Dust, fee payment succeeds and books a Dust coin too.
 */
const fundedFacade = ({ withDust }: { withDust: boolean }) =>
  Effect.gen(function* () {
    const keys = deriveWalletKeys(SEED, NETWORK_ID);
    const simulator = yield* Simulator.init({
      genesisMints: [
        { type: 'shielded', tokenType: SHIELDED, amount: SHIELDED_HELD, recipient: keys.shieldedKeys },
        {
          type: 'unshielded',
          tokenType: NIGHT,
          amount: NIGHT_HELD,
          recipient: keys.userAddress,
          verifyingKey: keys.signatureVerifyingKey,
        },
      ],
      blockProducer: immediateBlockProducer(),
    });
    const config: SimulatorConfig = { simulator, networkId: NETWORK_ID, costParameters: { feeBlocksMargin: 5 } };
    const facade = yield* makeSimulatorFacade(config, keys, createSimulatorWalletFactories(config));

    yield* waitForShieldedCoins(facade);
    yield* waitForUnshieldedBalance(facade, NIGHT, 1n);

    if (withDust) {
      // Registration pays its own fee out of the Dust its Night would have generated, so time has to pass first.
      yield* simulator.fastForward(10_000n);
      const registering: FacadeState = yield* Effect.promise(() => rx.firstValueFrom(facade.state()));
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
      yield* Effect.promise(() =>
        rx.firstValueFrom(
          facade.pendingTransactionsService
            .state()
            .pipe(rx.filter((p) => p.reservations.length === 0 && p.all.length === 0)),
        ),
      );
    }

    const before: FacadeState = yield* Effect.promise(() => rx.firstValueFrom(facade.state()));
    const shieldedAddress = yield* Effect.promise(() => facade.shielded.getAddress());
    const unshieldedAddress = yield* Effect.promise(() => facade.unshielded.getAddress());

    return { facade, keys, before, shieldedAddress, unshieldedAddress };
  });

/**
 * A caller's transaction that pays out `shielded` tokens it does not hold, and `night` Night when given, so balancing
 * it has to book coins in the shielded wallet, and in the unshielded wallet too when `night` is given. The Night output
 * sits in the guaranteed segment, the one every balancing path covers.
 */
const callersTransaction = (
  keys: WalletKeys,
  { shielded, night }: { shielded: bigint; night?: bigint },
): ledger.UnprovenTransaction => {
  const shieldedCoin = ledger.createShieldedCoinInfo(SHIELDED, shielded);
  const shieldedOutput = ledger.ZswapOutput.new(
    shieldedCoin,
    0,
    keys.shieldedKeys.coinPublicKey,
    keys.shieldedKeys.encryptionPublicKey,
  );
  const shieldedOffer = ledger.ZswapOffer.fromOutput(shieldedOutput, shieldedCoin.type, shieldedCoin.value);
  if (night === undefined) {
    return ledger.Transaction.fromParts(NETWORK_ID, shieldedOffer);
  }
  const intent = ledger.Intent.new(hourFromNow());
  intent.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new(
    [],
    [{ owner: keys.userAddress, type: NIGHT, value: night }],
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

/**
 * Runs a builder that is expected to reject at a given step, then reads what it left behind. Rejecting for any other
 * reason would mean the bookings under test were never all taken, so the reason is part of the check.
 */
const afterRejection = (facade: WalletFacade, build: () => Promise<unknown>, reason: string) =>
  Effect.gen(function* () {
    const failure = yield* Effect.flip(Effect.tryPromise(build));
    expect(String(failure.error)).toContain(reason);

    const after: FacadeState = yield* Effect.promise(() => rx.firstValueFrom(facade.state()));
    const pending = yield* pendingSet(facade);
    return { after, pending };
  });

const INJECTED_FAILURE = 'the step after fee payment failed';

/**
 * Makes the merge that folds the fee-paying transaction into the rest reject, leaving Dust balancing itself real so
 * that its booking is taken first.
 */
const failAfterFeePayment = (facade: WalletFacade): void => {
  const feeTransactions = new Set<UnprovenTx>();
  const balanceTransactions = facade.dust.balanceTransactions.bind(facade.dust);
  vi.spyOn(facade.dust, 'balanceTransactions').mockImplementation(async (...args) => {
    const result = await balanceTransactions(...args);
    feeTransactions.add(result.transaction);
    return result;
  });
  // Type cast required because: the merge is a private step of the facade, and it is the one step every builder runs
  // after fee payment, so it is where a failure after Dust has booked can be placed.
  const internals = facade as unknown as {
    mergeUnprovenTransactions: (a: UnprovenTx | undefined, b: UnprovenTx | undefined) => UnprovenTx | undefined;
  };
  const merge = internals.mergeUnprovenTransactions.bind(facade);
  vi.spyOn(internals, 'mergeUnprovenTransactions').mockImplementation((a, b) => {
    if (b !== undefined && feeTransactions.has(b)) {
      throw new Error(INJECTED_FAILURE);
    }
    return merge(a, b);
  });
};

/** Records the error fee payment rejects with, so a test can tell that exact error apart from anything built around it. */
const recordFeePaymentFailure = (facade: WalletFacade): { readonly failures: unknown[] } => {
  const failures: unknown[] = [];
  const balanceTransactions = facade.dust.balanceTransactions.bind(facade.dust);
  vi.spyOn(facade.dust, 'balanceTransactions').mockImplementation(async (...args) => {
    try {
      return await balanceTransactions(...args);
    } catch (error) {
      failures.push(error);
      throw error;
    }
  });
  return { failures };
};

const expectNothingLeftBooked = (
  before: FacadeState,
  after: FacadeState,
  pending: PendingTransactions.PendingTransactions<FinalizedTx>,
): void => {
  expect(spendable(after)).toEqual(spendable(before));
  expect(pending.reservations).toEqual([]);
};

describe('A builder that rejects at fee payment', () => {
  const NO_DUST = 'could not balance dust';

  it('should leave every coin a transfer booked spendable and no reservation behind, because the caller has no transaction to revert', () =>
    Effect.gen(function* () {
      const { facade, before, shieldedAddress, unshieldedAddress } = yield* fundedFacade({ withDust: false });

      const { after, pending } = yield* afterRejection(
        facade,
        () =>
          facade.transferTransaction(
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
            { ttl: hourFromNow(), payFees: true },
          ),
        NO_DUST,
      );

      expectNothingLeftBooked(before, after, pending);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('should leave every coin a swap booked spendable and no reservation behind, because the caller has no transaction to revert', () =>
    Effect.gen(function* () {
      const { facade, before, unshieldedAddress } = yield* fundedFacade({ withDust: false });

      const { after, pending } = yield* afterRejection(
        facade,
        () =>
          facade.initSwap(
            { shielded: { [SHIELDED]: tokenValue(1n) }, unshielded: { [NIGHT]: tokenValue(1n) } },
            [
              {
                type: 'unshielded',
                outputs: [{ type: NIGHT, receiverAddress: unshieldedAddress, amount: tokenValue(2n) }],
              },
            ],
            { ttl: hourFromNow(), payFees: true },
          ),
        NO_DUST,
      );

      expectNothingLeftBooked(before, after, pending);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('should leave every coin balancing an unproven transaction booked spendable and no reservation behind, because the caller has no transaction to revert', () =>
    Effect.gen(function* () {
      const { facade, keys, before } = yield* fundedFacade({ withDust: false });
      const tx = unproven(callersTransaction(keys, { shielded: tokenValue(1n), night: tokenValue(1n) }));

      const { after, pending } = yield* afterRejection(
        facade,
        () => facade.balanceUnprovenTransaction(tx, { ttl: hourFromNow() }),
        NO_DUST,
      );

      expectNothingLeftBooked(before, after, pending);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('should leave every coin balancing an unbound transaction booked spendable and no reservation behind, because the caller has no transaction to revert', () =>
    Effect.gen(function* () {
      const { facade, keys, before } = yield* fundedFacade({ withDust: false });
      // Proving binds the caller's intent, which in-place unshielded balancing refuses to extend, so the caller's
      // unbound transaction asks only for shielded funds.
      const tx = unbound(callersTransaction(keys, { shielded: tokenValue(1n) }));

      const { after, pending } = yield* afterRejection(
        facade,
        () => facade.balanceUnboundTransaction(tx, { ttl: hourFromNow() }),
        NO_DUST,
      );

      expectNothingLeftBooked(before, after, pending);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('should leave every coin balancing a finalized transaction booked spendable and no reservation behind, because the caller has no transaction to revert', () =>
    Effect.gen(function* () {
      const { facade, keys, before } = yield* fundedFacade({ withDust: false });
      const tx = finalized(callersTransaction(keys, { shielded: tokenValue(1n), night: tokenValue(1n) }));

      const { after, pending } = yield* afterRejection(
        facade,
        () => facade.balanceFinalizedTransaction(tx, { ttl: hourFromNow() }),
        NO_DUST,
      );

      expectNothingLeftBooked(before, after, pending);
    }).pipe(Effect.scoped, Effect.runPromise));
});

describe('A builder whose bookings are released after it fails', () => {
  const transfer =
    ({ facade, shieldedAddress, unshieldedAddress }: Effect.Effect.Success<ReturnType<typeof fundedFacade>>) =>
    () =>
      facade.transferTransaction(
        [
          { type: 'shielded', outputs: [{ type: SHIELDED, receiverAddress: shieldedAddress, amount: tokenValue(1n) }] },
          {
            type: 'unshielded',
            outputs: [{ type: NIGHT, receiverAddress: unshieldedAddress, amount: tokenValue(1n) }],
          },
        ],
        { ttl: hourFromNow(), payFees: true },
      );

  it('should reject with the failing step’s own error, unwrapped, when every release succeeded, so a caller matching on it is unaffected', () =>
    Effect.gen(function* () {
      const funded = yield* fundedFacade({ withDust: false });
      const { failures } = recordFeePaymentFailure(funded.facade);

      const failure = yield* Effect.flip(Effect.tryPromise(transfer(funded)));

      expect(failures).toHaveLength(1);
      expect(failure.error).toBe(failures[0]);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('should reject with an AggregateError holding the step’s error first and then the release’s, when a release itself fails, so a booking left behind is never silent', () =>
    Effect.gen(function* () {
      const funded = yield* fundedFacade({ withDust: false });
      const { failures } = recordFeePaymentFailure(funded.facade);
      const releaseFailure = new Error('the shielded wallet could not release its booking');
      vi.spyOn(funded.facade.shielded, 'revertTransaction').mockRejectedValue(releaseFailure);

      const failure = yield* Effect.flip(Effect.tryPromise(transfer(funded)));

      expect(failures).toHaveLength(1);
      expect(failure.error).toBeInstanceOf(AggregateError);
      // Type cast required because: the instance check above has just established the class.
      const { errors } = failure.error as AggregateError;
      expect(errors).toEqual([failures[0], releaseFailure]);
      expect(errors[0]).toBe(failures[0]);
      expect(errors[1]).toBe(releaseFailure);
    }).pipe(Effect.scoped, Effect.runPromise));
});

describe('A builder that rejects at its second wallet', () => {
  const NO_FUNDS = 'Insufficient';

  it('should leave the shielded coins a transfer booked spendable when the unshielded wallet cannot cover its part', () =>
    Effect.gen(function* () {
      const { facade, before, shieldedAddress, unshieldedAddress } = yield* fundedFacade({ withDust: false });

      const { after, pending } = yield* afterRejection(
        facade,
        () =>
          facade.transferTransaction(
            [
              {
                type: 'shielded',
                outputs: [{ type: SHIELDED, receiverAddress: shieldedAddress, amount: tokenValue(1n) }],
              },
              {
                type: 'unshielded',
                outputs: [{ type: NIGHT, receiverAddress: unshieldedAddress, amount: MORE_NIGHT_THAN_HELD }],
              },
            ],
            { ttl: hourFromNow(), payFees: false },
          ),
        NO_FUNDS,
      );

      expectNothingLeftBooked(before, after, pending);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('should leave the shielded coins a swap booked spendable when the unshielded wallet cannot cover its part', () =>
    Effect.gen(function* () {
      const { facade, before, unshieldedAddress } = yield* fundedFacade({ withDust: false });

      const { after, pending } = yield* afterRejection(
        facade,
        () =>
          facade.initSwap(
            { shielded: { [SHIELDED]: tokenValue(1n) }, unshielded: { [NIGHT]: MORE_NIGHT_THAN_HELD } },
            [
              {
                type: 'unshielded',
                outputs: [{ type: NIGHT, receiverAddress: unshieldedAddress, amount: tokenValue(1n) }],
              },
            ],
            { ttl: hourFromNow(), payFees: false },
          ),
        NO_FUNDS,
      );

      expectNothingLeftBooked(before, after, pending);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('should leave the shielded coins balancing an unproven transaction booked spendable when the unshielded wallet cannot cover its part', () =>
    Effect.gen(function* () {
      const { facade, keys, before } = yield* fundedFacade({ withDust: false });
      const tx = unproven(callersTransaction(keys, { shielded: tokenValue(1n), night: MORE_NIGHT_THAN_HELD }));

      const { after, pending } = yield* afterRejection(
        facade,
        () =>
          facade.balanceUnprovenTransaction(tx, {
            ttl: hourFromNow(),
            tokenKindsToBalance: ['shielded', 'unshielded'],
          }),
        NO_FUNDS,
      );

      expectNothingLeftBooked(before, after, pending);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('should leave the shielded coins balancing an unbound transaction booked spendable when the unshielded wallet cannot extend it', () =>
    Effect.gen(function* () {
      const { facade, keys, before } = yield* fundedFacade({ withDust: false });
      // The caller's proven intent asks for Night, and in-place unshielded balancing cannot add to a bound intent.
      const tx = unbound(callersTransaction(keys, { shielded: tokenValue(1n), night: tokenValue(1n) }));

      const { after, pending } = yield* afterRejection(
        facade,
        () =>
          facade.balanceUnboundTransaction(tx, { ttl: hourFromNow(), tokenKindsToBalance: ['shielded', 'unshielded'] }),
        'already bound',
      );

      expectNothingLeftBooked(before, after, pending);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('should leave the unshielded coins balancing a finalized transaction booked spendable, and no reservation behind, when the shielded wallet cannot cover its part', () =>
    Effect.gen(function* () {
      const { facade, keys, before } = yield* fundedFacade({ withDust: false });
      const tx = finalized(callersTransaction(keys, { shielded: MORE_SHIELDED_THAN_HELD, night: tokenValue(1n) }));

      const { after, pending } = yield* afterRejection(
        facade,
        () =>
          facade.balanceFinalizedTransaction(tx, {
            ttl: hourFromNow(),
            tokenKindsToBalance: ['shielded', 'unshielded'],
          }),
        NO_FUNDS,
      );

      expectNothingLeftBooked(before, after, pending);
    }).pipe(Effect.scoped, Effect.runPromise));
});

describe('A builder that rejects after fee payment', () => {
  it('should leave every coin a transfer booked spendable, Dust included, and no reservation behind', () =>
    Effect.gen(function* () {
      const { facade, before, shieldedAddress, unshieldedAddress } = yield* fundedFacade({ withDust: true });
      failAfterFeePayment(facade);

      const { after, pending } = yield* afterRejection(
        facade,
        () =>
          facade.transferTransaction(
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
            { ttl: hourFromNow(), payFees: true },
          ),
        INJECTED_FAILURE,
      );

      expectNothingLeftBooked(before, after, pending);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('should leave every coin a swap booked spendable, Dust included, and no reservation behind', () =>
    Effect.gen(function* () {
      const { facade, before, unshieldedAddress } = yield* fundedFacade({ withDust: true });
      failAfterFeePayment(facade);

      const { after, pending } = yield* afterRejection(
        facade,
        () =>
          facade.initSwap(
            { shielded: { [SHIELDED]: tokenValue(1n) }, unshielded: { [NIGHT]: tokenValue(1n) } },
            [
              {
                type: 'unshielded',
                outputs: [{ type: NIGHT, receiverAddress: unshieldedAddress, amount: tokenValue(2n) }],
              },
            ],
            { ttl: hourFromNow(), payFees: true },
          ),
        INJECTED_FAILURE,
      );

      expectNothingLeftBooked(before, after, pending);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('should leave every coin balancing an unproven transaction booked spendable, Dust included, and no reservation behind', () =>
    Effect.gen(function* () {
      const { facade, keys, before } = yield* fundedFacade({ withDust: true });
      failAfterFeePayment(facade);
      const tx = unproven(callersTransaction(keys, { shielded: tokenValue(1n), night: tokenValue(1n) }));

      const { after, pending } = yield* afterRejection(
        facade,
        () => facade.balanceUnprovenTransaction(tx, { ttl: hourFromNow() }),
        INJECTED_FAILURE,
      );

      expectNothingLeftBooked(before, after, pending);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('should leave every coin balancing an unbound transaction booked spendable, Dust included, and no reservation behind', () =>
    Effect.gen(function* () {
      const { facade, keys, before } = yield* fundedFacade({ withDust: true });
      failAfterFeePayment(facade);
      const tx = unbound(callersTransaction(keys, { shielded: tokenValue(1n) }));

      const { after, pending } = yield* afterRejection(
        facade,
        () => facade.balanceUnboundTransaction(tx, { ttl: hourFromNow() }),
        INJECTED_FAILURE,
      );

      expectNothingLeftBooked(before, after, pending);
    }).pipe(Effect.scoped, Effect.runPromise));

  it('should leave every coin balancing a finalized transaction booked spendable, Dust included, and no reservation behind', () =>
    Effect.gen(function* () {
      const { facade, keys, before } = yield* fundedFacade({ withDust: true });
      failAfterFeePayment(facade);
      const tx = finalized(callersTransaction(keys, { shielded: tokenValue(1n), night: tokenValue(1n) }));

      const { after, pending } = yield* afterRejection(
        facade,
        () => facade.balanceFinalizedTransaction(tx, { ttl: hourFromNow() }),
        INJECTED_FAILURE,
      );

      expectNothingLeftBooked(before, after, pending);
    }).pipe(Effect.scoped, Effect.runPromise));
});
