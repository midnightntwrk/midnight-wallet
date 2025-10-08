import * as ledger from '@midnight-ntwrk/ledger-v6';

/**
 * Temporary function until the ledger fixes imbalances.get()
 *
 * @param imbalances
 * @param rawTokenType
 * @returns bigint
 */
export const getNonDustImbalance = (
  imbalances: Map<ledger.TokenType, bigint>,
  rawTokenType: ledger.RawTokenType,
): bigint => {
  const [, value] = Array.from(imbalances.entries()).find(([t, value]) =>
    t.tag !== 'dust' && t.raw == rawTokenType ? value : undefined,
  ) ?? [undefined, BigInt(0)];

  return value;
};
