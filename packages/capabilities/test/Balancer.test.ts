import { createCoinInfo } from '@midnight-ntwrk/zswap';
import { getBalanceRecipe, emptyImbalances, createImbalances } from '../src';

const createQualifiedCoin = (tokenType: string, value: bigint) => ({
  ...createCoinInfo(tokenType, value),
  mt_index: 0n,
});

const aggregateDustValue = (value: number): bigint => BigInt(value * 10 ** 6);

const transactionCostModel = {
  inputFeeOverhead: 19314n,
  outputFeeOverhead: 19708n,
};

const nativeTokenType = '02000000000000000000000000000000000000000000000000000000000000000000';

describe('Balancer', () => {
  test('Nothing to balance', () => {
    const counterOffer = getBalanceRecipe([], emptyImbalances, transactionCostModel, nativeTokenType);
    expect(counterOffer.inputs).toHaveLength(0);
    expect(counterOffer.outputs).toHaveLength(0);
  });

  test('Use exactly one coin', () => {
    const coin = createQualifiedCoin(nativeTokenType, 1_000n + transactionCostModel.inputFeeOverhead);
    const counterOffer = getBalanceRecipe(
      [coin],
      createImbalances([[nativeTokenType, -1_000n]]),
      transactionCostModel,
      nativeTokenType,
    );
    expect(counterOffer.inputs).toHaveLength(1);
    expect(counterOffer.inputs[0]).toBe(coin);
    expect(counterOffer.outputs).toHaveLength(0);
  });

  test('Does not overspend coins', () => {
    const coins = [
      createQualifiedCoin(nativeTokenType, aggregateDustValue(10)),
      createQualifiedCoin(nativeTokenType, aggregateDustValue(10)),
      createQualifiedCoin(nativeTokenType, aggregateDustValue(10)),
    ];

    const counterOffer = getBalanceRecipe(
      coins,
      createImbalances([[nativeTokenType, -aggregateDustValue(1)]]),
      transactionCostModel,
      nativeTokenType,
    );

    expect(counterOffer.inputs).toHaveLength(1);
    expect(counterOffer.outputs).toHaveLength(1);
  });

  test('Balance custom native token', () => {
    const customTokenType = '02000000000000000000000000000000000000000000000000000000000000000002';
    const coins = [
      createQualifiedCoin(nativeTokenType, aggregateDustValue(10)),
      createQualifiedCoin(customTokenType, 1n),
      createQualifiedCoin(customTokenType, 2n),
      createQualifiedCoin(customTokenType, 3n),
    ];

    const counterOffer = getBalanceRecipe(
      coins,
      createImbalances([[customTokenType, -1n]]),
      transactionCostModel,
      nativeTokenType,
    );

    expect(counterOffer.inputs).toHaveLength(2);
    expect(counterOffer.outputs).toHaveLength(1);
  });

  test('Balance multiple token types', () => {
    const customTokenType = '02000000000000000000000000000000000000000000000000000000000000000001';
    const coins = [
      createQualifiedCoin(nativeTokenType, aggregateDustValue(10)),
      createQualifiedCoin(nativeTokenType, aggregateDustValue(20)),
      createQualifiedCoin(nativeTokenType, aggregateDustValue(30)),
      createQualifiedCoin(customTokenType, 1n),
      createQualifiedCoin(customTokenType, 2n),
      createQualifiedCoin(customTokenType, 3n),
    ];

    const targetImbalances = createImbalances([
      [customTokenType, -4n],
      [nativeTokenType, -aggregateDustValue(5)],
      [nativeTokenType, -aggregateDustValue(1)],
      [customTokenType, -1n],
    ]);

    const counterOffer = getBalanceRecipe(coins, targetImbalances, transactionCostModel, nativeTokenType);

    expect(counterOffer.inputs).toHaveLength(4);
    expect(counterOffer.outputs).toHaveLength(2);
  });

  test('Add change output', () => {
    const coin = createQualifiedCoin(nativeTokenType, aggregateDustValue(10));
    const counterOffer = getBalanceRecipe(
      [coin],
      createImbalances([[nativeTokenType, -aggregateDustValue(3)]]),
      transactionCostModel,
      nativeTokenType,
    );

    expect(counterOffer.outputs).toHaveLength(1);
    expect(counterOffer.inputs).toContain(coin);
  });

  test("Fail if there aren't enough coins to cover the fees", () => {
    // due mapping the error in scala, the message in the thrown error is only the token type
    expect(() => {
      const coin = createQualifiedCoin(nativeTokenType, aggregateDustValue(1));
      return getBalanceRecipe(
        [coin],
        createImbalances([[nativeTokenType, -aggregateDustValue(1)]]),
        transactionCostModel,
        nativeTokenType,
      );
    }).toThrow(nativeTokenType);
  });

  test('Fail if the change output value is smaller than the output fee', () => {
    expect(() => {
      const coin = createQualifiedCoin(nativeTokenType, transactionCostModel.inputFeeOverhead + 5n);

      const imbalanceValue = -(5n + transactionCostModel.outputFeeOverhead);

      return getBalanceRecipe(
        [coin],
        createImbalances([[nativeTokenType, imbalanceValue]]),
        transactionCostModel,
        nativeTokenType,
      );
    }).toThrow(nativeTokenType);
  });
});
