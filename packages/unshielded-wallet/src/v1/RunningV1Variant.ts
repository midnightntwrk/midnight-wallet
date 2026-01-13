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
import { Effect, pipe, Record, Scope, Stream, SubscriptionRef, Schedule, Duration, Sink, Console } from 'effect';
import { ProtocolVersion } from '@midnight-ntwrk/wallet-sdk-abstractions';
import {
  WalletRuntimeError,
  Variant,
  StateChange,
  VersionChangeType,
} from '@midnight-ntwrk/wallet-sdk-runtime/abstractions';
import { EitherOps } from '@midnight-ntwrk/wallet-sdk-utilities';
import { SerializationCapability } from './Serialization.js';
import { SyncCapability, SyncService } from './Sync.js';
import { WalletSyncUpdate } from './SyncSchema.js';
import {
  TransactingCapability,
  TokenTransfer,
  BoundTransactionBalanceResult,
  UnboundTransactionBalanceResult,
  UnprovenTransactionBalanceResult,
} from './Transacting.js';
import { BoundTransaction, UnboundTransaction } from './TransactionOps.js';
import { WalletError } from './WalletError.js';
import { CoinsAndBalancesCapability } from './CoinsAndBalances.js';
import { KeysCapability } from './Keys.js';
import { CoinSelection } from '@midnight-ntwrk/wallet-sdk-capabilities';
import { CoreWallet } from './CoreWallet.js';
import { TransactionHistoryService } from './TransactionHistory.js';
import * as ledger from '@midnight-ntwrk/ledger-v7';

const progress = (state: CoreWallet): StateChange.StateChange<CoreWallet>[] => {
  const appliedId = state.progress?.appliedId ?? 0n;
  const highestTransactionId = state.progress?.highestTransactionId ?? 0n;

  const sourceGap = highestTransactionId - appliedId;
  const applyGap = appliedId - appliedId;

  return [StateChange.ProgressUpdate({ sourceGap, applyGap })];
};

const protocolVersionChange = (previous: CoreWallet, current: CoreWallet): StateChange.StateChange<CoreWallet>[] => {
  return previous.protocolVersion != current.protocolVersion
    ? [
        StateChange.VersionChange({
          change: VersionChangeType.Version({
            version: ProtocolVersion.ProtocolVersion(current.protocolVersion),
          }),
        }),
      ]
    : [];
};

export declare namespace RunningV1Variant {
  export type Context<TSerialized, TSyncUpdate> = {
    serializationCapability: SerializationCapability<CoreWallet, TSerialized>;
    syncService: SyncService<CoreWallet, TSyncUpdate>;
    syncCapability: SyncCapability<CoreWallet, TSyncUpdate>;
    transactingCapability: TransactingCapability<CoreWallet>;
    coinsAndBalancesCapability: CoinsAndBalancesCapability<CoreWallet>;
    keysCapability: KeysCapability<CoreWallet>;
    coinSelection: CoinSelection<ledger.Utxo>;
    transactionHistoryService: TransactionHistoryService<WalletSyncUpdate>;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type AnyContext = Context<any, any>;
}

export const V1Tag: unique symbol = Symbol('V1');

export type DefaultRunningV1 = RunningV1Variant<string, WalletSyncUpdate>;

export class RunningV1Variant<TSerialized, TSyncUpdate> implements Variant.RunningVariant<typeof V1Tag, CoreWallet> {
  readonly __polyTag__: typeof V1Tag = V1Tag;
  readonly #scope: Scope.Scope;
  readonly #context: Variant.VariantContext<CoreWallet>;
  readonly #v1Context: RunningV1Variant.Context<TSerialized, TSyncUpdate>;

  readonly state: Stream.Stream<StateChange.StateChange<CoreWallet>, WalletRuntimeError>;

  constructor(
    scope: Scope.Scope,
    context: Variant.VariantContext<CoreWallet>,
    v1Context: RunningV1Variant.Context<TSerialized, TSyncUpdate>,
  ) {
    this.#scope = scope;
    this.#context = context;
    this.#v1Context = v1Context;
    this.state = Stream.fromEffect(context.stateRef.get).pipe(
      Stream.flatMap((initialState) =>
        context.stateRef.changes.pipe(
          Stream.mapAccum(initialState, (previous: CoreWallet, current: CoreWallet) => {
            return [current, [previous, current]] as const;
          }),
        ),
      ),
      Stream.mapConcat(
        ([previous, current]: readonly [CoreWallet, CoreWallet]): StateChange.StateChange<CoreWallet>[] => {
          // TODO: emit progress only upon actual change
          return [
            StateChange.State({ state: current }),
            ...progress(current),
            ...protocolVersionChange(previous, current),
          ];
        },
      ),
    );
  }

