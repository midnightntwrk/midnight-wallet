import { Effect, HashSet, pipe, Stream } from 'effect';
import { UnshieldedStateAPI, UnshieldedStateEncoder, Utxo } from '@midnight-ntwrk/wallet-sdk-unshielded-state';
import { ParseError } from 'effect/ParseResult';

export interface State {
  address: string;
  balances: Map<string, bigint>;
  pendingCoins: readonly Utxo[];
  availableCoins: readonly Utxo[];
  totalCoins: readonly Utxo[];
  syncProgress:
    | {
        applyGap: number;
        synced: boolean;
      }
    | undefined;
}

export class StateImpl {
  unshieldedState: UnshieldedStateAPI;
  address: string;

  constructor(unshieldedState: UnshieldedStateAPI, address: string) {
    this.unshieldedState = unshieldedState;
    this.address = address;
  }

  updates(): Stream.Stream<State> {
    return this.unshieldedState.state.pipe(
      Stream.map((state) => ({
        address: this.address,
        balances: HashSet.reduce(state.utxos, new Map<string, bigint>(), (acc, utxo) => {
          acc.set(utxo.type, (acc.get(utxo.type) || 0n) + utxo.value);
          return acc;
        }),
        pendingCoins: HashSet.toValues(state.pendingUtxos),
        availableCoins: HashSet.toValues(state.utxos),
        totalCoins: HashSet.toValues(HashSet.union(state.utxos, state.pendingUtxos)),
        syncProgress: state.syncProgress
          ? {
              applyGap:
                (state.syncProgress?.highestTransactionId ?? 0) - (state.syncProgress?.currentTransactionId ?? 0),
              synced: state.syncProgress?.highestTransactionId === state.syncProgress?.currentTransactionId,
            }
          : undefined,
      })),
    );
  }

  serialize(): Effect.Effect<string, ParseError> {
    return pipe(
      this.unshieldedState.getLatestState(),
      Effect.flatMap((state) => UnshieldedStateEncoder(state)),
      Effect.map((encoded) => JSON.stringify(encoded)),
    );
  }
}
