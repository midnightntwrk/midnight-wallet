import { TokenTransfer } from '@midnight-ntwrk/wallet-api';
import {
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
} from '@midnight-ntwrk/wallet-sdk-address-format';
import { chooseCoin } from '@midnight-ntwrk/wallet-sdk-capabilities';
import * as zswap from '@midnight-ntwrk/zswap';
import { Array as Arr, Effect, Either, Iterable, Order, pipe, Record } from 'effect';
import { describe, expect, it } from 'vitest';
import { ArrayOps, EitherOps } from '../../effect/index';
import { makeDefaultCoinsAndBalancesCapability } from '../CoinsAndBalances';
import { makeDefaultKeysCapability } from '../Keys';
import { makeSimulatorProvingService } from '../Proving';
import { BalanceTransactionToProve, NOTHING_TO_PROVE } from '../ProvingRecipe';
import { V1State } from '../RunningV1Variant';
import {
  DefaultTransactingConfiguration,
  DefaultTransactingContext,
  makeSimulatorTransactingCapability,
} from '../Transacting';

const dust = (value: number): bigint => BigInt(value * 10 ** 6);

const defaultConfig: DefaultTransactingConfiguration = {
  networkId: zswap.NetworkId.Undeployed,
  costParameters: {
    additionalFeeOverhead: 100_000n,
    ledgerParams: zswap.LedgerParameters.dummyParameters(),
  },
};
const defaultContext: DefaultTransactingContext = {
  coinSelection: chooseCoin,
  coinsAndBalancesCapability: makeDefaultCoinsAndBalancesCapability(),
  keysCapability: makeDefaultKeysCapability(),
};

const coinsAndBalances = makeDefaultCoinsAndBalancesCapability();
const getAvailableCoins = (state: V1State): readonly zswap.QualifiedCoinInfo[] => {
  return coinsAndBalances.getAvailableCoins(state).map((c) => c.coin);
};

type WalletEntry = {
  keys: zswap.SecretKeys;
  coins: ReadonlyArray<bigint | { tokenType: zswap.TokenType; value: bigint }>;
};
const prepareWallets = <Names extends string>(desired: Record<Names, WalletEntry>): Record<Names, V1State> => {
  const tx = pipe(
    Record.values(desired),
    Arr.flatMap((aWalletEntry: WalletEntry) =>
      Arr.map(aWalletEntry.coins, (coin) => ({ keys: aWalletEntry.keys, coin })),
    ),
    Arr.map(({ keys, coin }) =>
      makeOutputOffer({
        recipient: keys,
        coin: typeof coin === 'bigint' ? coin : zswap.createCoinInfo(coin.tokenType, coin.value),
      }),
    ),
    ArrayOps.assertNonEmpty,
    ArrayOps.fold((offerA: zswap.UnprovenOffer, offerB: zswap.UnprovenOffer) => offerA.merge(offerB)),
    (offer) => new zswap.UnprovenTransaction(offer).eraseProofs(),
  );

  return pipe(
    desired,
    Record.map((entry) => {
      const state = new zswap.LocalState().applyProofErasedTx(entry.keys, tx, 'success');
      return V1State.init(state, entry.keys, zswap.NetworkId.Undeployed);
    }),
  );
};

const orderCoinByValue = Order.mapInput(Order.bigint, (coin: { value: bigint }) => coin.value);

const makeOutputOffer = (args: {
  recipient: zswap.SecretKeys | V1State;
  coin: zswap.CoinInfo | bigint;
  segment?: 0 | 1;
}): zswap.UnprovenOffer => {
  const keys: zswap.SecretKeys =
    args.recipient instanceof zswap.SecretKeys ? args.recipient : args.recipient.secretKeys;
  const coinToUse = typeof args.coin === 'bigint' ? zswap.createCoinInfo(zswap.nativeToken(), args.coin) : args.coin;
  const output = zswap.UnprovenOutput.new(coinToUse, args.segment ?? 0, keys.coinPublicKey, keys.encryptionPublicKey);
  return zswap.UnprovenOffer.fromOutput(output, coinToUse.type, coinToUse.value);
};

const encodeAddress = (keys: zswap.SecretKeys): string => {
  return ShieldedAddress.codec
    .encode(
      zswap.NetworkId.Undeployed,
      new ShieldedAddress(
        ShieldedCoinPublicKey.fromHexString(keys.coinPublicKey),
        ShieldedEncryptionPublicKey.fromHexString(keys.encryptionPublicKey),
      ),
    )
    .asString();
};

const makeTransferOutput = (args: {
  recipient: zswap.SecretKeys | V1State;
  coin: bigint | { tokenType: zswap.TokenType; value: bigint };
}): TokenTransfer => {
  const typeAndValue = typeof args.coin == 'bigint' ? { tokenType: zswap.nativeToken(), value: args.coin } : args.coin;
  const keys = args.recipient instanceof zswap.SecretKeys ? args.recipient : args.recipient.secretKeys;
  return {
    type: typeAndValue.tokenType,
    amount: typeAndValue.value,
    receiverAddress: encodeAddress(keys),
  };
};

