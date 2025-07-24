import { V1State } from './RunningV1Variant';
import * as zswap from '@midnight-ntwrk/zswap';
import { pipe, Array } from 'effect';
import * as RecordOps from '../effect/RecordOps';

export type AvailableCoin = {
  coin: zswap.QualifiedCoinInfo | zswap.CoinInfo;
  commitment: zswap.CoinCommitment;
  nullifier: zswap.Nullifier;
};

export type Balances = Record<zswap.TokenType, bigint>;

export type CoinsAndBalancesCapability<TState> = {
  getAvailableBalances(state: TState): Balances;
  getPendingBalances(state: TState): Balances;
  getTotalBalances(state: TState): Balances;
  getAvailableCoins(state: TState): AvailableCoin[];
  getPendingCoins(state: TState): AvailableCoin[];
  getTotalCoins(state: TState): AvailableCoin[];
};

const calculateBalances = <T extends AvailableCoin>(coins: T[]): Balances =>
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
    const pendingSpends = new Set([...state.state.pendingSpends.values()].map((coin) => coin.nonce));
    return pipe(
      [...state.state.coins],
      Array.filter((coin) => !pendingSpends.has(coin.nonce)),
      Array.map((coin) => ({
        coin,
        commitment: zswap.coin_commitment(coin, state.secretKeys.coinPublicKey),
        nullifier: zswap.coin_nullifier(coin, state.secretKeys),
      })),
    );
  };

  const getPendingCoins = (state: V1State): AvailableCoin[] =>
    pipe(
      [...state.state.pendingOutputs.values()],
      Array.map((coin) => ({
        coin,
        commitment: zswap.coin_commitment(coin, state.secretKeys.coinPublicKey),
        nullifier: zswap.coin_nullifier(coin, state.secretKeys),
      })),
    );

  const getTotalCoins = (state: V1State): AvailableCoin[] =>
    pipe(
      [...getAvailableCoins(state), ...getPendingCoins(state)],
      Array.map(({ coin, commitment, nullifier }) => ({ coin, commitment, nullifier })),
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
