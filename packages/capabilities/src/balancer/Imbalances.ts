export interface CoinRecipe {
  type: string;
  value: bigint;
}

export type Imbalance = [string, bigint];

export type Imbalances = Map<string, bigint>;

export const emptyImbalances: Imbalances = new Map<string, bigint>();

export const createImbalances = (imbalances: [string, bigint][]): Imbalances => {
  const mappedImbalances = new Map<string, bigint>();
  imbalances.forEach(([tokenType, value]) => {
    if (mappedImbalances.has(tokenType)) {
      mappedImbalances.set(tokenType, mappedImbalances.get(tokenType)! + value);
    } else {
      mappedImbalances.set(tokenType, value);
    }
  });

  return mappedImbalances;
};

export const mergeImbalances = (a: Imbalances, b: Imbalances): Imbalances => {
  b.forEach((valueB, tokenType) => {
    const valueA = a.get(tokenType) || 0n;
    a.set(tokenType, valueA + valueB);
  });
  return a;
};
