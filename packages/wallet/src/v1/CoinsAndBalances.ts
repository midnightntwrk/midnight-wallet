import { V1State } from './RunningV1Variant';
import * as ledger from '@midnight-ntwrk/ledger';
import { pipe, Array } from 'effect';
import * as RecordOps from '../effect/RecordOps';

export type Coin<T extends ledger.QualifiedShieldedCoinInfo | ledger.ShieldedCoinInfo> = {
  coin: T;
  ttl: Date | undefined;
};

export type AvailableCoin = Coin<ledger.QualifiedShieldedCoinInfo>;

export type PendingCoin = Coin<ledger.ShieldedCoinInfo>;

export type Balances = Record<ledger.RawTokenType, bigint>;

export type CoinsAndBalancesCapability<TState> = {
  getAvailableBalances(state: TState): Balances;
  getPendingBalances(state: TState): Balances;
  getTotalBalances(state: TState): Balances;
  getAvailableCoins(state: TState): readonly AvailableCoin[];
  getPendingCoins(state: TState): readonly PendingCoin[];
  getTotalCoins(state: TState): ReadonlyArray<AvailableCoin | PendingCoin>;
};

const calculateBalances = <T extends AvailableCoin | PendingCoin>(coins: T[]): Balances =>
  coins.reduce(
    (acc: Balances, { coin }) => ({
      ...acc,
      [coin.type]: acc[coin.type] === undefined ? coin.value : acc[coin.type] + coin.value,
    }),
    {},
  );

export const makeDefaultCoinsAndBalancesCapability = (): CoinsAndBalancesCapability<V1State> => {
  const getAvailableBalances = (state: V1State): Balances => {
    const availableCoins = getAvailableCoins(state);

    return calculateBalances(availableCoins);
  };

  const getPendingBalances = (state: V1State): Balances => {
    const pendingCoins = getPendingCoins(state);

    return calculateBalances(pendingCoins);
  };

  const getTotalBalances = (state: V1State): Balances => {
    const availableBalances = getAvailableBalances(state);
    const pendingBalances = getPendingBalances(state);

    return pipe(
      [availableBalances, pendingBalances],
      RecordOps.mergeWithAccumulator(0n, (a, b) => a + b),
    );
  };

  const getAvailableCoins = (state: V1State): AvailableCoin[] => {
    const pendingSpends = new Set([...state.state.pendingSpends.values()].map(([coin]) => coin.nonce));
    return pipe(
      [...state.state.coins],
      Array.filter((coin) => !pendingSpends.has(coin.nonce)),
      Array.map((coin) => ({
        coin,
        ttl: undefined,
      })),
    );
  };

  const getPendingCoins = (state: V1State): PendingCoin[] =>
    pipe(
      [...state.state.pendingOutputs.values()],
      Array.map(([coin, ttl]) => ({
        coin,
        ttl,
      })),
    );

  const getTotalCoins = (state: V1State): Array<PendingCoin | AvailableCoin> =>
    pipe(
      [...getAvailableCoins(state), ...getPendingCoins(state)],
      Array.map(({ coin, ttl }) => ({ coin, ttl })),
    );

  return {
    getAvailableBalances,
    getPendingBalances,
    getTotalBalances,
    getAvailableCoins,
    getPendingCoins,
    getTotalCoins,
  };
};
