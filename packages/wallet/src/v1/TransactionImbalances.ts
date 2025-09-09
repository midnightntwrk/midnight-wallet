import * as ledger from '@midnight-ntwrk/ledger';
import { BigInt as BInt } from 'effect';
import { Imbalances, TransactionCostModel } from '@midnight-ntwrk/wallet-sdk-capabilities';

const shieldedTokenType = (ledger.shieldedToken() as { tag: 'shielded'; raw: string }).raw;

export type TotalCostParameters = {
  ledgerParams: ledger.LedgerParameters;
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
        imbalances.guaranteed,
        Imbalances.fromEntry((ledger.shieldedToken() as { tag: 'shielded'; raw: string }).raw, -1n * fees),
      );

      return {
        ...imbalances,
        guaranteed: newGuaranteed,
        fees: imbalances.fees + fees,
      };
    };

  feeTokenOnly = (imbalances: TransactionImbalances): TransactionImbalances => {
    const amount = imbalances.guaranteed.get(shieldedTokenType) ?? 0n;
    return {
      guaranteed: Imbalances.fromEntry(shieldedTokenType, amount),
      fallible: Imbalances.empty(),
      fees: amount,
    };
  };

  feesOnly = (imbalances: TransactionImbalances): TransactionImbalances => {
    return {
      guaranteed: Imbalances.fromEntry(shieldedTokenType, imbalances.fees),
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
        .filter(([tokenType]) => tokenType != shieldedTokenType)
        .every(([, value]) => value === 0n);
      const [, guaranteedDustImbalance] = imbalances.guaranteed
        .entries()
        .find(([tokenType]) => tokenType === shieldedTokenType) ?? [shieldedTokenType, 0n];
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
