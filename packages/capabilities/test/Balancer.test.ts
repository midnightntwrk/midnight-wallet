import {
  ShieldedCoinInfo,
  createShieldedCoinInfo,
  QualifiedShieldedCoinInfo,
  sampleRawTokenType,
  shieldedToken,
  RawTokenType,
} from '@midnight-ntwrk/ledger-v6';
import { chooseCoin, CoinSelection, getBalanceRecipe, Imbalances, TransactionCostModel } from '../src/index';
import * as fc from 'fast-check';

const createQualifiedCoin = (tokenType: string, value: bigint) => ({
  ...createShieldedCoinInfo(tokenType, value),
  mt_index: 0n,
});

const dust = (value: number): bigint => BigInt(value * 10 ** 6);

const transactionCostModel = {
  inputFeeOverhead: 19314n,
  outputFeeOverhead: 19708n,
};

const nativeTokenType = (shieldedToken() as { tag: 'shielded'; raw: string }).raw;

const qualifiedCoinArbitrary = (typeArbitrary: fc.Arbitrary<RawTokenType>): fc.Arbitrary<QualifiedShieldedCoinInfo> => {
  return fc.record({
    nonce: fc.uint8Array({ maxLength: 32, minLength: 32 }).map((bytes) => Buffer.from(bytes).toString('hex')),
    value: fc.bigInt({ min: 1n, max: BigInt(Number.MAX_SAFE_INTEGER) }),
    mt_index: fc.constant(0n),
    type: typeArbitrary,
  });
};

const costModelArbitrary: fc.Arbitrary<TransactionCostModel> = fc.oneof(
  fc.constant<TransactionCostModel>({
    inputFeeOverhead: 0n,
    outputFeeOverhead: 0n,
  }),
  fc.record<TransactionCostModel>({
    inputFeeOverhead: fc.bigInt({ min: 0n, max: dust(1) }),
    outputFeeOverhead: fc.bigInt({ min: 0n, max: dust(1) }),
  }),
);