  startSyncInBackground(): Effect.Effect<void> {
    return this.startSync().pipe(
      Stream.runScoped(Sink.drain),
      Effect.forkScoped,
      Effect.provideService(Scope.Scope, this.#scope),
    );
  }

  startSync(): Stream.Stream<void, WalletError, Scope.Scope> {
    return pipe(
      SubscriptionRef.get(this.#context.stateRef),
      Stream.fromEffect,
      Stream.flatMap((state) => this.#v1Context.syncService.updates(state)),
      Stream.mapEffect((update) => {
        return SubscriptionRef.updateEffect(this.#context.stateRef, (state) =>
          pipe(this.#v1Context.syncCapability.applyUpdate(state, update), EitherOps.toEffect),
        );
      }),
      Stream.tapError((error) => Console.error(error)),
      Stream.retry(
        pipe(
          Schedule.exponential(Duration.seconds(1), 2),
          Schedule.map((delay) => {
            const maxDelay = Duration.minutes(2);
            const jitter = Duration.millis(Math.floor(Math.random() * 1000));
            const delayWithJitter = Duration.toMillis(delay) + Duration.toMillis(jitter);

            return Duration.millis(Math.min(delayWithJitter, Duration.toMillis(maxDelay)));
          }),
        ),
      ),
    );
  }

  balanceBoundTransaction(tx: BoundTransaction): Effect.Effect<BoundTransactionBalanceResult, WalletError> {
    return SubscriptionRef.modifyEffect(this.#context.stateRef, (state) => {
      return pipe(this.#v1Context.transactingCapability.balanceBoundTransaction(state, tx), EitherOps.toEffect);
    });
  }

  balanceUnboundTransaction(tx: UnboundTransaction): Effect.Effect<UnboundTransactionBalanceResult, WalletError> {
    return SubscriptionRef.modifyEffect(this.#context.stateRef, (state) => {
      return pipe(this.#v1Context.transactingCapability.balanceUnboundTransaction(state, tx), EitherOps.toEffect);
    });
  }

  balanceUnprovenTransaction(
    tx: ledger.UnprovenTransaction,
  ): Effect.Effect<UnprovenTransactionBalanceResult, WalletError> {
    return SubscriptionRef.modifyEffect(this.#context.stateRef, (state) => {
      return pipe(this.#v1Context.transactingCapability.balanceUnprovenTransaction(state, tx), EitherOps.toEffect);
    });
  }

  transferTransaction(
    outputs: ReadonlyArray<TokenTransfer>,
    ttl: Date,
  ): Effect.Effect<ledger.UnprovenTransaction, WalletError> {
    return SubscriptionRef.modifyEffect(this.#context.stateRef, (state) => {
      return pipe(
        this.#v1Context.transactingCapability.makeTransfer(state, outputs, ttl),
        EitherOps.toEffect,
        Effect.map(({ transaction, newState }) => [transaction, newState]),
      );
    });
  }

  initSwap(
    desiredInputs: Record<string, bigint>,
    desiredOutputs: ReadonlyArray<TokenTransfer>,
    ttl: Date,
  ): Effect.Effect<ledger.UnprovenTransaction, WalletError> {
    return SubscriptionRef.modifyEffect(this.#context.stateRef, (state) => {
      return pipe(
        this.#v1Context.transactingCapability.initSwap(state, desiredInputs, desiredOutputs, ttl),
        Effect.map(({ transaction, newState }) => [transaction, newState]),
      );
    });
  }

  signTransaction(
    transaction: ledger.UnprovenTransaction,
    signSegment: (data: Uint8Array) => ledger.Signature,
  ): Effect.Effect<ledger.UnprovenTransaction, WalletError> {
    return this.#v1Context.transactingCapability.signTransaction(transaction, signSegment);
  }

  serializeState(state: CoreWallet): TSerialized {
    return this.#v1Context.serializationCapability.serialize(state);
  }
}
