import * as zswap from '@midnight-ntwrk/zswap';
import { BigInt as BInt } from 'effect';
import { Imbalances, TransactionCostModel } from '@midnight-ntwrk/wallet-sdk-capabilities';

export type TotalCostParameters = {
  ledgerParams: zswap.LedgerParameters;
  additionalFeeOverhead: bigint;
};
export const TotalCostParameters = new (class {
  getCorrectedCostModel = (params: TotalCostParameters): TransactionCostModel => {
    return {
      inputFeeOverhead: params.ledgerParams.transactionCostModel.inputFeeOverhead + params.additionalFeeOverhead,
      outputFeeOverhead: params.ledgerParams.transactionCostModel.outputFeeOverhead + params.additionalFeeOverhead,
    };
  };
})();

export type TransactionImbalances = Readonly<{
  guaranteed: Imbalances;
  fallible: Imbalances;
  /**
   * Fees needed to be paid in the tx
   * Not always they are needed to be known, but more often than not
   * It depends on context to know whether they are accommodated in the guaranteed imbalances or not yet
   */
  fees: bigint;
}>;
export const TransactionImbalances = new (class {
  empty = (): TransactionImbalances => {
    return {
      guaranteed: Imbalances.empty(),
      fallible: Imbalances.empty(),
      fees: 0n,
    };
  };

  addFeesOverhead =
    (fees: bigint) =>
    (imbalances: TransactionImbalances): TransactionImbalances => {
      const newGuaranteed = Imbalances.merge(
        Imbalances.fromEntry(zswap.nativeToken(), -1n * fees),
        imbalances.guaranteed,
      );

      return {
        ...imbalances,
        guaranteed: newGuaranteed,
        fees: imbalances.fees + fees,
      };
    };

  feeTokenOnly = (imbalances: TransactionImbalances): TransactionImbalances => {
    const amount = imbalances.guaranteed.get(zswap.nativeToken()) ?? 0n;
    return {
      guaranteed: Imbalances.fromEntry(zswap.nativeToken(), amount),
      fallible: Imbalances.empty(),
      fees: amount,
    };
  };

  feesOnly = (imbalances: TransactionImbalances): TransactionImbalances => {
    return {
      guaranteed: Imbalances.fromEntry(zswap.nativeToken(), imbalances.fees),
      fallible: Imbalances.empty(),
      fees: imbalances.fees,
    };
  };

  areBalanced =
    (costParams: TotalCostParameters) =>
    (imbalances: TransactionImbalances): boolean => {
      const areFallibleAllZeroes = imbalances.fallible.entries().every(([, value]) => value === 0n);
      const areGuaranteedWithoutDustAllZeroes = imbalances.guaranteed
        .entries()
        .filter(([tokenType]) => tokenType != zswap.nativeToken())
        .every(([, value]) => value === 0n);
      const [, guaranteedDustImbalance] = imbalances.guaranteed
        .entries()
        .find(([tokenType]) => tokenType === zswap.nativeToken()) ?? [zswap.nativeToken(), 0n];
      const isGuaranteedDustReasonablyBalanced = BInt.between(guaranteedDustImbalance, {
        minimum: imbalances.fees,
        maximum:
          imbalances.fees +
          costParams.additionalFeeOverhead +
          costParams.ledgerParams.transactionCostModel.outputFeeOverhead,
      });

      return areFallibleAllZeroes && areGuaranteedWithoutDustAllZeroes && isGuaranteedDustReasonablyBalanced;
    };
})();
