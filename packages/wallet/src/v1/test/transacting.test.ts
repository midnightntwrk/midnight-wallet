import {
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
} from '@midnight-ntwrk/wallet-sdk-address-format';
import { chooseCoin } from '@midnight-ntwrk/wallet-sdk-capabilities';
import * as ledger from '@midnight-ntwrk/ledger-v6';
import { Array as Arr, Effect, Iterable, Order, pipe, Record } from 'effect';
import { describe, expect, it } from 'vitest';
import { ArrayOps, EitherOps } from '@midnight-ntwrk/wallet-sdk-utilities';
import { makeDefaultCoinsAndBalancesCapability } from '../CoinsAndBalances.js';
import { makeDefaultKeysCapability } from '../Keys.js';
import { makeSimulatorProvingService } from '../Proving.js';
import { BalanceTransactionToProve, NOTHING_TO_PROVE } from '../ProvingRecipe.js';
import { CoreWallet } from '../CoreWallet.js';
import {
  DefaultTransactingConfiguration,
  DefaultTransactingContext,
  makeSimulatorTransactingCapability,
  TokenTransfer,
} from '../Transacting.js';
import { getNonDustImbalance } from '../../test/testUtils.js';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { OtherWalletError } from '../WalletError.js';
import { Either } from 'effect';

const shieldedValue = (value: number): bigint => BigInt(value * 10 ** 6);

const shieldedTokenType = ledger.shieldedToken();
const rawShieldedTokenType = shieldedTokenType.raw;

const defaultConfig: DefaultTransactingConfiguration = {
  networkId: NetworkId.NetworkId.Undeployed,
};
const defaultContext: DefaultTransactingContext = {
  coinSelection: chooseCoin,
  coinsAndBalancesCapability: makeDefaultCoinsAndBalancesCapability(),
  keysCapability: makeDefaultKeysCapability(),
};

const coinsAndBalances = makeDefaultCoinsAndBalancesCapability();
const getAvailableCoins = (state: CoreWallet): readonly ledger.QualifiedShieldedCoinInfo[] => {
  return coinsAndBalances.getAvailableCoins(state).map((c) => c.coin);
};

type TestWallet = {
  readonly keys: ledger.ZswapSecretKeys;
  readonly wallet: CoreWallet;
};

type WalletEntry = {
  readonly keys: ledger.ZswapSecretKeys;
  readonly coins: ReadonlyArray<bigint | { tokenType: ledger.RawTokenType; value: bigint }>;
};
const prepareWallets = <Names extends string>(desired: Record<Names, WalletEntry>): Record<Names, TestWallet> => {
  const offer = pipe(
    Record.values(desired),
    Arr.flatMap((aWalletEntry: WalletEntry) =>
      Arr.map(aWalletEntry.coins, (coin) => ({ keys: aWalletEntry.keys, coin })),
    ),
    Arr.map(({ keys, coin }) =>
      makeOutputOffer({
        recipient: keys,
        coin: typeof coin === 'bigint' ? coin : ledger.createShieldedCoinInfo(coin.tokenType, coin.value),
      }),
    ),
    ArrayOps.assertNonEmpty,
    ArrayOps.fold((offerA: ledger.ZswapOffer<ledger.PreProof>, offerB: ledger.ZswapOffer<ledger.PreProof>) =>
      offerA.merge(offerB),
    ),
  );

  return pipe(
    desired,
    Record.map((entry) => ({
      keys: entry.keys,
      wallet: CoreWallet.apply(CoreWallet.initEmpty(entry.keys, NetworkId.NetworkId.Undeployed), entry.keys, offer),
    })),
  );
};

const orderCoinByValue = Order.mapInput(Order.bigint, (coin: { value: bigint }) => coin.value);

const makeOutputOffer = (args: {
  recipient: ledger.ZswapSecretKeys | TestWallet;
  coin: ledger.ShieldedCoinInfo | bigint;
  segment?: 0 | 1;
}): ledger.ZswapOffer<ledger.PreProof> => {
  const keys: ledger.ZswapSecretKeys =
    args.recipient instanceof ledger.ZswapSecretKeys ? args.recipient : args.recipient.keys;
  const coinToUse =
    typeof args.coin === 'bigint' ? ledger.createShieldedCoinInfo(rawShieldedTokenType, args.coin) : args.coin;
  const output = ledger.ZswapOutput.new(coinToUse, args.segment ?? 0, keys.coinPublicKey, keys.encryptionPublicKey);
  return ledger.ZswapOffer.fromOutput(output, coinToUse.type, coinToUse.value);
};

const encodeAddress = (keys: ledger.ZswapSecretKeys): string => {
  return ShieldedAddress.codec
    .encode(
      NetworkId.NetworkId.Undeployed,
      new ShieldedAddress(
        ShieldedCoinPublicKey.fromHexString(keys.coinPublicKey),
        ShieldedEncryptionPublicKey.fromHexString(keys.encryptionPublicKey),
      ),
    )
    .asString();
};

