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

import * as ledger from '@midnight-ntwrk/ledger-v8';
import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { UnshieldedAddress } from '@midnightntwrk/wallet-sdk-address-format';
import { chooseCoin } from '@midnightntwrk/wallet-sdk-capabilities';
import { ArrayOps, DateOps, EitherOps } from '@midnightntwrk/wallet-sdk-utilities';
import { Array as Arr, HashMap, pipe, Record as Rec } from 'effect';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createKeystore, PublicKey } from '../../KeyStore.js';
import { makeDefaultCoinsAndBalancesCapability } from '../CoinsAndBalances.js';
import { CoreWallet } from '../CoreWallet.js';
import { makeDefaultKeysCapability } from '../Keys.js';
import {
  type DefaultTransactingConfiguration,
  type DefaultTransactingContext,
  makeDefaultTransactingCapability,
  type TokenTransfer,
} from '../Transacting.js';
import { UnshieldedState, UtxoWithMeta } from '../UnshieldedState.js';
import { InsufficientFundsError, SpendUtxoError, TransactingError } from '../WalletError.js';

const NIGHT = ledger.nativeToken().raw;
const tokenA = ledger.sampleRawTokenType();
const tokenB = ledger.sampleRawTokenType();

type TestUtxo = UtxoWithMeta;
const utxoArbitrary = (tokenType: ledger.RawTokenType, owner: PublicKey): fc.Arbitrary<TestUtxo> => {
  return fc
    .record({
      utxo: fc.record<ledger.Utxo>({
        value: fc.bigInt({ min: 1n, max: (1n << 64n) - 1n }),
        owner: fc.constant(owner.addressHex),
        type: fc.constant(tokenType),
        intentHash: fc.context().map(() => ledger.sampleIntentHash()),
        outputNo: fc.nat(10),
      }),
      meta: fc.record({
        ctime: fc.date(),
        registeredForDustGeneration: fc.boolean(),
      }),
    })
    .map((data) => new UtxoWithMeta(data));
};

const outputArbitrary = (tokenType: ledger.RawTokenType, value: bigint): fc.Arbitrary<TokenTransfer> => {
  return fc.record({
    amount: fc.constant(value),
    type: fc.constant(tokenType),
    receiverAddress: fc
      .uint8Array({ minLength: 32, maxLength: 32 })
      .map((bytes) => Buffer.from(bytes))
      .map((bytes) => new UnshieldedAddress(bytes)),
  });
};

const walletAndTransfersArbitrary = (): fc.Arbitrary<{
  wallet: CoreWallet;
  outputs: Record<ledger.RawTokenType, ReadonlyArray<TokenTransfer>>;
}> => {
  const keystore = createKeystore(Buffer.from(ledger.sampleSigningKey(), 'hex'), NetworkId.NetworkId.Undeployed);
  const ownerPK = PublicKey.fromKeyStore(keystore);
  return fc
    .record({
      [NIGHT]: fc.array(utxoArbitrary(NIGHT, ownerPK), { minLength: 1, maxLength: 20 }),
      [tokenA]: fc.array(utxoArbitrary(tokenA, ownerPK), { minLength: 1, maxLength: 20 }),
      [tokenB]: fc.array(utxoArbitrary(tokenB, ownerPK), { minLength: 1, maxLength: 20 }),
    })
    .chain((allUtxos: Record<ledger.RawTokenType, ReadonlyArray<TestUtxo>>) => {
      const balances: Record<ledger.RawTokenType, bigint> = pipe(
        allUtxos,
        Rec.map((utxos) =>
          pipe(
            utxos,
            Arr.map((utxo) => utxo.utxo.value),
            ArrayOps.sumBigInt,
          ),
        ),
      );

      const outputsArbitrary = (type: ledger.RawTokenType): fc.Arbitrary<ReadonlyArray<TokenTransfer>> => {
        return fc.integer({ min: 1, max: allUtxos[type].length }).chain((numberOfOutputs) => {
          return fc.bigInt({ min: 1n, max: balances[type] / BigInt(numberOfOutputs) }).chain((valuePerOutput) => {
            return fc.array(outputArbitrary(type, valuePerOutput), {
              minLength: numberOfOutputs,
              maxLength: numberOfOutputs,
            });
          });
        });
      };

      return fc.record({
        utxos: fc.constant(pipe(allUtxos, Rec.values, Arr.flatten)),
        outputs: fc.record({
          [NIGHT]: outputsArbitrary(NIGHT),
          [tokenA]: outputsArbitrary(tokenA),
          [tokenB]: outputsArbitrary(tokenB),
        }),
      });
    })
    .map(({ utxos, outputs }) => {
      const state = UnshieldedState.restore(utxos, []);
      const wallet = CoreWallet.restore(
        state,
        ownerPK,
        { appliedId: 0n, highestTransactionId: 0n },
        ProtocolVersion.ProtocolVersion(1n),
        NetworkId.NetworkId.Undeployed,
      );

      return { keystore, wallet, outputs };
    });
};

