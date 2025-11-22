// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) 2025 Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
// http://www.apache.org/licenses/LICENSE-2.0
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
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
