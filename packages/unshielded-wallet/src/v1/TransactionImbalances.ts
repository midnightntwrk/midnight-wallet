import { Imbalances, TransactionCostModel } from '@midnight-ntwrk/wallet-sdk-capabilities';

export const ShieldedCostModel: TransactionCostModel = {
  inputFeeOverhead: 0n,
  outputFeeOverhead: 0n,
};

export type TransactionImbalances = Readonly<{
  guaranteed: Imbalances;
  fallible: Imbalances;
}>;
export const TransactionImbalances = new (class {
  empty = (): TransactionImbalances => {
    return {
      guaranteed: Imbalances.empty(),
      fallible: Imbalances.empty(),
    };
  };

  areBalanced = (imbalances: TransactionImbalances): boolean => {
    const areFallibleAllZeroes = imbalances.fallible.entries().every(([, value]) => value === 0n);

    const areGuaranteedAllZeroes = imbalances.guaranteed.entries().every(([, value]) => value === 0n);

    return areFallibleAllZeroes && areGuaranteedAllZeroes;
  };
})();