describe('Balancer', () => {
  test('Nothing to balance', () => {
    const counterOffer = getBalanceRecipe<QualifiedShieldedCoinInfo, ShieldedCoinInfo>({
      coins: [],
      initialImbalances: Imbalances.empty(),
      transactionCostModel,
      feeTokenType: nativeTokenType,
      createOutput: (c) => createShieldedCoinInfo(c.type, c.value),
      isCoinEqual: (a, b) => a.nonce === b.nonce,
    });

    expect(counterOffer.inputs).toHaveLength(0);
    expect(counterOffer.outputs).toHaveLength(0);
  });

  test('Use exactly one coin', () => {
    const coin = createQualifiedCoin(nativeTokenType, 1_000n + transactionCostModel.inputFeeOverhead);

    const counterOffer = getBalanceRecipe<QualifiedShieldedCoinInfo, ShieldedCoinInfo>({
      coins: [coin],
      initialImbalances: Imbalances.fromEntry(nativeTokenType, -1_000n),
      transactionCostModel,
      feeTokenType: nativeTokenType,
      createOutput: (c) => createShieldedCoinInfo(c.type, c.value),
      isCoinEqual: (a, b) => a.nonce === b.nonce,
    });

    expect(counterOffer.inputs).toHaveLength(1);
    expect(counterOffer.inputs[0]).toBe(coin);
    expect(counterOffer.outputs).toHaveLength(0);
  });

  test('Does not overspend coins', () => {
    const coins = [
      createQualifiedCoin(nativeTokenType, dust(10)),
      createQualifiedCoin(nativeTokenType, dust(10)),
      createQualifiedCoin(nativeTokenType, dust(10)),
    ];

    const counterOffer = getBalanceRecipe<QualifiedShieldedCoinInfo, ShieldedCoinInfo>({
      coins,
      initialImbalances: Imbalances.fromEntry(nativeTokenType, -dust(1)),
      transactionCostModel,
      feeTokenType: nativeTokenType,
      createOutput: (c) => createShieldedCoinInfo(c.type, c.value),
      isCoinEqual: (a, b) => a.nonce === b.nonce,
    });

    expect(counterOffer.inputs).toHaveLength(1);
    expect(counterOffer.outputs).toHaveLength(1);
  });

  test('Balance custom native token', () => {
    const customTokenType = sampleRawTokenType();
    const coins = [
      createQualifiedCoin(nativeTokenType, dust(100)),
      createQualifiedCoin(customTokenType, 1n),
      createQualifiedCoin(customTokenType, 2n),
      createQualifiedCoin(customTokenType, 3n),
    ];

    const counterOffer = getBalanceRecipe<QualifiedShieldedCoinInfo, ShieldedCoinInfo>({
      coins,
      initialImbalances: Imbalances.fromEntry(customTokenType, -1n),
      transactionCostModel,
      feeTokenType: nativeTokenType,
      createOutput: (c) => createShieldedCoinInfo(c.type, c.value),
      isCoinEqual: (a, b) => a.nonce === b.nonce,
    });

    expect(counterOffer.inputs).toHaveLength(2);
    expect(counterOffer.outputs).toHaveLength(1);
  });

  test('Balance multiple token types', () => {
    const customTokenType = sampleRawTokenType();
    const coins = [
      createQualifiedCoin(nativeTokenType, dust(10)),
      createQualifiedCoin(nativeTokenType, dust(20)),
      createQualifiedCoin(nativeTokenType, dust(30)),
      createQualifiedCoin(customTokenType, 1n),
      createQualifiedCoin(customTokenType, 2n),
      createQualifiedCoin(customTokenType, 3n),
    ];

    const targetImbalances = Imbalances.fromEntries([
      [customTokenType, -4n],
      [nativeTokenType, -dust(5)],
      [nativeTokenType, -dust(1)],
      [customTokenType, -1n],
    ]);

    const counterOffer = getBalanceRecipe<QualifiedShieldedCoinInfo, ShieldedCoinInfo>({
      coins,
      initialImbalances: targetImbalances,
      transactionCostModel,
      feeTokenType: nativeTokenType,
      createOutput: (coin) => createShieldedCoinInfo(coin.type, coin.value),
      isCoinEqual: (a, b) => a.nonce === b.nonce,
    });

    expect(counterOffer.inputs).toHaveLength(4);
    expect(counterOffer.outputs).toHaveLength(2);
  });

  test('Add change output', () => {
    const coin = createQualifiedCoin(nativeTokenType, dust(10));
    const counterOffer = getBalanceRecipe({
      coins: [coin],
      initialImbalances: Imbalances.fromEntry(nativeTokenType, -dust(3)),
      transactionCostModel,
      feeTokenType: nativeTokenType,
      createOutput: (c) => createShieldedCoinInfo(c.type, c.value),
      isCoinEqual: (a, b) => a.nonce === b.nonce,
    });

    expect(counterOffer.outputs).toHaveLength(1);
    expect(counterOffer.inputs).toContain(coin);
  });

  test("Fail if there aren't enough coins to cover the fees", () => {
    // due mapping the error in scala, the message in the thrown error is only the token type
    expect(() => {
      const coin = createQualifiedCoin(nativeTokenType, dust(1));
      return getBalanceRecipe({
        coins: [coin],
        initialImbalances: Imbalances.fromEntry(nativeTokenType, -dust(1)),
        transactionCostModel,
        feeTokenType: nativeTokenType,
        createOutput: (c) => createShieldedCoinInfo(c.type, c.value),
        isCoinEqual: (a, b) => a.nonce === b.nonce,
      });
    }).toThrow(nativeTokenType);
  });

  test('Fail if the change output value is smaller than the output fee', () => {
    expect(() => {
      const coin = createQualifiedCoin(nativeTokenType, transactionCostModel.inputFeeOverhead + 5n);

      const imbalanceValue = -(5n + transactionCostModel.outputFeeOverhead);

      return getBalanceRecipe({
        coins: [coin],
        initialImbalances: Imbalances.fromEntry(nativeTokenType, imbalanceValue),
        transactionCostModel,
        feeTokenType: nativeTokenType,
        createOutput: (c) => createShieldedCoinInfo(c.type, c.value),
        isCoinEqual: (a, b) => a.nonce === b.nonce,
      });
    }).toThrow(nativeTokenType);
  });

  test('Uses provided coin selection', () => {
    const nonceBasedSelection: CoinSelection<QualifiedShieldedCoinInfo> = (coins, type) => {
      return coins
        .filter((c) => c.type === type)
        .toSorted((a, b) => a.nonce.localeCompare(b.nonce))
        .at(0);
    };

    const coinsWithATargetValue = fc
      .record({
        valueToBalance: fc.bigInt({ min: 1n, max: BigInt(Number.MAX_SAFE_INTEGER) }),
        coins: fc.array(qualifiedCoinArbitrary(fc.constant(nativeTokenType)), { minLength: 1 }),
      })
      .filter(({ coins, valueToBalance }) => {
        const sum = coins.map((c) => c.value).reduce((a, b) => a + b);
        const desiredSum = BigInt(coins.length) * transactionCostModel.inputFeeOverhead + valueToBalance;

        return sum > desiredSum;
      });

    fc.assert(
      fc.property(coinsWithATargetValue, ({ coins, valueToBalance }) => {
        const nonceSortedCoins = coins.toSorted((a, b) => a.nonce.localeCompare(b.nonce));
        const counterOffer = getBalanceRecipe<QualifiedShieldedCoinInfo, ShieldedCoinInfo>({
          coins,
          initialImbalances: Imbalances.fromEntry(nativeTokenType, -1n * valueToBalance),
          transactionCostModel,
          feeTokenType: nativeTokenType,
          createOutput: (c) => createShieldedCoinInfo(c.type, c.value),
          coinSelection: nonceBasedSelection,
          isCoinEqual: (a, b) => a.nonce === b.nonce,
        });

        const counterOfferInputNonces = new Set(counterOffer.inputs.map((i) => i.nonce));
        const expectedNonces = new Set(nonceSortedCoins.slice(0, counterOffer.inputs.length).map((i) => i.nonce));

        expect(counterOfferInputNonces).toEqual(expectedNonces);
      }),
    );
  });

  test('Reaches target imbalances', () => {
    const tokenTypeArbitrary = fc.constantFrom(
      nativeTokenType,
      sampleRawTokenType(),
      sampleRawTokenType(),
      sampleRawTokenType(),
      sampleRawTokenType(),
    );
    const coinArbitrary = qualifiedCoinArbitrary(tokenTypeArbitrary);
    const coinWithDesiredInputValueArbitrary: fc.Arbitrary<{
      coin: QualifiedShieldedCoinInfo;
      maybeInputValue: bigint | null;
    }> = coinArbitrary.chain((coin) =>
      fc
        .option(
          fc.bigInt({
            min: 1n,
            max: coin.value,
          }),
        )
        .map((maybeInputValue) => ({ coin, maybeInputValue })),
    );
    const testCoinsArbitrary = fc.array(coinWithDesiredInputValueArbitrary);

    fc.assert(
      fc.property(
        testCoinsArbitrary,
        costModelArbitrary,
        fc.integer({ min: 0, max: 10 }),
        (coinsWithInputValues, costModel, existingOutputsToCover) => {
          const availableCoins = coinsWithInputValues
            .map(({ coin }) => coin)
            .concat(createQualifiedCoin(nativeTokenType, dust(100)));
          const availableNonces = new Set(availableCoins.map((c) => c.nonce));
          const desiredImbalances: Imbalances = coinsWithInputValues
            .map(({ coin, maybeInputValue }) => ({ value: maybeInputValue ?? 0n, type: coin.type }))
            .reduce((acc: Imbalances, { type, value }) => {
              const existingValue = acc.get(type) ?? 0n;
              acc.set(type, existingValue + value);
              return acc;
            }, new Map() as Imbalances);
          const existingFeesToCover = BigInt(existingOutputsToCover) * costModel.outputFeeOverhead;
          const desiredNonDustImbalances = new Map(
            desiredImbalances.entries().filter(([type]) => type != nativeTokenType),
          );
          const initialDesiredDustImbalance = (desiredImbalances.get(nativeTokenType) ?? 0n) + existingFeesToCover;

          const result = getBalanceRecipe<QualifiedShieldedCoinInfo, ShieldedCoinInfo>({
            coins: availableCoins,
            initialImbalances: new Map([[nativeTokenType, -1n * existingFeesToCover]]),
            transactionCostModel: costModel,
            feeTokenType: nativeTokenType,
            createOutput: (c) => createShieldedCoinInfo(c.type, c.value),
            coinSelection: chooseCoin,
            targetImbalances: desiredImbalances,
            isCoinEqual: (a, b) => a.nonce === b.nonce,
          });

          const resultInputImbalances: Imbalances = result.inputs.reduce((acc, coin) => {
            const existingValue = acc.get(coin.type) ?? 0n;
            acc.set(coin.type, existingValue + coin.value);
            return acc;
          }, new Map() as Imbalances);
          const resultImbalances: Imbalances = result.outputs.reduce((acc, coin) => {
            const existingValue = acc.get(coin.type) ?? 0n;
            acc.set(coin.type, existingValue - coin.value);
            return acc;
          }, resultInputImbalances);
          const finalExpectedDustImbalance =
            initialDesiredDustImbalance +
            BigInt(result.inputs.length) * costModel.inputFeeOverhead +
            BigInt(result.outputs.length) * costModel.outputFeeOverhead;

          const resultInputNonces = new Set(result.inputs.map((c) => c.nonce));

          expect(availableNonces.intersection(resultInputNonces)).toEqual(resultInputNonces);
          resultImbalances.entries().forEach(([type, value]) => {
            if (type === nativeTokenType) {
              expect(value).toBeGreaterThanOrEqual(finalExpectedDustImbalance);
              expect(value).toBeLessThanOrEqual(finalExpectedDustImbalance + costModel.outputFeeOverhead);
            } else {
              expect(value).toEqual(desiredNonDustImbalances.get(type));
            }
          });
        },
      ),
    );
  });

  test('Errors if there are no tokens to meet target imbalances', () => {
    const tokenTypeArbitrary = fc.constantFrom(
      nativeTokenType,
      sampleRawTokenType(),
      sampleRawTokenType(),
      sampleRawTokenType(),
      sampleRawTokenType(),
    );
    const otherTokenType = sampleRawTokenType();
    const coinArbitrary = qualifiedCoinArbitrary(tokenTypeArbitrary);
    const testCoinsArbitrary = fc.array(coinArbitrary);
    const desiredInputsArbitrary = fc
      .bigInt({ min: 1n, max: BigInt(Number.MAX_SAFE_INTEGER) })
      .map((targetValue) => new Map([[otherTokenType, targetValue]]));

    fc.assert(
      fc.property(testCoinsArbitrary, desiredInputsArbitrary, costModelArbitrary, (coins, inputs, costModel) => {
        expect(() =>
          getBalanceRecipe<QualifiedShieldedCoinInfo, ShieldedCoinInfo>({
            coins,
            initialImbalances: new Map(),
            transactionCostModel: costModel,
            feeTokenType: nativeTokenType,
            createOutput: (c) => createShieldedCoinInfo(c.type, c.value),
            coinSelection: chooseCoin,
            targetImbalances: inputs,
            isCoinEqual: (a, b) => a.nonce === b.nonce,
          }),
        ).toThrow(otherTokenType);
      }),
    );
  });
});
