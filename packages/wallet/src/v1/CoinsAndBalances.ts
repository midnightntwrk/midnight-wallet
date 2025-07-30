import { V1State } from './RunningV1Variant';
import * as zswap from '@midnight-ntwrk/zswap';
import { pipe, Array } from 'effect';
import * as RecordOps from '../effect/RecordOps';

export type AvailableCoin = {
  coin: zswap.QualifiedCoinInfo;
  commitment: zswap.CoinCommitment;
  nullifier: zswap.Nullifier;
};

export type PendingCoin = {
  coin: zswap.CoinInfo;
  commitment: zswap.CoinCommitment;
  nullifier: zswap.Nullifier;
};

export type Balances = Record<zswap.TokenType, bigint>;

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

  const getPendingCoins = (state: V1State): PendingCoin[] =>
    pipe(
      [...state.state.pendingOutputs.values()],
      Array.map((coin) => ({
        coin,
        commitment: zswap.coin_commitment(coin, state.secretKeys.coinPublicKey),
        nullifier: zswap.coin_nullifier(coin, state.secretKeys),
      })),
    );

  const getTotalCoins = (state: V1State): Array<PendingCoin | AvailableCoin> =>
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