const makeTransferOutput = (args: {
  recipient: ledger.ZswapSecretKeys | TestWallet;
  coin: bigint | { tokenType: ledger.RawTokenType; value: bigint };
}): TokenTransfer => {
  const typeAndValue = typeof args.coin == 'bigint' ? { tokenType: rawShieldedTokenType, value: args.coin } : args.coin;
  const keys = args.recipient instanceof ledger.ZswapSecretKeys ? args.recipient : args.recipient.keys;
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
        A: {
          keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0)),
          coins: [shieldedValue(1), shieldedValue(2), shieldedValue(3)],
        },
        B: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);
      const proving = makeSimulatorProvingService();
      const transactionValue = shieldedValue(4);
      const tx = pipe(transactionValue, (value) => {
        const offer = makeOutputOffer({ recipient: wallets.B, coin: value });
        return ledger.Transaction.fromParts(NetworkId.NetworkId.Undeployed, offer).eraseProofs();
      });

      return Effect.gen(function* () {
        const result = EitherOps.getOrThrowLeft(transacting.balanceTransaction(wallets.A.keys, wallets.A.wallet, tx));
        const recipe = result.recipe as BalanceTransactionToProve<ledger.ProofErasedTransaction>;
        const proven = yield* proving.prove(recipe);

        expect(recipe.transactionToProve.guaranteedOffer?.deltas.get(rawShieldedTokenType)).toEqual(transactionValue);
        expect(proven.guaranteedOffer?.deltas.get(rawShieldedTokenType)).toBeUndefined();
      }).pipe(Effect.runPromise);
    });

    it('balances a transaction with a fallible offer', () => {
      const wallets = prepareWallets({
        A: {
          keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0)),
          coins: [shieldedValue(1), shieldedValue(2), shieldedValue(3)],
        },
        B: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);
      const proving = makeSimulatorProvingService();
      const transactionValueFallible = shieldedValue(2);
      const transactionValueGuaranteed = shieldedValue(2);
      const guaranteedOffer = makeOutputOffer({ recipient: wallets.B, coin: transactionValueGuaranteed });
      const fallibleOffer = makeOutputOffer({ recipient: wallets.B, coin: transactionValueFallible, segment: 1 });
      const tx = ledger.Transaction.fromParts(
        NetworkId.NetworkId.Undeployed,
        guaranteedOffer,
        fallibleOffer,
      ).eraseProofs();

      return Effect.gen(function* () {
        const result = EitherOps.getOrThrowLeft(transacting.balanceTransaction(wallets.A.keys, wallets.A.wallet, tx));
        const recipe = result.recipe as BalanceTransactionToProve<ledger.ProofErasedTransaction>;
        const proven = yield* proving.prove(recipe);
        expect(
          recipe.transactionToProve.fallibleOffer
            ?.entries()
            .map(([_, delta]) => delta.deltas.get(rawShieldedTokenType) ?? 0n)
            .reduce((acc, curr) => acc + curr, 0n),
        ).toEqual(transactionValueFallible);

        expect(recipe.transactionToProve.guaranteedOffer?.deltas.get(rawShieldedTokenType)).toBeGreaterThanOrEqual(
          transactionValueGuaranteed,
        );
        expect(proven.guaranteedOffer?.deltas.get(rawShieldedTokenType)).toBeUndefined();
      }).pipe(Effect.runPromise);
    });

    it('books coins used in balancing', () => {
      const wallets = prepareWallets({
        A: {
          keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0)),
          coins: [shieldedValue(1), shieldedValue(2), shieldedValue(3)],
        },
        B: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);
      const transactionValueFallible = shieldedValue(2);
      const transactionValueGuaranteed = shieldedValue(2);
      const guaranteedOffer = makeOutputOffer({ recipient: wallets.B, coin: transactionValueGuaranteed });
      const fallibleOffer = makeOutputOffer({ recipient: wallets.B, coin: transactionValueFallible, segment: 1 });
      const tx = ledger.Transaction.fromParts(
        NetworkId.NetworkId.Undeployed,
        guaranteedOffer,
        fallibleOffer,
      ).eraseProofs();

      const result = EitherOps.getOrThrowLeft(transacting.balanceTransaction(wallets.A.keys, wallets.A.wallet, tx));

      expect(getAvailableCoins(result.newState).length).toBe(0);
      expect(
        Arr.sort(
          result.newState.state.pendingSpends.values().map(([coin]) => coin),
          orderCoinByValue,
        ),
      ).toEqual(Arr.sort(wallets.A.wallet.state.coins, orderCoinByValue));
    });

    it('watches for change coins from balancing', () => {
      const wallets = prepareWallets({
        A: {
          keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0)),
          coins: [shieldedValue(1), shieldedValue(2), shieldedValue(3)],
        },
        B: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);
      const transactionValueFallible = shieldedValue(2);
      const transactionValueGuaranteed = shieldedValue(2);
      const guaranteedOffer = makeOutputOffer({ recipient: wallets.B, coin: transactionValueGuaranteed });
      const fallibleOffer = makeOutputOffer({ recipient: wallets.B, coin: transactionValueFallible, segment: 1 });
      const tx = ledger.Transaction.fromParts(
        NetworkId.NetworkId.Undeployed,
        guaranteedOffer,
        fallibleOffer,
      ).eraseProofs();

      const result = EitherOps.getOrThrowLeft(transacting.balanceTransaction(wallets.A.keys, wallets.A.wallet, tx));

      const pendingOutputs = Array.from(result.newState.state.pendingOutputs.values());
      expect(pendingOutputs.length).toEqual(2);
      pendingOutputs.forEach(([output]) => {
        // Knowing that default coin selection is "smaller-first", and that fallible sections needs to be balanced first to properly pay fees in the guaranteed one,
        // It leaves fallible of value 2 to be balanced with coins of value 1 and 2
        // and guaranteed of value 2 to be balanced with coin of value 3
        expect(output.value).toBeLessThanOrEqual(shieldedValue(1));
      });
    });

    it('raises an error if there are not enough tokens for balancing', () => {
      const wallets = prepareWallets({
        A: {
          keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0)),
          coins: [shieldedValue(1), shieldedValue(1), shieldedValue(1)],
        },
        B: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);
      const transactionValueFallible = shieldedValue(3);
      const changeCoin = ledger.createShieldedCoinInfo(rawShieldedTokenType, shieldedValue(3));
      const guaranteedOffer = makeOutputOffer({ recipient: wallets.A, coin: changeCoin });
      const fallibleOffer = makeOutputOffer({ recipient: wallets.B, coin: transactionValueFallible, segment: 1 });
      const tx = ledger.Transaction.fromParts(
        NetworkId.NetworkId.Undeployed,
        guaranteedOffer,
        fallibleOffer,
      ).eraseProofs();

      const result = transacting.balanceTransaction(wallets.A.keys, wallets.A.wallet, tx);

      expect(() => EitherOps.getOrThrowLeft(result)).toThrow();
    });

    it('does not try to spend booked coins for balancing', () => {
      const wallets = prepareWallets({
        A: {
          keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0)),
          coins: [shieldedValue(1), shieldedValue(2), shieldedValue(3)],
        },
        B: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);
      const transactionValueFallible = shieldedValue(2);
      const transactionValueGuaranteed = shieldedValue(2);
      const guaranteedOffer = makeOutputOffer({ recipient: wallets.B, coin: transactionValueGuaranteed });
      const fallibleOffer = makeOutputOffer({ recipient: wallets.B, coin: transactionValueFallible, segment: 1 });
      const tx = ledger.Transaction.fromParts(
        NetworkId.NetworkId.Undeployed,
        guaranteedOffer,
        fallibleOffer,
      ).eraseProofs();

      const result = EitherOps.getOrThrowLeft(transacting.balanceTransaction(wallets.A.keys, wallets.A.wallet, tx));
      const anotherTx = pipe(makeOutputOffer({ recipient: wallets.B, coin: shieldedValue(1) }), (offer) =>
        ledger.Transaction.fromParts(NetworkId.NetworkId.Undeployed, offer).eraseProofs(),
      );

      const secondResult = transacting.balanceTransaction(wallets.A.keys, result.newState, anotherTx);

      expect(() => EitherOps.getOrThrowLeft(secondResult)).toThrow();
    });
  });

  describe('when transferring', () => {
    it('prepares a transfer', () => {
      const wallets = prepareWallets({
        A: {
          keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0)),
          coins: [shieldedValue(1), shieldedValue(2), shieldedValue(3)],
        },
        B: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);
      const proving = makeSimulatorProvingService();

      return Effect.gen(function* () {
        const result = yield* EitherOps.toEffect(
          transacting.makeTransfer(wallets.A.keys, wallets.A.wallet, [
            makeTransferOutput({ recipient: wallets.B, coin: shieldedValue(2) }),
          ]),
        );
        const proven = yield* proving.prove(result.recipe);

        expect(proven.guaranteedOffer?.deltas.get(rawShieldedTokenType)).toBeUndefined();
      }).pipe(Effect.runPromise);
    });

    it('books coins used in transfer', () => {
      const initialCoinValues = [shieldedValue(1), shieldedValue(2), shieldedValue(3)];
      const transferValue = shieldedValue(2);
      const wallets = prepareWallets({
        A: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: initialCoinValues },
        B: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);

      return Effect.gen(function* () {
        const result = yield* EitherOps.toEffect(
          transacting.makeTransfer(wallets.A.keys, wallets.A.wallet, [
            makeTransferOutput({ recipient: wallets.B, coin: transferValue }),
          ]),
        );

        const bookedCoinValues = result.newState.state.pendingSpends
          .values()
          .map(([c]) => c.value)
          .toArray();
        const availableCoinValues = getAvailableCoins(result.newState).map((c) => c.value);
        const sumValues = ArrayOps.sumBigInt([...bookedCoinValues, ...availableCoinValues]);
        const bookedCoinsSum = ArrayOps.sumBigInt(bookedCoinValues);

        expect(sumValues).toEqual(ArrayOps.sumBigInt(initialCoinValues));
        expect(Arr.sort([...bookedCoinValues, ...availableCoinValues], Order.bigint)).toEqual(initialCoinValues);
        expect(bookedCoinsSum).toBeGreaterThanOrEqual(transferValue);
      }).pipe(Effect.runPromise);
    });

    it('watches for change coins from a transfer', () => {
      const initialCoinValues = [shieldedValue(1), shieldedValue(2), shieldedValue(3)];
      const transferValue = shieldedValue(2);
      const wallets = prepareWallets({
        A: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: initialCoinValues },
        B: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);

      const result = EitherOps.getOrThrowLeft(
        transacting.makeTransfer(wallets.A.keys, wallets.A.wallet, [
          makeTransferOutput({ recipient: wallets.B, coin: transferValue }),
        ]),
      );

      const availableCoinValues = getAvailableCoins(result.newState).map((c) => c.value);
      const pendingCoinValues = result.newState.state.pendingOutputs
        .values()
        .map(([c]) => c.value)
        .toArray();
      const sumValues: bigint = pipe([pendingCoinValues, availableCoinValues], Arr.flatten, ArrayOps.sumBigInt);

      //Final total balance needs to be within range of 1 dust from original one with subtracted transfer value
      expect(sumValues).toBeGreaterThanOrEqual(
        ArrayOps.sumBigInt(initialCoinValues) - transferValue - shieldedValue(1),
      );
      expect(sumValues).toEqual(ArrayOps.sumBigInt(initialCoinValues) - transferValue);
      pendingCoinValues.forEach((value) => {
        expect(value).toEqual(shieldedValue(1)); //knowing coin selection, we do not expect bigger pending coin
      });
    });

    it('raises an error if there are not enough tokens for transfer', () => {
      const initialCoinValues = [shieldedValue(1), shieldedValue(2), shieldedValue(3)];
      const transferValue = shieldedValue(6);
      const wallets = prepareWallets({
        A: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: initialCoinValues },
        B: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);

      const result = transacting.makeTransfer(wallets.A.keys, wallets.A.wallet, [
        makeTransferOutput({ recipient: wallets.B, coin: transferValue }),
      ]);

      expect(() => EitherOps.getOrThrowLeft(result)).toThrow();
    });

    it('raises an error with correct message when transfer has zero amount', () => {
      const wallets = prepareWallets({
        A: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: [shieldedValue(1)] },
        B: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);

      const result = transacting.makeTransfer(wallets.A.keys, wallets.A.wallet, [
        makeTransferOutput({ recipient: wallets.B, coin: 0n }),
      ]);

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(OtherWalletError);
        expect(result.left.message).toBe('The amount needs to be positive');
      }
    });

    it('raises an error with correct message when transfer has no positive amounts', () => {
      const wallets = prepareWallets({
        A: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: [shieldedValue(1)] },
        B: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);

      const result = transacting.makeTransfer(wallets.A.keys, wallets.A.wallet, [
        makeTransferOutput({ recipient: wallets.B, coin: 0n }),
        makeTransferOutput({ recipient: wallets.B, coin: 0n }),
      ]);

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(OtherWalletError);
        expect(result.left.message).toBe('The amount needs to be positive');
      }
    });

    it('does not try to spend booked coins for a transfer', () => {
      const initialCoinValues = [shieldedValue(1), shieldedValue(2), shieldedValue(3)];
      const transferValue = shieldedValue(5);
      const wallets = prepareWallets({
        A: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: initialCoinValues },
        B: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);
      const result = EitherOps.getOrThrowLeft(
        transacting.makeTransfer(wallets.A.keys, wallets.A.wallet, [
          makeTransferOutput({ recipient: wallets.B, coin: transferValue }),
        ]),
      );
      const secondResult = transacting.makeTransfer(wallets.A.keys, result.newState, [
        makeTransferOutput({ recipient: wallets.B, coin: shieldedValue(1) }),
      ]);

      expect(() => EitherOps.getOrThrowLeft(secondResult)).toThrow();
    });
  });

  describe('when handling swaps', () => {
    it('inits a swap with dust input and non-dust output', () => {
      const theOtherTokenType = ledger.sampleRawTokenType();
      const theOtherTokenAmount = 10_000n;
      const initialCoinValues = [shieldedValue(1), shieldedValue(2), shieldedValue(3)];
      const wallets = prepareWallets({
        A: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: initialCoinValues },
        B: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);
      const proving = makeSimulatorProvingService();

      return Effect.gen(function* () {
        const result = yield* EitherOps.toEffect(
          transacting.initSwap(wallets.A.keys, wallets.A.wallet, { [rawShieldedTokenType]: shieldedValue(1) }, [
            makeTransferOutput({
              recipient: wallets.A,
              coin: { tokenType: theOtherTokenType, value: theOtherTokenAmount },
            }),
          ]),
        );
        const proven: ledger.ProofErasedTransaction = yield* proving.prove(result.recipe);
        const imbalances = proven.imbalances(0);
        expect(new Set(imbalances.keys().filter((key) => key.tag === 'shielded'))).toEqual(
          new Set([shieldedTokenType, { tag: 'shielded', raw: theOtherTokenType }]),
        );
        expect(getNonDustImbalance(imbalances, rawShieldedTokenType)).not.toBeUndefined();
        expect(getNonDustImbalance(imbalances, rawShieldedTokenType)).toBe(shieldedValue(1));
        expect(getNonDustImbalance(imbalances, theOtherTokenType)).toEqual(-1n * theOtherTokenAmount);
      }).pipe(Effect.runPromise);
    });

    it('inits a swap with non-dust input and dust output', () => {
      const theOtherTokenType = ledger.sampleRawTokenType();
      const theOtherTokenAmount = 10_000n;
      const initialCoinValues = [
        shieldedValue(1),
        shieldedValue(2),
        shieldedValue(3),
        { tokenType: theOtherTokenType, value: theOtherTokenAmount },
      ];
      const wallets = prepareWallets({
        A: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: initialCoinValues },
        B: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);
      const proving = makeSimulatorProvingService();

      return Effect.gen(function* () {
        const result = yield* EitherOps.toEffect(
          transacting.initSwap(wallets.A.keys, wallets.A.wallet, { [theOtherTokenType]: theOtherTokenAmount }, [
            makeTransferOutput({
              recipient: wallets.A,
              coin: shieldedValue(1),
            }),
          ]),
        );
        const proven: ledger.ProofErasedTransaction = yield* proving.prove(result.recipe);
        const imbalances = proven.imbalances(0);
        expect(new Set(imbalances.keys())).toEqual(
          new Set([shieldedTokenType, { tag: 'shielded', raw: theOtherTokenType }]),
        );
        expect(getNonDustImbalance(imbalances, rawShieldedTokenType)).toBeLessThan(0n);
        expect(getNonDustImbalance(imbalances, rawShieldedTokenType)).toEqual(-1n * shieldedValue(1));
        expect(getNonDustImbalance(imbalances, theOtherTokenType)).toEqual(theOtherTokenAmount);
      }).pipe(Effect.runPromise);
    });

    it('inits a swap with non-dust input and non-dust output', () => {
      const theOtherTokenType1 = ledger.sampleRawTokenType();
      const theOtherTokenAmount1 = 10_000n;
      const theOtherTokenType2 = ledger.sampleRawTokenType();
      const theOtherTokenAmount2 = 10_000n;
      const initialCoinValues = [
        shieldedValue(1),
        shieldedValue(2),
        shieldedValue(3),
        { tokenType: theOtherTokenType1, value: theOtherTokenAmount1 },
      ];
      const wallets = prepareWallets({
        A: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: initialCoinValues },
        B: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);
      const proving = makeSimulatorProvingService();

      return Effect.gen(function* () {
        const result = yield* EitherOps.toEffect(
          transacting.initSwap(wallets.A.keys, wallets.A.wallet, { [theOtherTokenType1]: theOtherTokenAmount1 }, [
            makeTransferOutput({
              recipient: wallets.A,
              coin: { tokenType: theOtherTokenType2, value: theOtherTokenAmount2 },
            }),
          ]),
        );
        const proven: ledger.ProofErasedTransaction = yield* proving.prove(result.recipe);
        const imbalances = proven.imbalances(0);

        expect(new Set(imbalances.keys())).toEqual(
          new Set([
            { tag: 'shielded', raw: theOtherTokenType1 },
            { tag: 'shielded', raw: theOtherTokenType2 },
          ]),
        );

        expect(getNonDustImbalance(imbalances, theOtherTokenType1)).toEqual(theOtherTokenAmount1);
        expect(getNonDustImbalance(imbalances, theOtherTokenType2)).toEqual(-1n * theOtherTokenAmount2);
      }).pipe(Effect.runPromise);
    });

    it('balances a swap', () => {
      const theOtherTokenType = ledger.sampleRawTokenType();
      const theOtherTokenAmount = 10_000n;
      const dustAmount = shieldedValue(1);
      const wallets = prepareWallets({
        A: {
          keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0)),
          coins: [shieldedValue(1), shieldedValue(2), shieldedValue(3)],
        },
        B: {
          keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 1)),
          coins: [shieldedValue(1), { tokenType: theOtherTokenType, value: theOtherTokenAmount }],
        },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);
      const proving = makeSimulatorProvingService();

      return Effect.gen(function* () {
        const result = yield* EitherOps.toEffect(
          transacting.initSwap(wallets.A.keys, wallets.A.wallet, { [rawShieldedTokenType]: dustAmount }, [
            makeTransferOutput({
              recipient: wallets.A,
              coin: { tokenType: theOtherTokenType, value: theOtherTokenAmount },
            }),
          ]),
        );
        const proven: ledger.ProofErasedTransaction = yield* proving.prove(result.recipe);
        const balancedResult = yield* EitherOps.toEffect(
          transacting.balanceTransaction(wallets.B.keys, wallets.B.wallet, proven),
        );
        const balancedProven = yield* proving.prove(balancedResult.recipe);

        const imbalances = balancedProven.imbalances(0);

        expect(new Set(imbalances.keys()).size).toBe(0);
        expect(getNonDustImbalance(imbalances, rawShieldedTokenType)).toBe(0n);
      }).pipe(Effect.runPromise);
    });

    it('books coins spent in a swap', () => {
      const theOtherTokenType = ledger.sampleRawTokenType();
      const theOtherTokenAmount = 10_000n;
      const initialCoinValues = [shieldedValue(1), shieldedValue(2), shieldedValue(3)];
      const wallets = prepareWallets({
        A: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: initialCoinValues },
        B: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);

      const result = EitherOps.getOrThrowLeft(
        transacting.initSwap(wallets.A.keys, wallets.A.wallet, { [rawShieldedTokenType]: shieldedValue(1) }, [
          makeTransferOutput({
            recipient: wallets.A,
            coin: { tokenType: theOtherTokenType, value: theOtherTokenAmount },
          }),
        ]),
      );
      const bookedCoins = pipe(
        result.newState.state.pendingOutputs.values(),
        Iterable.map(([coin]) => ({ type: coin.type, value: coin.value })),
        Arr.sort(orderCoinByValue),
      );

      expect(bookedCoins).toEqual([{ type: theOtherTokenType, value: theOtherTokenAmount }]);
    });

    it('watches for coins expected to be received from a swap', () => {
      const theOtherTokenType = ledger.sampleRawTokenType();
      const theOtherTokenAmount = 10_000n;
      const dustAmount = shieldedValue(1);
      const initialCoinValues = [shieldedValue(1), shieldedValue(2), shieldedValue(3)];
      const wallets = prepareWallets({
        A: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: initialCoinValues },
        B: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);

      const result = EitherOps.getOrThrowLeft(
        transacting.initSwap(wallets.A.keys, wallets.A.wallet, { [rawShieldedTokenType]: dustAmount }, [
          makeTransferOutput({
            recipient: wallets.A,
            coin: { tokenType: theOtherTokenType, value: theOtherTokenAmount },
          }),
        ]),
      );
      const expectedCoins = pipe(
        result.newState.state.pendingOutputs.values(),
        Record.fromIterableWith(([coin]) => [coin.type, coin.value]),
      );

      expect(new Set(Record.keys(expectedCoins))).toEqual(new Set([theOtherTokenType]));
      expect(expectedCoins[theOtherTokenType]).toEqual(theOtherTokenAmount);
    });

    it('raises an error if there are not enough tokens for swap', () => {
      const theOtherTokenType = ledger.sampleRawTokenType();
      const theOtherTokenAmount = 10_000n;
      const dustAmount = shieldedValue(1);
      const initialCoinValues = [shieldedValue(1), shieldedValue(2), shieldedValue(3)];
      const wallets = prepareWallets({
        A: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: initialCoinValues },
        B: {
          keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 1)),
          coins: [{ tokenType: theOtherTokenType, value: theOtherTokenAmount }],
        },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);

      const resultA = transacting.initSwap(
        wallets.A.keys,
        wallets.A.wallet,
        { [theOtherTokenType]: theOtherTokenAmount },
        [makeTransferOutput({ recipient: wallets.A, coin: dustAmount })],
      );

      const resultB = transacting.initSwap(wallets.B.keys, wallets.B.wallet, { [rawShieldedTokenType]: dustAmount }, [
        makeTransferOutput({
          recipient: wallets.B,
          coin: { tokenType: theOtherTokenType, value: theOtherTokenAmount },
        }),
      ]);

      expect(() => EitherOps.getOrThrowLeft(resultA)).toThrow();
      expect(() => EitherOps.getOrThrowLeft(resultB)).toThrow();
    });

    it('raises an error with correct message when swap has non-positive outputs', () => {
      const wallets = prepareWallets({
        A: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: [shieldedValue(1)] },
        B: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);

      const result = transacting.initSwap(wallets.A.keys, wallets.A.wallet, {}, [
        makeTransferOutput({ recipient: wallets.B, coin: 0n }),
      ]);

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(OtherWalletError);
        expect(result.left.message).toBe('The amount needs to be positive');
      }
    });

    it('raises an error with correct message when swap has non-positive inputs', () => {
      const wallets = prepareWallets({
        A: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: [shieldedValue(1)] },
        B: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);

      const result = transacting.initSwap(wallets.A.keys, wallets.A.wallet, { [rawShieldedTokenType]: 0n }, [
        makeTransferOutput({ recipient: wallets.B, coin: shieldedValue(1) }),
      ]);

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left).toBeInstanceOf(OtherWalletError);
        expect(result.left.message).toBe('The input amounts need to be positive');
      }
    });

    it('does not try to use booked coins for a swap', () => {
      const theOtherTokenType = ledger.sampleRawTokenType();
      const theOtherTokenAmount = 10_000n;
      const dustAmount = shieldedValue(1);
      const initialCoinValues = [shieldedValue(3)];
      const wallets = prepareWallets({
        A: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: initialCoinValues },
        B: {
          keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 1)),
          coins: [],
        },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);

      const firstResult = EitherOps.getOrThrowLeft(
        transacting.makeTransfer(wallets.A.keys, wallets.A.wallet, [
          makeTransferOutput({ recipient: wallets.B, coin: dustAmount }),
        ]),
      );
      const secondResult = transacting.initSwap(
        wallets.A.keys,
        firstResult.newState,
        { [rawShieldedTokenType]: dustAmount },
        [
          makeTransferOutput({
            recipient: wallets.A,
            coin: { tokenType: theOtherTokenType, value: theOtherTokenAmount },
          }),
        ],
      );

      expect(() => EitherOps.getOrThrowLeft(secondResult)).toThrow();
    });
  });

  /**
   *
   * .applyFailed is missing from ZswapLocalState [https://shielded.atlassian.net/browse/PM-19678]
   */
  describe.skip('when reverting and cancelling transactions', () => {
    it('reverts a transaction (e.g. due to a submission failure), releasing booked coins', () => {
      const wallets = prepareWallets({
        A: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: [shieldedValue(3)] },
        B: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);
      const proving = makeSimulatorProvingService();

      return Effect.gen(function* () {
        const result = yield* EitherOps.toEffect(
          transacting.makeTransfer(wallets.A.keys, wallets.A.wallet, [
            makeTransferOutput({ recipient: wallets.B, coin: shieldedValue(2) }),
          ]),
        );
        const proven = yield* proving.prove(result.recipe);
        const afterRevert: CoreWallet = EitherOps.getOrThrowLeft(transacting.revert(result.newState, proven));

        expect(getAvailableCoins(afterRevert).map((coin) => ({ type: coin.type, value: coin.value }))).toEqual([
          { type: rawShieldedTokenType, value: shieldedValue(3) },
        ]);
        expect(afterRevert.state.pendingSpends.size).toEqual(0);
      }).pipe(Effect.runPromise);
    });

    it('reverts a transaction (e.g. due to a submission failure), cancelling coin watches', () => {
      const wallets = prepareWallets({
        A: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: [shieldedValue(3)] },
        B: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);
      const proving = makeSimulatorProvingService();

      return Effect.gen(function* () {
        const result = yield* EitherOps.toEffect(
          transacting.makeTransfer(wallets.A.keys, wallets.A.wallet, [
            makeTransferOutput({ recipient: wallets.B, coin: shieldedValue(2) }),
          ]),
        );
        const proven = yield* proving.prove(result.recipe);
        const afterRevert: CoreWallet = EitherOps.getOrThrowLeft(transacting.revert(result.newState, proven));

        expect(afterRevert.state.pendingOutputs.size).toEqual(0);
      }).pipe(Effect.runPromise);
    });

    it('reverts a transaction merged with some other one, releasing booked coins', () => {
      const theOtherTokenType = ledger.sampleRawTokenType();
      const theOtherTokenAmount = 10_000n;
      const dustAmount = shieldedValue(1);
      const initialCoinValues = [shieldedValue(3)];
      const wallets = prepareWallets({
        A: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: initialCoinValues },
        B: {
          keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 1)),
          coins: [{ tokenType: theOtherTokenType, value: theOtherTokenAmount }],
        },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);
      const proving = makeSimulatorProvingService();

      return Effect.gen(function* () {
        const result = yield* EitherOps.toEffect(
          transacting.initSwap(wallets.A.keys, wallets.A.wallet, { [rawShieldedTokenType]: dustAmount }, [
            makeTransferOutput({
              recipient: wallets.A,
              coin: { tokenType: theOtherTokenType, value: theOtherTokenAmount },
            }),
          ]),
        );
        const proven: ledger.ProofErasedTransaction = yield* proving.prove(result.recipe);
        const balancedResult = yield* EitherOps.toEffect(
          transacting.balanceTransaction(wallets.B.keys, wallets.B.wallet, proven),
        );
        const balancedProven = yield* proving.prove(balancedResult.recipe);

        const afterRevertA: CoreWallet = EitherOps.getOrThrowLeft(transacting.revert(result.newState, balancedProven));
        const afterRevertB: CoreWallet = EitherOps.getOrThrowLeft(
          transacting.revert(balancedResult.newState, balancedProven),
        );

        expect(afterRevertA.state.pendingSpends.size).toEqual(0);
        expect(afterRevertB.state.pendingSpends.size).toEqual(0);
      }).pipe(Effect.runPromise);
    });

    it('reverts a transaction merged with some other one, cancelling coin watches', () => {
      const theOtherTokenType = ledger.sampleRawTokenType();
      const theOtherTokenAmount = 10_000n;
      const dustAmount = shieldedValue(1);
      const initialCoinValues = [shieldedValue(3)];
      const wallets = prepareWallets({
        A: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: initialCoinValues },
        B: {
          keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 1)),
          coins: [{ tokenType: theOtherTokenType, value: theOtherTokenAmount }],
        },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);
      const proving = makeSimulatorProvingService();

      return Effect.gen(function* () {
        const result = yield* EitherOps.toEffect(
          transacting.initSwap(wallets.A.keys, wallets.A.wallet, { [rawShieldedTokenType]: dustAmount }, [
            makeTransferOutput({
              recipient: wallets.A,
              coin: { tokenType: theOtherTokenType, value: theOtherTokenAmount },
            }),
          ]),
        );
        const proven: ledger.ProofErasedTransaction = yield* proving.prove(result.recipe);
        const balancedResult = yield* EitherOps.toEffect(
          transacting.balanceTransaction(wallets.B.keys, wallets.B.wallet, proven),
        );
        const balancedProven = yield* proving.prove(balancedResult.recipe);

        const afterRevertA: CoreWallet = EitherOps.getOrThrowLeft(transacting.revert(result.newState, balancedProven));
        const afterRevertB: CoreWallet = EitherOps.getOrThrowLeft(
          transacting.revert(balancedResult.newState, balancedProven),
        );

        expect(afterRevertA.state.pendingOutputs.size).toEqual(0);
        expect(afterRevertB.state.pendingOutputs.size).toEqual(0);
      }).pipe(Effect.runPromise);
    });

    it('reverts a transaction, releasing booked coins from fallible offer', () => {
      const theOtherTokenType = ledger.sampleRawTokenType();
      const theOtherTokenAmount = 10_000n;
      const initialCoinValues = [shieldedValue(3), { tokenType: theOtherTokenType, value: theOtherTokenAmount }];
      const wallets = prepareWallets({
        A: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: initialCoinValues },
        B: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);
      const proving = makeSimulatorProvingService();

      return Effect.gen(function* () {
        const fallibleOffer = makeOutputOffer({
          coin: ledger.createShieldedCoinInfo(theOtherTokenType, theOtherTokenAmount),
          recipient: wallets.B,
          segment: 1,
        });
        const guaranteedOffer = makeOutputOffer({
          coin: shieldedValue(1),
          recipient: wallets.B,
          segment: 0,
        });
        const txToBalance = ledger.Transaction.fromParts(
          NetworkId.NetworkId.Undeployed,
          guaranteedOffer,
          fallibleOffer,
        ).eraseProofs();

        const balanceResult = yield* EitherOps.toEffect(
          transacting.balanceTransaction(wallets.A.keys, wallets.A.wallet, txToBalance),
        );
        const balancedProven: ledger.ProofErasedTransaction = yield* proving.prove(balanceResult.recipe);

        const afterRevert: CoreWallet = EitherOps.getOrThrowLeft(
          transacting.revert(balanceResult.newState, balancedProven),
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
          { type: rawShieldedTokenType, value: shieldedValue(3) },
        ]);
        expect(afterRevert.state.pendingSpends.size).toEqual(0);
      }).pipe(Effect.runPromise);
    });

    it('reverts a transaction, cancelling coin watches from fallible offer', () => {
      const theOtherTokenType = ledger.sampleRawTokenType();
      const theOtherTokenAmount = 10_000n;
      const initialCoinValues = [shieldedValue(3), { tokenType: theOtherTokenType, value: theOtherTokenAmount }];
      const wallets = prepareWallets({
        A: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: initialCoinValues },
        B: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);
      const proving = makeSimulatorProvingService();

      return Effect.gen(function* () {
        const fallibleOffer = makeOutputOffer({
          coin: ledger.createShieldedCoinInfo(theOtherTokenType, theOtherTokenAmount),
          recipient: wallets.B,
          segment: 1,
        });
        const guaranteedOffer = makeOutputOffer({
          coin: shieldedValue(1),
          recipient: wallets.B,
          segment: 0,
        });
        const txToBalance = ledger.Transaction.fromParts(
          NetworkId.NetworkId.Undeployed,
          guaranteedOffer,
          fallibleOffer,
        ).eraseProofs();

        const balanceResult = yield* EitherOps.toEffect(
          transacting.balanceTransaction(wallets.A.keys, wallets.A.wallet, txToBalance),
        );
        const balancedProven: ledger.ProofErasedTransaction = yield* proving.prove(balanceResult.recipe);

        const afterRevert: CoreWallet = EitherOps.getOrThrowLeft(
          transacting.revert(balanceResult.newState, balancedProven),
        );

        expect(afterRevert.state.pendingOutputs.size).toEqual(0);
      }).pipe(Effect.runPromise);
    });

    it('reverts a balancing recipe (e.g. due to user cancelling it), releasing booked coins from both fallible and guaranteed offer', () => {
      const theOtherTokenType = ledger.sampleRawTokenType();
      const theOtherTokenAmount = 10_000n;
      const initialCoinValues = [shieldedValue(3), { tokenType: theOtherTokenType, value: theOtherTokenAmount }];
      const wallets = prepareWallets({
        A: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: initialCoinValues },
        B: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);

      const fallibleOffer = makeOutputOffer({
        coin: ledger.createShieldedCoinInfo(theOtherTokenType, theOtherTokenAmount),
        recipient: wallets.B,
        segment: 1,
      });
      const guaranteedOffer = makeOutputOffer({
        coin: shieldedValue(1),
        recipient: wallets.B,
        segment: 0,
      });
      const txToBalance = ledger.Transaction.fromParts(
        NetworkId.NetworkId.Undeployed,
        guaranteedOffer,
        fallibleOffer,
      ).eraseProofs();

      const balanceResult = EitherOps.getOrThrowLeft(
        transacting.balanceTransaction(wallets.A.keys, wallets.A.wallet, txToBalance),
      );

      const afterRevert: CoreWallet = EitherOps.getOrThrowLeft(
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
        { type: rawShieldedTokenType, value: shieldedValue(3) },
      ]);
      expect(afterRevert.state.pendingSpends.size).toEqual(0);
    });

    it('reverts a balancing recipe (e.g. due to user cancelling it), cancelling coin watches from both fallible and guaranteed offer', () => {
      const theOtherTokenType = ledger.sampleRawTokenType();
      const theOtherTokenAmount = 10_000n;
      const initialCoinValues = [shieldedValue(3), { tokenType: theOtherTokenType, value: theOtherTokenAmount }];
      const wallets = prepareWallets({
        A: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: initialCoinValues },
        B: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);

      const fallibleOffer = makeOutputOffer({
        coin: ledger.createShieldedCoinInfo(theOtherTokenType, theOtherTokenAmount),
        recipient: wallets.B,
        segment: 1,
      });
      const guaranteedOffer = makeOutputOffer({
        coin: shieldedValue(1),
        recipient: wallets.B,
        segment: 0,
      });
      const txToBalance = ledger.Transaction.fromParts(
        NetworkId.NetworkId.Undeployed,
        guaranteedOffer,
        fallibleOffer,
      ).eraseProofs();

      const balanceResult = EitherOps.getOrThrowLeft(
        transacting.balanceTransaction(wallets.A.keys, wallets.A.wallet, txToBalance),
      );

      const afterRevert: CoreWallet = EitherOps.getOrThrowLeft(
        transacting.revertRecipe(balanceResult.newState, balanceResult.recipe),
      );

      expect(afterRevert.state.pendingOutputs.size).toEqual(0);
    });

    it('reverts a transfer recipe, releasing booked coins', () => {
      const wallets = prepareWallets({
        A: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: [shieldedValue(3)] },
        B: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);

      const result = EitherOps.getOrThrowLeft(
        transacting.makeTransfer(wallets.A.keys, wallets.A.wallet, [
          makeTransferOutput({ recipient: wallets.B, coin: shieldedValue(2) }),
        ]),
      );
      const afterRevert: CoreWallet = EitherOps.getOrThrowLeft(
        transacting.revertRecipe(result.newState, result.recipe),
      );

      expect(
        afterRevert.state.coins
          .values()
          .map((coin) => ({ type: coin.type, value: coin.value }))
          .toArray(),
      ).toEqual([{ type: rawShieldedTokenType, value: shieldedValue(3) }]);
      expect(afterRevert.state.pendingSpends.size).toEqual(0);
    });

    it('reverts a transfer recipe, cancelling coin watches', () => {
      const wallets = prepareWallets({
        A: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: [shieldedValue(3)] },
        B: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);

      const result = EitherOps.getOrThrowLeft(
        transacting.makeTransfer(wallets.A.keys, wallets.A.wallet, [
          makeTransferOutput({ recipient: wallets.B, coin: shieldedValue(2) }),
        ]),
      );
      const afterRevert: CoreWallet = EitherOps.getOrThrowLeft(
        transacting.revertRecipe(result.newState, result.recipe),
      );

      expect(afterRevert.state.pendingOutputs.size).toEqual(0);
    });

    it('does nothing reverting a "nothing to prove" recipe', () => {
      const wallets = prepareWallets({
        A: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 0)), coins: [shieldedValue(3)] },
        B: { keys: ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 1)), coins: [] },
      });
      const transacting = makeSimulatorTransactingCapability(defaultConfig, () => defaultContext);

      const result = EitherOps.getOrThrowLeft(
        transacting.makeTransfer(wallets.A.keys, wallets.A.wallet, [
          makeTransferOutput({ recipient: wallets.B, coin: shieldedValue(2) }),
        ]),
      );

      const afterRevert: CoreWallet = EitherOps.getOrThrowLeft(
        transacting.revertRecipe(result.newState, {
          type: NOTHING_TO_PROVE,
          transaction: pipe(
            makeOutputOffer({ recipient: wallets.A, coin: shieldedValue(1) }),
            (offer) => ledger.Transaction.fromParts(NetworkId.NetworkId.Undeployed, offer),
            (tx) => tx.eraseProofs(),
          ),
        }),
      );

      expect(afterRevert).toBe(result.newState);
    });
  });
});