describe('Unshielded wallet transacting', () => {
  const config: DefaultTransactingConfiguration = {
    networkId: NetworkId.NetworkId.Undeployed,
  };
  const context: DefaultTransactingContext = {
    coinSelection: chooseCoin,
    coinsAndBalancesCapability: makeDefaultCoinsAndBalancesCapability(),
    keysCapability: makeDefaultKeysCapability(),
  };

  it('uses fallible section for issuing transfers involving Night', () => {
    const transacting = makeDefaultTransactingCapability(config, () => context);
    const ttl = DateOps.addSeconds(new Date(), 1800);

    fc.assert(
      fc.property(walletAndTransfersArbitrary(), ({ wallet, outputs }) => {
        const outputsToUse = pipe(outputs, Rec.values, Arr.flatten);
        const { transaction } = transacting.makeTransfer(wallet, outputsToUse, ttl).pipe(EitherOps.getOrThrowLeft);

        const theIntent: ledger.Intent<ledger.SignatureEnabled, ledger.Proofish, ledger.Bindingish> = transaction
          .intents!.values()
          .take(1)
          .next().value!;

        expect(transaction.intents).toBeDefined();
        expect(transaction.intents!.size).toEqual(1);
        expect(theIntent).toBeDefined();
        // There are/should be other tests verifying intent contents. Here we only want to ensure usage of a proper section
        expect(theIntent.fallibleUnshieldedOffer).toBeDefined();
        expect(theIntent.guaranteedUnshieldedOffer).toBeUndefined();
      }),
    );
  });

  it('uses guaranteed section for issuing transfers not involving Night', () => {
    const transacting = makeDefaultTransactingCapability(config, () => context);
    const ttl = DateOps.addSeconds(new Date(), 1800);

    fc.assert(
      fc.property(walletAndTransfersArbitrary(), ({ wallet, outputs }) => {
        const outputsToUse = pipe(
          outputs,
          Rec.filter((_value, key) => key != NIGHT),
          Rec.values,
          Arr.flatten,
        );

        const { transaction } = transacting.makeTransfer(wallet, outputsToUse, ttl).pipe(EitherOps.getOrThrowLeft);

        const theIntent: ledger.Intent<ledger.SignatureEnabled, ledger.Proofish, ledger.Bindingish> = transaction
          .intents!.values()
          .take(1)
          .next().value!;

        expect(transaction.intents).toBeDefined();
        expect(transaction.intents!.size).toEqual(1);
        expect(theIntent).toBeDefined();
        // There are/should be other tests verifying intent contents. Here we only want to ensure usage of a proper section
        expect(theIntent.fallibleUnshieldedOffer).toBeUndefined();
        expect(theIntent.guaranteedUnshieldedOffer).toBeDefined();
      }),
    );
  });

  it('revert clears pending coins after makeTransfer', () => {
    const transacting = makeDefaultTransactingCapability(config, () => context);
    const ttl = DateOps.addSeconds(new Date(), 1800);

    fc.assert(
      fc.property(walletAndTransfersArbitrary(), ({ wallet, outputs }) => {
        const outputsToUse = pipe(outputs, Rec.values, Arr.flatten);

        // Make a transfer - this should move coins from available to pending
        const { newState, transaction } = transacting
          .makeTransfer(wallet, outputsToUse, ttl)
          .pipe(EitherOps.getOrThrowLeft);

        // Verify that some coins are now pending
        const pendingCountAfterTransfer = HashMap.size(UnshieldedState.pendingUtxos(newState.state));
        expect(pendingCountAfterTransfer).toBeGreaterThan(0);

        // Revert the transaction - this should move coins back from pending to available
        const revertedWallet = transacting.revertTransaction(newState, transaction).pipe(EitherOps.getOrThrowLeft);

        // Verify that pending coins are cleared and moved back to available
        expect(HashMap.size(UnshieldedState.pendingUtxos(revertedWallet.state))).toBe(0);

        // Verify the reverted wallet has the same available coins as the original wallet
        expect(HashMap.size(UnshieldedState.availableUtxos(revertedWallet.state))).toBe(
          HashMap.size(UnshieldedState.availableUtxos(wallet.state)),
        );
      }),
    );
  });

  it('revert only clears pending coins for the reverted transaction', () => {
    const transacting = makeDefaultTransactingCapability(config, () => context);
    const ttl = DateOps.addSeconds(new Date(), 1800);

    fc.assert(
      fc.property(walletAndTransfersArbitrary(), ({ wallet, outputs }) => {
        const outputsToUse = pipe(outputs, Rec.values, Arr.flatten);

        const [firstOutput, ...remainingOutputs] = outputsToUse;

        const firstOutputMapped = [
          {
            ...firstOutput,
            amount: 1n,
          },
        ];

        const { newState: stateAfterTx1, transaction: tx1 } = transacting
          .makeTransfer(wallet, firstOutputMapped, ttl)
          .pipe(EitherOps.getOrThrowLeft);
        const pendingCountAfterTx1 = HashMap.size(UnshieldedState.pendingUtxos(stateAfterTx1.state));
        expect(pendingCountAfterTx1).toBeGreaterThan(0);

        const { newState: stateAfterTx2, transaction: tx2 } = transacting
          .makeTransfer(stateAfterTx1, remainingOutputs, ttl)
          .pipe(EitherOps.getOrThrowLeft);

        const pendingCountAfterTx2 = HashMap.size(UnshieldedState.pendingUtxos(stateAfterTx2.state));
        expect(pendingCountAfterTx2).toBeGreaterThan(pendingCountAfterTx1);

        const walletAfterRevert = transacting.revertTransaction(stateAfterTx2, tx1).pipe(EitherOps.getOrThrowLeft);

        const pendingCountAfterRevert = HashMap.size(UnshieldedState.pendingUtxos(walletAfterRevert.state));
        expect(pendingCountAfterRevert).toBe(pendingCountAfterTx2 - pendingCountAfterTx1);

        const walletAfterBothReverts = transacting
          .revertTransaction(walletAfterRevert, tx2)
          .pipe(EitherOps.getOrThrowLeft);

        expect(HashMap.size(UnshieldedState.pendingUtxos(walletAfterBothReverts.state))).toBe(0);
        expect(HashMap.size(UnshieldedState.availableUtxos(walletAfterBothReverts.state))).toBe(
          HashMap.size(UnshieldedState.availableUtxos(wallet.state)),
        );
      }),
    );
  });

  describe('when signing', () => {
    it('does nothing if an unproven transaction does not have any intents', () => {
      const transacting = makeDefaultTransactingCapability(config, () => context);

      const emptyTx = ledger.Transaction.fromParts(config.networkId);
      const result = transacting
        .signUnprovenTransaction(emptyTx, () => {
          throw new Error('should not be called');
        })
        .pipe(EitherOps.getOrThrowLeft);

      expect(result).toBe(emptyTx);
    });

    it('does nothing if an unbound transaction does not have any intents', async () => {
      const transacting = makeDefaultTransactingCapability(config, () => context);

      const emptyTx = await ledger.Transaction.fromParts(config.networkId).prove(
        {
          prove() {
            return Promise.resolve(Buffer.from([42]));
          },
          check(): Promise<(bigint | undefined)[]> {
            return Promise.resolve([]);
          },
        },
        ledger.LedgerParameters.initialParameters().transactionCostModel.runtimeCostModel,
      );
      const result = transacting
        .signUnboundTransaction(emptyTx, () => {
          throw new Error('should not be called');
        })
        .pipe(EitherOps.getOrThrowLeft);

      expect(result).toBe(emptyTx);
    });
  });

  describe('rotateUtxos', () => {
    const buildWalletWithNightUtxos = (count: number): { wallet: CoreWallet; utxos: ReadonlyArray<UtxoWithMeta> } => {
      const keystore = createKeystore(Buffer.from(ledger.sampleSigningKey(), 'hex'), NetworkId.NetworkId.Undeployed);
      const ownerPK = PublicKey.fromKeyStore(keystore);
      const utxos: ReadonlyArray<UtxoWithMeta> = pipe(
        Arr.range(0, count - 1),
        Arr.map(
          (i) =>
            new UtxoWithMeta({
              utxo: {
                value: 1_000n + BigInt(i),
                owner: ownerPK.addressHex,
                type: NIGHT,
                intentHash: ledger.sampleIntentHash(),
                outputNo: i,
              },
              meta: { ctime: new Date(0), registeredForDustGeneration: false },
            }),
        ),
      );
      const state = UnshieldedState.restore(utxos, []);
      const wallet = CoreWallet.restore(
        state,
        ownerPK,
        { appliedId: 0n, highestTransactionId: 0n },
        ProtocolVersion.ProtocolVersion(1n),
        NetworkId.NetworkId.Undeployed,
      );
      return { wallet, utxos };
    };

    const transacting = makeDefaultTransactingCapability(config, () => context);
    const ttl = DateOps.addSeconds(new Date(), 1800);

    it('books all provided UTxOs into pendingUtxos and removes them from availableUtxos', () => {
      const { wallet, utxos } = buildWalletWithNightUtxos(4);
      const [guaranteedUtxo, ...fallibleUtxos] = utxos;

      const { newState } = transacting
        .rotateUtxos(wallet, [guaranteedUtxo], fallibleUtxos, wallet.publicKey.publicKey, ttl)
        .pipe(EitherOps.getOrThrowLeft);

      expect(HashMap.size(UnshieldedState.availableUtxos(newState.state))).toBe(0);
      expect(HashMap.size(UnshieldedState.pendingUtxos(newState.state))).toBe(utxos.length);
    });

    it('builds an intent with the guaranteed UTxO in the guaranteed offer and the rest in the fallible offer', () => {
      const { wallet, utxos } = buildWalletWithNightUtxos(3);
      const [guaranteedUtxo, ...fallibleUtxos] = utxos;

      const { transaction } = transacting
        .rotateUtxos(wallet, [guaranteedUtxo], fallibleUtxos, wallet.publicKey.publicKey, ttl)
        .pipe(EitherOps.getOrThrowLeft);

      expect(transaction.intents).toBeDefined();
      expect(transaction.intents!.size).toBe(1);

      const intent: ledger.Intent<ledger.SignatureEnabled, ledger.Proofish, ledger.Bindingish> = transaction
        .intents!.values()
        .take(1)
        .next().value!;

      expect(intent.guaranteedUnshieldedOffer).toBeDefined();
      expect(intent.guaranteedUnshieldedOffer!.inputs.length).toBe(1);
      expect(intent.guaranteedUnshieldedOffer!.inputs[0].intentHash).toBe(guaranteedUtxo.utxo.intentHash);

      expect(intent.fallibleUnshieldedOffer).toBeDefined();
      expect(intent.fallibleUnshieldedOffer!.inputs.length).toBe(fallibleUtxos.length);
    });

    it('omits the fallible offer when no fallible UTxOs are provided', () => {
      const { wallet, utxos } = buildWalletWithNightUtxos(1);

      const { transaction } = transacting
        .rotateUtxos(wallet, utxos, [], wallet.publicKey.publicKey, ttl)
        .pipe(EitherOps.getOrThrowLeft);

      const intent: ledger.Intent<ledger.SignatureEnabled, ledger.Proofish, ledger.Bindingish> = transaction
        .intents!.values()
        .take(1)
        .next().value!;

      expect(intent.guaranteedUnshieldedOffer).toBeDefined();
      expect(intent.guaranteedUnshieldedOffer!.inputs.length).toBe(1);
      expect(intent.fallibleUnshieldedOffer).toBeUndefined();
    });

    it('fails when a provided UTxO is not in availableUtxos', () => {
      const { wallet } = buildWalletWithNightUtxos(2);
      const unknownUtxo = new UtxoWithMeta({
        utxo: {
          value: 999n,
          owner: wallet.publicKey.addressHex,
          type: NIGHT,
          intentHash: ledger.sampleIntentHash(),
          outputNo: 999,
        },
        meta: { ctime: new Date(0), registeredForDustGeneration: false },
      });

      const error = transacting
        .rotateUtxos(wallet, [unknownUtxo], [], wallet.publicKey.publicKey, ttl)
        .pipe(EitherOps.getOrThrowRight);

      expect(error).toBeInstanceOf(SpendUtxoError);
    });

    it('fails when a provided UTxO is already pending from a prior call', () => {
      const { wallet, utxos } = buildWalletWithNightUtxos(2);
      const [first, second] = utxos;

      const { newState } = transacting
        .rotateUtxos(wallet, [first], [], wallet.publicKey.publicKey, ttl)
        .pipe(EitherOps.getOrThrowLeft);

      const error = transacting
        .rotateUtxos(newState, [first], [second], wallet.publicKey.publicKey, ttl)
        .pipe(EitherOps.getOrThrowRight);

      expect(error).toBeInstanceOf(SpendUtxoError);
    });

    it('booked UTxOs cannot be reused by a subsequent makeTransfer (race fix)', () => {
      const { wallet, utxos } = buildWalletWithNightUtxos(2);
      const [guaranteedUtxo, fallibleUtxo] = utxos;

      const { newState } = transacting
        .rotateUtxos(wallet, [guaranteedUtxo], [fallibleUtxo], wallet.publicKey.publicKey, ttl)
        .pipe(EitherOps.getOrThrowLeft);

      const totalNightInPending = pipe(
        utxos,
        Arr.map((u) => u.utxo.value),
        ArrayOps.sumBigInt,
      );

      const error = transacting
        .makeTransfer(
          newState,
          [
            {
              amount: totalNightInPending,
              type: NIGHT,
              receiverAddress: new UnshieldedAddress(Buffer.alloc(32, 1)),
            },
          ],
          ttl,
        )
        .pipe(EitherOps.getOrThrowRight);

      expect(error).toBeInstanceOf(InsufficientFundsError);
    });

    it('revertTransaction restores booked UTxOs from pending back to available', () => {
      const { wallet, utxos } = buildWalletWithNightUtxos(3);
      const [guaranteedUtxo, ...fallibleUtxos] = utxos;

      const { newState: bookedState, transaction } = transacting
        .rotateUtxos(wallet, [guaranteedUtxo], fallibleUtxos, wallet.publicKey.publicKey, ttl)
        .pipe(EitherOps.getOrThrowLeft);

      // Sanity check: booking did move every UTxO from available to pending.
      expect(HashMap.size(UnshieldedState.availableUtxos(bookedState.state))).toBe(0);
      expect(HashMap.size(UnshieldedState.pendingUtxos(bookedState.state))).toBe(utxos.length);

      const restoredState = transacting.revertTransaction(bookedState, transaction).pipe(EitherOps.getOrThrowLeft);

      // Revert contract: every booked UTxO returns to availableUtxos, pendingUtxos drains to empty.
      // This is the primitive the facade's catch block relies on when a later build step fails after
      // rotateUtxos has already booked.
      expect(HashMap.size(UnshieldedState.availableUtxos(restoredState.state))).toBe(utxos.length);
      expect(HashMap.size(UnshieldedState.pendingUtxos(restoredState.state))).toBe(0);
    });

    // ADR 0008: bookings are not persisted, so after a restart the coins a submitted-but-unconfirmed transaction is
    // spending have to be re-reserved from the transaction itself. This is the operation the facade calls at init for
    // every transaction the pending-transactions service restored.
    it('bookTransaction books this wallet s inputs, expiring at the transaction s ttl', () => {
      const { wallet, utxos } = buildWalletWithNightUtxos(2);
      const [first, ...rest] = utxos;
      const { transaction } = transacting
        .rotateUtxos(wallet, [first], rest, wallet.publicKey.publicKey, ttl)
        .pipe(EitherOps.getOrThrowLeft);

      // A fresh wallet owning the same coins: the restart case, where nothing is booked yet.
      const booked = transacting.bookTransaction(wallet, transaction).pipe(EitherOps.getOrThrowLeft);

      expect(HashMap.size(UnshieldedState.pendingUtxos(booked.state))).toBe(utxos.length);
      expect(HashMap.size(UnshieldedState.availableUtxos(booked.state))).toBe(0);
      // The ledger stores an intent's TTL to whole seconds, so the expiry read back off the transaction is the
      // second-truncated ttl, not the millisecond one passed to rotateUtxos.
      const ttlInLedger = new Date(Math.floor(ttl.getTime() / 1000) * 1000);
      expect(Array.from(HashMap.values(booked.state.bookings)).map((b) => b.expiresAt)).toEqual(
        utxos.map(() => ttlInLedger),
      );
    });

    it('bookTransaction skips a coin this wallet no longer owns', () => {
      // The spend may have confirmed before the restart, in which case sync has already removed the coin. Re-reserving
      // must not fail on it, or one stale pending entry would break every wallet's startup.
      const { wallet, utxos } = buildWalletWithNightUtxos(2);
      const [first, ...rest] = utxos;
      const { transaction } = transacting
        .rotateUtxos(wallet, [first], rest, wallet.publicKey.publicKey, ttl)
        .pipe(EitherOps.getOrThrowLeft);

      const withoutFirst = CoreWallet.applyUpdate(wallet, {
        createdUtxos: [],
        spentUtxos: [first],
        status: 'SUCCESS',
      }).pipe(EitherOps.getOrThrowLeft);

      const booked = transacting.bookTransaction(withoutFirst, transaction).pipe(EitherOps.getOrThrowLeft);

      expect(HashMap.size(UnshieldedState.pendingUtxos(booked.state))).toBe(rest.length);
      expect(HashMap.size(booked.state.bookings)).toBe(rest.length);
    });

    it('fails when no UTxOs are provided in either section', () => {
      const { wallet } = buildWalletWithNightUtxos(1);

      const error = transacting
        .rotateUtxos(wallet, [], [], wallet.publicKey.publicKey, ttl)
        .pipe(EitherOps.getOrThrowRight);

      expect(error).toBeInstanceOf(TransactingError);
    });
  });
});