/*
 TODO: these tests work too much against zswap.LocalState
 Instead, they should be using coins and balances capabilities more, to not depend much on the underlying data
*/
describe('V1 Wallet Transacting', () => {
  describe('when balancing', () => {
    it('balances a transaction containing just outputs', async () => {
      const wallets = prepareWallets({
        A: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: [dust(1), dust(2), dust(3)] },
        B: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);
      const proving = makeSimulatorProvingService();
      const transactionValue = dust(4);
      const tx = pipe(transactionValue, (value) => {
        const offer = makeOutputOffer({ recipient: wallets.B, coin: value });
        return new zswap.UnprovenTransaction(offer).eraseProofs();
      });

      return Effect.gen(function* () {
        const result = Either.getOrThrow(transacting.balanceTransaction(wallets.A, tx, []));
        const recipe = result.recipe as BalanceTransactionToProve<zswap.ProofErasedTransaction>;
        const proven = yield* proving.prove(recipe);
        expect(recipe.transactionToProve.guaranteedCoins?.deltas.get(zswap.nativeToken())).toBeGreaterThan(
          transactionValue,
        );
        expect(proven.guaranteedCoins?.deltas.get(zswap.nativeToken())).toBeGreaterThanOrEqual(
          proven.fees(zswap.LedgerParameters.dummyParameters()),
        );
        const BAfterApply = wallets.B.state.applyProofErasedTx(wallets.B.secretKeys, proven, 'success');
        expect(Array.from(BAfterApply.coins).map((c) => c.value)).toEqual([transactionValue]);
      }).pipe(Effect.runPromise);
    });

    it('balances a transaction with a fallible offer', () => {
      const wallets = prepareWallets({
        A: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: [dust(1), dust(2), dust(3)] },
        B: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);
      const proving = makeSimulatorProvingService();
      const transactionValueFallible = dust(2);
      const transactionValueGuaranteed = dust(2);
      const guaranteedOffer = makeOutputOffer({ recipient: wallets.B, coin: transactionValueGuaranteed });
      const fallibleOffer = makeOutputOffer({ recipient: wallets.B, coin: transactionValueFallible, segment: 1 });
      const tx = new zswap.UnprovenTransaction(guaranteedOffer, fallibleOffer).eraseProofs();

      return Effect.gen(function* () {
        const result = Either.getOrThrow(transacting.balanceTransaction(wallets.A, tx, []));
        const recipe = result.recipe as BalanceTransactionToProve<zswap.ProofErasedTransaction>;
        const proven = yield* proving.prove(recipe);
        expect(recipe.transactionToProve.fallibleCoins?.deltas.get(zswap.nativeToken())).toEqual(
          transactionValueFallible,
        );
        expect(recipe.transactionToProve.guaranteedCoins?.deltas.get(zswap.nativeToken())).toBeGreaterThanOrEqual(
          transactionValueGuaranteed + proven.fees(defaultConfig.costParameters.ledgerParams),
        );
        expect(proven.guaranteedCoins?.deltas.get(zswap.nativeToken())).toBeGreaterThanOrEqual(
          proven.fees(zswap.LedgerParameters.dummyParameters()),
        );
        const BAfterApply = wallets.B.state.applyProofErasedTx(wallets.B.secretKeys, proven, 'success');
        expect(Array.from(BAfterApply.coins).map((c) => c.value)).toEqual([
          transactionValueGuaranteed,
          transactionValueFallible,
        ]);
      }).pipe(Effect.runPromise);
    });

    it('books coins used in balancing', () => {
      const wallets = prepareWallets({
        A: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: [dust(1), dust(2), dust(3)] },
        B: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);
      const transactionValueFallible = dust(2);
      const transactionValueGuaranteed = dust(2);
      const guaranteedOffer = makeOutputOffer({ recipient: wallets.B, coin: transactionValueGuaranteed });
      const fallibleOffer = makeOutputOffer({ recipient: wallets.B, coin: transactionValueFallible, segment: 1 });
      const tx = new zswap.UnprovenTransaction(guaranteedOffer, fallibleOffer).eraseProofs();

      const result = Either.getOrThrow(transacting.balanceTransaction(wallets.A, tx, []));

      expect(getAvailableCoins(result.newState).length).toBe(0);
      expect(Arr.sort(result.newState.state.pendingSpends.values(), orderCoinByValue)).toEqual(
        Arr.sort(wallets.A.state.coins, orderCoinByValue),
      );
    });

    it('watches for change coins from balancing', () => {
      const wallets = prepareWallets({
        A: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: [dust(1), dust(2), dust(3)] },
        B: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);
      const transactionValueFallible = dust(2);
      const transactionValueGuaranteed = dust(2);
      const guaranteedOffer = makeOutputOffer({ recipient: wallets.B, coin: transactionValueGuaranteed });
      const fallibleOffer = makeOutputOffer({ recipient: wallets.B, coin: transactionValueFallible, segment: 1 });
      const tx = new zswap.UnprovenTransaction(guaranteedOffer, fallibleOffer).eraseProofs();

      const result = Either.getOrThrow(transacting.balanceTransaction(wallets.A, tx, []));

      const pendingOutputs = Array.from(result.newState.state.pendingOutputs.values());
      expect(pendingOutputs.length).toEqual(2);
      pendingOutputs.forEach((output) => {
        // Knowing that default coin selection is "smaller-first", and that fallible sections needs to be balanced first to properly pay fees in the guaranteed one,
        // It leaves fallible of value 2 to be balanced with coins of value 1 and 2
        // and guaranteed of value 2 to be balanced with coin of value 3
        expect(output.value).toBeLessThanOrEqual(dust(1));
      });
    });

    it('watches for new coins from balancing', () => {
      const wallets = prepareWallets({
        A: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: [dust(1), dust(2), dust(3)] },
        B: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);
      const transactionValueFallible = dust(2);
      const changeCoin = zswap.createCoinInfo(zswap.nativeToken(), dust(2));
      const guaranteedOffer = makeOutputOffer({ recipient: wallets.A, coin: changeCoin });
      const fallibleOffer = makeOutputOffer({ recipient: wallets.B, coin: transactionValueFallible, segment: 1 });
      const tx = new zswap.UnprovenTransaction(guaranteedOffer, fallibleOffer).eraseProofs();

      const result = Either.getOrThrow(transacting.balanceTransaction(wallets.A, tx, [changeCoin]));

      const pendingOutputs = Array.from(result.newState.state.pendingOutputs.values());
      expect(pendingOutputs).toContainEqual(changeCoin);
      expect(pendingOutputs.length).toEqual(3);
      for (const output of pendingOutputs.filter((c) => c.nonce !== changeCoin.nonce)) {
        expect(output.value).toBeLessThanOrEqual(dust(1));
      }
    });

    it('raises an error if there are not enough tokens for balancing', () => {
      const wallets = prepareWallets({
        A: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: [dust(1), dust(2), dust(3)] },
        B: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);
      const transactionValueFallible = dust(3);
      const changeCoin = zswap.createCoinInfo(zswap.nativeToken(), dust(3));
      const guaranteedOffer = makeOutputOffer({ recipient: wallets.A, coin: changeCoin });
      const fallibleOffer = makeOutputOffer({ recipient: wallets.B, coin: transactionValueFallible, segment: 1 });
      const tx = new zswap.UnprovenTransaction(guaranteedOffer, fallibleOffer).eraseProofs();

      const result = transacting.balanceTransaction(wallets.A, tx, [changeCoin]);

      expect(() => Either.getOrThrow(result)).toThrow();
    });

    it('does not try to spend booked coins for balancing', () => {
      const wallets = prepareWallets({
        A: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: [dust(1), dust(2), dust(3)] },
        B: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);
      const transactionValueFallible = dust(2);
      const transactionValueGuaranteed = dust(2);
      const guaranteedOffer = makeOutputOffer({ recipient: wallets.B, coin: transactionValueGuaranteed });
      const fallibleOffer = makeOutputOffer({ recipient: wallets.B, coin: transactionValueFallible, segment: 1 });
      const tx = new zswap.UnprovenTransaction(guaranteedOffer, fallibleOffer).eraseProofs();

      const result = Either.getOrThrow(transacting.balanceTransaction(wallets.A, tx, []));
      const anotherTx = pipe(makeOutputOffer({ recipient: wallets.B, coin: dust(1) }), (offer) =>
        new zswap.UnprovenTransaction(offer).eraseProofs(),
      );

      const secondResult = transacting.balanceTransaction(result.newState, anotherTx, []);

      expect(() => Either.getOrThrow(secondResult)).toThrow();
    });
  });

  describe('when transferring', () => {
    it('prepares a transfer', () => {
      const wallets = prepareWallets({
        A: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: [dust(1), dust(2), dust(3)] },
        B: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);
      const proving = makeSimulatorProvingService();

      return Effect.gen(function* () {
        const result = yield* EitherOps.toEffect(
          transacting.makeTransfer(wallets.A, [makeTransferOutput({ recipient: wallets.B, coin: dust(2) })]),
        );
        const proven = yield* proving.prove(result.recipe);

        const walletBApplied = wallets.B.state.applyProofErasedTx(wallets.B.secretKeys, proven, 'success');
        expect(Array.from(walletBApplied.coins).map((c) => c.value)).toEqual([dust(2)]);
      }).pipe(Effect.runPromise);
    });

    it('books coins used in transfer', () => {
      const initialCoinValues = [dust(1), dust(2), dust(3)];
      const transferValue = dust(2);
      const wallets = prepareWallets({
        A: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: initialCoinValues },
        B: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);
      const proving = makeSimulatorProvingService();

      return Effect.gen(function* () {
        const result = yield* EitherOps.toEffect(
          transacting.makeTransfer(wallets.A, [makeTransferOutput({ recipient: wallets.B, coin: transferValue })]),
        );
        const proven = yield* proving.prove(result.recipe);

        const bookedCoinValues = result.newState.state.pendingSpends
          .values()
          .map((c) => c.value)
          .toArray();
        const availableCoinValues = getAvailableCoins(result.newState).map((c) => c.value);
        const sumValues = ArrayOps.sumBigInt([...bookedCoinValues, ...availableCoinValues]);
        const bookedCoinsSum = ArrayOps.sumBigInt(bookedCoinValues);

        expect(sumValues).toEqual(ArrayOps.sumBigInt(initialCoinValues));
        expect(Arr.sort([...bookedCoinValues, ...availableCoinValues], Order.bigint)).toEqual(initialCoinValues);
        expect(bookedCoinsSum).toBeGreaterThanOrEqual(
          proven.fees(zswap.LedgerParameters.dummyParameters()) + transferValue,
        );
      }).pipe(Effect.runPromise);
    });

    it('watches for change coins from a transfer', () => {
      const initialCoinValues = [dust(1), dust(2), dust(3)];
      const transferValue = dust(2);
      const wallets = prepareWallets({
        A: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: initialCoinValues },
        B: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);

      const result = Either.getOrThrow(
        transacting.makeTransfer(wallets.A, [makeTransferOutput({ recipient: wallets.B, coin: transferValue })]),
      );

      const availableCoinValues = getAvailableCoins(result.newState).map((c) => c.value);
      const pendingCoinValues = result.newState.state.pendingOutputs
        .values()
        .map((c) => c.value)
        .toArray();
      const sumValues: bigint = pipe([pendingCoinValues, availableCoinValues], Arr.flatten, ArrayOps.sumBigInt);

      //Final total balance needs to be within range of 1 dust from original one with subtracted transfer value
      expect(sumValues).toBeGreaterThanOrEqual(ArrayOps.sumBigInt(initialCoinValues) - transferValue - dust(1));
      expect(sumValues).toBeLessThan(ArrayOps.sumBigInt(initialCoinValues) - transferValue);
      pendingCoinValues.forEach((value) => {
        expect(value).toBeLessThan(dust(1)); //knowing coin selection, we do not expect bigger pending coin
      });
    });

    it('raises an error if there are not enough tokens for transfer', () => {
      const initialCoinValues = [dust(1), dust(2), dust(3)];
      const transferValue = dust(6);
      const wallets = prepareWallets({
        A: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: initialCoinValues },
        B: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);

      const result = transacting.makeTransfer(wallets.A, [
        makeTransferOutput({ recipient: wallets.B, coin: transferValue }),
      ]);

      expect(() => Either.getOrThrow(result)).toThrow();
    });

    it('does not try to spend booked coins for a transfer', () => {
      const initialCoinValues = [dust(1), dust(2), dust(3)];
      const transferValue = dust(5);
      const wallets = prepareWallets({
        A: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: initialCoinValues },
        B: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);
      const result = Either.getOrThrow(
        transacting.makeTransfer(wallets.A, [makeTransferOutput({ recipient: wallets.B, coin: transferValue })]),
      );
      const secondResult = transacting.makeTransfer(result.newState, [
        makeTransferOutput({ recipient: wallets.B, coin: dust(1) }),
      ]);

      expect(() => Either.getOrThrow(secondResult)).toThrow();
    });
  });

  describe('when handling swaps', () => {
    it('inits a swap with dust input and non-dust output', () => {
      const theOtherTokenType = zswap.sampleTokenType();
      const theOtherTokenAmount = 10_000n;
      const initialCoinValues = [dust(1), dust(2), dust(3)];
      const wallets = prepareWallets({
        A: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: initialCoinValues },
        B: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);
      const proving = makeSimulatorProvingService();

      return Effect.gen(function* () {
        const result = yield* EitherOps.toEffect(
          transacting.initSwap(wallets.A, { [zswap.nativeToken()]: dust(1) }, [
            makeTransferOutput({
              recipient: wallets.A,
              coin: { tokenType: theOtherTokenType, value: theOtherTokenAmount },
            }),
          ]),
        );
        const proven: zswap.ProofErasedTransaction = yield* proving.prove(result.recipe);
        const imbalances = proven.imbalances(true, proven.fees(zswap.LedgerParameters.dummyParameters()));

        expect(new Set(imbalances.keys())).toEqual(new Set([zswap.nativeToken(), theOtherTokenType]));
        expect(imbalances.get(zswap.nativeToken())).toBeGreaterThan(dust(1));
        expect(imbalances.get(zswap.nativeToken())).toBeLessThanOrEqual(dust(1) + dust(1));
        expect(imbalances.get(theOtherTokenType)).toEqual(-1n * theOtherTokenAmount);
      }).pipe(Effect.runPromise);
    });

    it('inits a swap with non-dust input and dust output', () => {
      const theOtherTokenType = zswap.sampleTokenType();
      const theOtherTokenAmount = 10_000n;
      const initialCoinValues = [
        dust(1),
        dust(2),
        dust(3),
        { tokenType: theOtherTokenType, value: theOtherTokenAmount },
      ];
      const wallets = prepareWallets({
        A: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: initialCoinValues },
        B: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);
      const proving = makeSimulatorProvingService();

      return Effect.gen(function* () {
        const result = yield* EitherOps.toEffect(
          transacting.initSwap(wallets.A, { [theOtherTokenType]: theOtherTokenAmount }, [
            makeTransferOutput({
              recipient: wallets.A,
              coin: dust(1),
            }),
          ]),
        );
        const proven: zswap.ProofErasedTransaction = yield* proving.prove(result.recipe);
        const imbalances = proven.imbalances(true, proven.fees(zswap.LedgerParameters.dummyParameters()));

        expect(new Set(imbalances.keys())).toEqual(new Set([zswap.nativeToken(), theOtherTokenType]));
        expect(imbalances.get(zswap.nativeToken())).toBeLessThan(0n);
        expect(imbalances.get(zswap.nativeToken())).toBeGreaterThan(
          -1n * dust(1) + proven.fees(zswap.LedgerParameters.dummyParameters()),
        );
        expect(imbalances.get(theOtherTokenType)).toEqual(theOtherTokenAmount);
      }).pipe(Effect.runPromise);
    });

    it('inits a swap with non-dust input and non-dust output', () => {
      const theOtherTokenType1 = zswap.sampleTokenType();
      const theOtherTokenAmount1 = 10_000n;
      const theOtherTokenType2 = zswap.sampleTokenType();
      const theOtherTokenAmount2 = 10_000n;
      const initialCoinValues = [
        dust(1),
        dust(2),
        dust(3),
        { tokenType: theOtherTokenType1, value: theOtherTokenAmount1 },
      ];
      const wallets = prepareWallets({
        A: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: initialCoinValues },
        B: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);
      const proving = makeSimulatorProvingService();

      return Effect.gen(function* () {
        const result = yield* EitherOps.toEffect(
          transacting.initSwap(wallets.A, { [theOtherTokenType1]: theOtherTokenAmount1 }, [
            makeTransferOutput({
              recipient: wallets.A,
              coin: { tokenType: theOtherTokenType2, value: theOtherTokenAmount2 },
            }),
          ]),
        );
        const proven: zswap.ProofErasedTransaction = yield* proving.prove(result.recipe);
        const imbalances = proven.imbalances(true, proven.fees(zswap.LedgerParameters.dummyParameters()));

        expect(new Set(imbalances.keys())).toEqual(
          new Set([zswap.nativeToken(), theOtherTokenType1, theOtherTokenType2]),
        );
        expect(imbalances.get(zswap.nativeToken())).toBeLessThan(dust(1));
        expect(imbalances.get(zswap.nativeToken())).toBeGreaterThan(
          proven.fees(zswap.LedgerParameters.dummyParameters()),
        );
        expect(imbalances.get(theOtherTokenType1)).toEqual(theOtherTokenAmount1);
        expect(imbalances.get(theOtherTokenType2)).toEqual(-1n * theOtherTokenAmount2);
      }).pipe(Effect.runPromise);
    });

    it('balances a swap', () => {
      const theOtherTokenType = zswap.sampleTokenType();
      const theOtherTokenAmount = 10_000n;
      const dustAmount = dust(1);
      const wallets = prepareWallets({
        A: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: [dust(1), dust(2), dust(3)] },
        B: {
          keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 1)),
          coins: [dust(1), { tokenType: theOtherTokenType, value: theOtherTokenAmount }],
        },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);
      const proving = makeSimulatorProvingService();

      return Effect.gen(function* () {
        const result = yield* EitherOps.toEffect(
          transacting.initSwap(wallets.A, { [zswap.nativeToken()]: dustAmount }, [
            makeTransferOutput({
              recipient: wallets.A,
              coin: { tokenType: theOtherTokenType, value: theOtherTokenAmount },
            }),
          ]),
        );
        const proven: zswap.ProofErasedTransaction = yield* proving.prove(result.recipe);
        const balancedResult = yield* EitherOps.toEffect(transacting.balanceTransaction(wallets.B, proven, []));
        const balancedProven = yield* proving.prove(balancedResult.recipe);

        const aAfterApply: zswap.LocalState = result.newState.state.applyProofErasedTx(
          wallets.A.secretKeys,
          balancedProven,
          'success',
        );
        const bAfterApply: zswap.LocalState = balancedResult.newState.state.applyProofErasedTx(
          wallets.B.secretKeys,
          balancedProven,
          'success',
        );

        const imbalances = balancedProven.imbalances(true);

        const bAfterApplyDustCoins = bAfterApply.coins
          .values()
          .filter((c) => c.type === zswap.nativeToken())
          .map((c) => c.value)
          .toArray()
          .toSorted((a, b) => Number(a - b));

        expect(new Set(imbalances.keys())).toEqual(new Set([zswap.nativeToken()]));
        expect(imbalances.get(zswap.nativeToken())).toBeGreaterThanOrEqual(
          balancedProven.fees(defaultConfig.costParameters.ledgerParams),
        );
        expect(
          aAfterApply.coins
            .values()
            .filter((c) => c.type === theOtherTokenType)
            .map((c) => c.value)
            .toArray(),
        ).toEqual([theOtherTokenAmount]);
        expect(bAfterApplyDustCoins[0]).toBeLessThanOrEqual(dust(1)); //potential change output from balancing
        expect(bAfterApplyDustCoins[1]).toBeGreaterThanOrEqual(dust(1)); //the input to the swap
      }).pipe(Effect.runPromise);
    });

    it('books coins spent in a swap', () => {
      const theOtherTokenType = zswap.sampleTokenType();
      const theOtherTokenAmount = 10_000n;
      const initialCoinValues = [dust(1), dust(2), dust(3)];
      const wallets = prepareWallets({
        A: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: initialCoinValues },
        B: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);

      const result = Either.getOrThrow(
        transacting.initSwap(wallets.A, { [zswap.nativeToken()]: dust(1) }, [
          makeTransferOutput({
            recipient: wallets.A,
            coin: { tokenType: theOtherTokenType, value: theOtherTokenAmount },
          }),
        ]),
      );
      const bookedCoins = pipe(
        result.newState.state.pendingSpends.values(),
        Iterable.map((coin) => ({ type: coin.type, value: coin.value })),
        Arr.sort(orderCoinByValue),
      );

      expect(bookedCoins).toEqual([
        { type: zswap.nativeToken(), value: dust(1) },
        { type: zswap.nativeToken(), value: dust(2) },
      ]);
    });

    it('watches for coins expected to be received from a swap', () => {
      const theOtherTokenType = zswap.sampleTokenType();
      const theOtherTokenAmount = 10_000n;
      const dustAmount = dust(1);
      const initialCoinValues = [dust(1), dust(2), dust(3)];
      const wallets = prepareWallets({
        A: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: initialCoinValues },
        B: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);

      const result = Either.getOrThrow(
        transacting.initSwap(wallets.A, { [zswap.nativeToken()]: dustAmount }, [
          makeTransferOutput({
            recipient: wallets.A,
            coin: { tokenType: theOtherTokenType, value: theOtherTokenAmount },
          }),
        ]),
      );
      const expectedCoins = pipe(
        result.newState.state.pendingOutputs.values(),
        Record.fromIterableWith((coin: zswap.CoinInfo) => [coin.type, coin.value]),
      );

      expect(new Set(Record.keys(expectedCoins))).toEqual(new Set([zswap.nativeToken(), theOtherTokenType]));
      expect(expectedCoins[theOtherTokenType]).toEqual(theOtherTokenAmount);
      expect(expectedCoins[zswap.nativeToken()]).toBeGreaterThan(dust(1));
      expect(expectedCoins[zswap.nativeToken()]).toBeLessThan(dust(3) - dustAmount);
    });

    it('raises an error if there are not enough tokens for swap', () => {
      const theOtherTokenType = zswap.sampleTokenType();
      const theOtherTokenAmount = 10_000n;
      const dustAmount = dust(1);
      const initialCoinValues = [dust(1), dust(2), dust(3)];
      const wallets = prepareWallets({
        A: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: initialCoinValues },
        B: {
          keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 1)),
          coins: [{ tokenType: theOtherTokenType, value: theOtherTokenAmount }],
        },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);

      const resultA = transacting.initSwap(wallets.A, { [theOtherTokenType]: theOtherTokenAmount }, [
        makeTransferOutput({ recipient: wallets.A, coin: dustAmount }),
      ]);

      const resultB = transacting.initSwap(wallets.B, { [zswap.nativeToken()]: dustAmount }, [
        makeTransferOutput({
          recipient: wallets.B,
          coin: { tokenType: theOtherTokenType, value: theOtherTokenAmount },
        }),
      ]);

      expect(() => Either.getOrThrow(resultA)).toThrow();
      expect(() => Either.getOrThrow(resultB)).toThrow();
    });

    it('does not try to use booked coins for a swap', () => {
      const theOtherTokenType = zswap.sampleTokenType();
      const theOtherTokenAmount = 10_000n;
      const dustAmount = dust(1);
      const initialCoinValues = [dust(3)];
      const wallets = prepareWallets({
        A: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: initialCoinValues },
        B: {
          keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 1)),
          coins: [],
        },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);

      const firstResult = Either.getOrThrow(
        transacting.makeTransfer(wallets.A, [makeTransferOutput({ recipient: wallets.B, coin: dustAmount })]),
      );
      const secondResult = transacting.initSwap(firstResult.newState, { [zswap.nativeToken()]: dustAmount }, [
        makeTransferOutput({
          recipient: wallets.A,
          coin: { tokenType: theOtherTokenType, value: theOtherTokenAmount },
        }),
      ]);

      expect(() => Either.getOrThrow(secondResult)).toThrow();
    });
  });

  describe('when reverting and cancelling transactions', () => {
    it('reverts a transaction (e.g. due to a submission failure), releasing booked coins', () => {
      const wallets = prepareWallets({
        A: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: [dust(3)] },
        B: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);
      const proving = makeSimulatorProvingService();

      return Effect.gen(function* () {
        const result = yield* EitherOps.toEffect(
          transacting.makeTransfer(wallets.A, [makeTransferOutput({ recipient: wallets.B, coin: dust(2) })]),
        );
        const proven = yield* proving.prove(result.recipe);
        const afterRevert: V1State = Either.getOrThrow(transacting.revert(result.newState, proven));

        expect(getAvailableCoins(afterRevert).map((coin) => ({ type: coin.type, value: coin.value }))).toEqual([
          { type: zswap.nativeToken(), value: dust(3) },
        ]);
        expect(afterRevert.state.pendingSpends.size).toEqual(0);
      }).pipe(Effect.runPromise);
    });

    it('reverts a transaction (e.g. due to a submission failure), cancelling coin watches', () => {
      const wallets = prepareWallets({
        A: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: [dust(3)] },
        B: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);
      const proving = makeSimulatorProvingService();

      return Effect.gen(function* () {
        const result = yield* EitherOps.toEffect(
          transacting.makeTransfer(wallets.A, [makeTransferOutput({ recipient: wallets.B, coin: dust(2) })]),
        );
        const proven = yield* proving.prove(result.recipe);
        const afterRevert: V1State = Either.getOrThrow(transacting.revert(result.newState, proven));

        expect(afterRevert.state.pendingOutputs.size).toEqual(0);
      }).pipe(Effect.runPromise);
    });

    it('reverts a transaction merged with some other one, releasing booked coins', () => {
      const theOtherTokenType = zswap.sampleTokenType();
      const theOtherTokenAmount = 10_000n;
      const dustAmount = dust(1);
      const initialCoinValues = [dust(3)];
      const wallets = prepareWallets({
        A: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: initialCoinValues },
        B: {
          keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 1)),
          coins: [{ tokenType: theOtherTokenType, value: theOtherTokenAmount }],
        },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);
      const proving = makeSimulatorProvingService();

      return Effect.gen(function* () {
        const result = yield* EitherOps.toEffect(
          transacting.initSwap(wallets.A, { [zswap.nativeToken()]: dustAmount }, [
            makeTransferOutput({
              recipient: wallets.A,
              coin: { tokenType: theOtherTokenType, value: theOtherTokenAmount },
            }),
          ]),
        );
        const proven: zswap.ProofErasedTransaction = yield* proving.prove(result.recipe);
        const balancedResult = yield* EitherOps.toEffect(transacting.balanceTransaction(wallets.B, proven, []));
        const balancedProven = yield* proving.prove(balancedResult.recipe);

        const afterRevertA: V1State = Either.getOrThrow(transacting.revert(result.newState, balancedProven));
        const afterRevertB: V1State = Either.getOrThrow(transacting.revert(balancedResult.newState, balancedProven));

        expect(afterRevertA.state.pendingSpends.size).toEqual(0);
        expect(afterRevertB.state.pendingSpends.size).toEqual(0);
      }).pipe(Effect.runPromise);
    });

    it('reverts a transaction merged with some other one, cancelling coin watches', () => {
      const theOtherTokenType = zswap.sampleTokenType();
      const theOtherTokenAmount = 10_000n;
      const dustAmount = dust(1);
      const initialCoinValues = [dust(3)];
      const wallets = prepareWallets({
        A: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: initialCoinValues },
        B: {
          keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 1)),
          coins: [{ tokenType: theOtherTokenType, value: theOtherTokenAmount }],
        },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);
      const proving = makeSimulatorProvingService();

      return Effect.gen(function* () {
        const result = yield* EitherOps.toEffect(
          transacting.initSwap(wallets.A, { [zswap.nativeToken()]: dustAmount }, [
            makeTransferOutput({
              recipient: wallets.A,
              coin: { tokenType: theOtherTokenType, value: theOtherTokenAmount },
            }),
          ]),
        );
        const proven: zswap.ProofErasedTransaction = yield* proving.prove(result.recipe);
        const balancedResult = yield* EitherOps.toEffect(transacting.balanceTransaction(wallets.B, proven, []));
        const balancedProven = yield* proving.prove(balancedResult.recipe);

        const afterRevertA: V1State = Either.getOrThrow(transacting.revert(result.newState, balancedProven));
        const afterRevertB: V1State = Either.getOrThrow(transacting.revert(balancedResult.newState, balancedProven));

        expect(afterRevertA.state.pendingOutputs.size).toEqual(0);
        expect(afterRevertB.state.pendingOutputs.size).toEqual(0);
      }).pipe(Effect.runPromise);
    });

    it('reverts a transaction, releasing booked coins from fallible offer', () => {
      const theOtherTokenType = zswap.sampleTokenType();
      const theOtherTokenAmount = 10_000n;
      const initialCoinValues = [dust(3), { tokenType: theOtherTokenType, value: theOtherTokenAmount }];
      const wallets = prepareWallets({
        A: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: initialCoinValues },
        B: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);
      const proving = makeSimulatorProvingService();

      return Effect.gen(function* () {
        const fallibleOffer = makeOutputOffer({
          coin: zswap.createCoinInfo(theOtherTokenType, theOtherTokenAmount),
          recipient: wallets.B,
          segment: 1,
        });
        const guaranteedOffer = makeOutputOffer({
          coin: dust(1),
          recipient: wallets.B,
          segment: 0,
        });
        const txToBalance = new zswap.UnprovenTransaction(guaranteedOffer, fallibleOffer).eraseProofs();

        const balanceResult = yield* EitherOps.toEffect(transacting.balanceTransaction(wallets.A, txToBalance, []));
        const balancedProven: zswap.ProofErasedTransaction = yield* proving.prove(balanceResult.recipe);

        const afterRevert: V1State = Either.getOrThrow(transacting.revert(balanceResult.newState, balancedProven));

        expect(
          Arr.sort(
            afterRevert.state.coins
              .values()
              .map((coin) => ({ type: coin.type, value: coin.value }))
              .toArray(),
            orderCoinByValue,
          ),
        ).toEqual([
          { type: theOtherTokenType, value: theOtherTokenAmount },
          { type: zswap.nativeToken(), value: dust(3) },
        ]);
        expect(afterRevert.state.pendingSpends.size).toEqual(0);
      }).pipe(Effect.runPromise);
    });

    it('reverts a transaction, cancelling coin watches from fallible offer', () => {
      const theOtherTokenType = zswap.sampleTokenType();
      const theOtherTokenAmount = 10_000n;
      const initialCoinValues = [dust(3), { tokenType: theOtherTokenType, value: theOtherTokenAmount }];
      const wallets = prepareWallets({
        A: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: initialCoinValues },
        B: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);
      const proving = makeSimulatorProvingService();

      return Effect.gen(function* () {
        const fallibleOffer = makeOutputOffer({
          coin: zswap.createCoinInfo(theOtherTokenType, theOtherTokenAmount),
          recipient: wallets.B,
          segment: 1,
        });
        const guaranteedOffer = makeOutputOffer({
          coin: dust(1),
          recipient: wallets.B,
          segment: 0,
        });
        const txToBalance = new zswap.UnprovenTransaction(guaranteedOffer, fallibleOffer).eraseProofs();

        const balanceResult = yield* EitherOps.toEffect(transacting.balanceTransaction(wallets.A, txToBalance, []));
        const balancedProven: zswap.ProofErasedTransaction = yield* proving.prove(balanceResult.recipe);

        const afterRevert: V1State = Either.getOrThrow(transacting.revert(balanceResult.newState, balancedProven));

        expect(afterRevert.state.pendingOutputs.size).toEqual(0);
      }).pipe(Effect.runPromise);
    });

    it('reverts a balancing recipe (e.g. due to user cancelling it), releasing booked coins from both fallible and guaranteed offer', () => {
      const theOtherTokenType = zswap.sampleTokenType();
      const theOtherTokenAmount = 10_000n;
      const initialCoinValues = [dust(3), { tokenType: theOtherTokenType, value: theOtherTokenAmount }];
      const wallets = prepareWallets({
        A: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: initialCoinValues },
        B: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);

      const fallibleOffer = makeOutputOffer({
        coin: zswap.createCoinInfo(theOtherTokenType, theOtherTokenAmount),
        recipient: wallets.B,
        segment: 1,
      });
      const guaranteedOffer = makeOutputOffer({
        coin: dust(1),
        recipient: wallets.B,
        segment: 0,
      });
      const txToBalance = new zswap.UnprovenTransaction(guaranteedOffer, fallibleOffer).eraseProofs();

      const balanceResult = Either.getOrThrow(transacting.balanceTransaction(wallets.A, txToBalance, []));

      const afterRevert: V1State = Either.getOrThrow(
        transacting.revertRecipe(balanceResult.newState, balanceResult.recipe),
      );

      expect(
        Arr.sort(
          afterRevert.state.coins
            .values()
            .map((coin) => ({ type: coin.type, value: coin.value }))
            .toArray(),
          orderCoinByValue,
        ),
      ).toEqual([
        { type: theOtherTokenType, value: theOtherTokenAmount },
        { type: zswap.nativeToken(), value: dust(3) },
      ]);
      expect(afterRevert.state.pendingSpends.size).toEqual(0);
    });

    it('reverts a balancing recipe (e.g. due to user cancelling it), cancelling coin watches from both fallible and guaranteed offer', () => {
      const theOtherTokenType = zswap.sampleTokenType();
      const theOtherTokenAmount = 10_000n;
      const initialCoinValues = [dust(3), { tokenType: theOtherTokenType, value: theOtherTokenAmount }];
      const wallets = prepareWallets({
        A: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: initialCoinValues },
        B: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);

      const fallibleOffer = makeOutputOffer({
        coin: zswap.createCoinInfo(theOtherTokenType, theOtherTokenAmount),
        recipient: wallets.B,
        segment: 1,
      });
      const guaranteedOffer = makeOutputOffer({
        coin: dust(1),
        recipient: wallets.B,
        segment: 0,
      });
      const txToBalance = new zswap.UnprovenTransaction(guaranteedOffer, fallibleOffer).eraseProofs();

      const balanceResult = Either.getOrThrow(transacting.balanceTransaction(wallets.A, txToBalance, []));

      const afterRevert: V1State = Either.getOrThrow(
        transacting.revertRecipe(balanceResult.newState, balanceResult.recipe),
      );

      expect(afterRevert.state.pendingOutputs.size).toEqual(0);
    });

    it('reverts a transfer recipe, releasing booked coins', () => {
      const wallets = prepareWallets({
        A: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: [dust(3)] },
        B: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);

      const result = Either.getOrThrow(
        transacting.makeTransfer(wallets.A, [makeTransferOutput({ recipient: wallets.B, coin: dust(2) })]),
      );
      const afterRevert: V1State = Either.getOrThrow(transacting.revertRecipe(result.newState, result.recipe));

      expect(
        afterRevert.state.coins
          .values()
          .map((coin) => ({ type: coin.type, value: coin.value }))
          .toArray(),
      ).toEqual([{ type: zswap.nativeToken(), value: dust(3) }]);
      expect(afterRevert.state.pendingSpends.size).toEqual(0);
    });

    it('reverts a transfer recipe, cancelling coin watches', () => {
      const wallets = prepareWallets({
        A: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: [dust(3)] },
        B: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);

      const result = Either.getOrThrow(
        transacting.makeTransfer(wallets.A, [makeTransferOutput({ recipient: wallets.B, coin: dust(2) })]),
      );
      const afterRevert: V1State = Either.getOrThrow(transacting.revertRecipe(result.newState, result.recipe));

      expect(afterRevert.state.pendingOutputs.size).toEqual(0);
    });

    it('does nothing reverting a "nothing to prove" recipe', () => {
      const wallets = prepareWallets({
        A: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: [dust(3)] },
        B: { keys: zswap.SecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);

      const result = Either.getOrThrow(
        transacting.makeTransfer(wallets.A, [makeTransferOutput({ recipient: wallets.B, coin: dust(2) })]),
      );

      const afterRevert: V1State = Either.getOrThrow(
        transacting.revertRecipe(result.newState, {
          type: NOTHING_TO_PROVE,
          transaction: pipe(
            makeOutputOffer({ recipient: wallets.A, coin: dust(1) }),
            (offer) => new zswap.UnprovenTransaction(offer),
            (tx) => tx.eraseProofs(),
          ),
        }),
      );

      expect(afterRevert).toBe(result.newState);
    });
  });
});
