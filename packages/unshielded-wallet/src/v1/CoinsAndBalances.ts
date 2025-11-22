import { CoreWallet } from './CoreWallet.js';
import * as ledger from '@midnight-ntwrk/ledger-v6';
import { pipe, Array, Effect, HashSet } from 'effect';
import { RecordOps } from '@midnight-ntwrk/wallet-sdk-utilities';
import { Utxo } from '@midnight-ntwrk/wallet-sdk-unshielded-state';

export type Balances = Record<ledger.RawTokenType, bigint>;

export type CoinsAndBalancesCapability<TState> = {
  getAvailableBalances(state: TState): Balances;
  getPendingBalances(state: TState): Balances;
  getTotalBalances(state: TState): Balances;
  getAvailableCoins(state: TState): readonly Utxo[];
  getPendingCoins(state: TState): readonly Utxo[];
  getTotalCoins(state: TState): ReadonlyArray<Utxo>;
};

const calculateBalances = (utxos: readonly Utxo[]): Balances =>
  utxos.reduce(
    (acc: Balances, utxo) => ({
      ...acc,
      [utxo.type]: acc[utxo.type] === undefined ? utxo.value : acc[utxo.type] + utxo.value,
    }),
    {},
  );

export const makeDefaultCoinsAndBalancesCapability = (): CoinsAndBalancesCapability<CoreWallet> => {
  const getAvailableBalances = (state: CoreWallet): Balances => {
    const availableCoins = getAvailableCoins(state);

    return calculateBalances(availableCoins);
  };

  const getPendingBalances = (state: CoreWallet): Balances => {
    const pendingCoins = getPendingCoins(state);

    return calculateBalances(pendingCoins);
  };

  const getTotalBalances = (state: CoreWallet): Balances => {
    const availableBalances = getAvailableBalances(state);
    const pendingBalances = getPendingBalances(state);

    return pipe(
      [availableBalances, pendingBalances],
      RecordOps.mergeWithAccumulator(0n, (a, b) => a + b),
    );
  };

  const getAvailableCoins = (state: CoreWallet): Utxo[] =>
    pipe(
      state.state.getLatestState(),
      Effect.map((state) => HashSet.toValues(state.utxos)),
      Effect.runSync,
    );

  const getPendingCoins = (state: CoreWallet): Utxo[] =>
    pipe(
      state.state.getLatestState(),
      Effect.map((state) => HashSet.toValues(state.pendingUtxos)),
      Effect.runSync,
    );

  const getTotalCoins = (state: CoreWallet): Array<Utxo> => [...getAvailableCoins(state), ...getPendingCoins(state)];

  return {
    getAvailableBalances,
    getPendingBalances,
    getTotalBalances,
    getAvailableCoins,
    getPendingCoins,
    getTotalCoins,
  };
};
