import { Imbalances } from '@midnight-ntwrk/wallet-sdk-capabilities';

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
})();
