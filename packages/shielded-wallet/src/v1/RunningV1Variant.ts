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
import type * as ledger from '@midnight-ntwrk/ledger-v7';
import { Effect, pipe, type Record, Scope, Stream, SubscriptionRef, Schedule, Duration, Sink, Console } from 'effect';
import { ProtocolVersion } from '@midnight-ntwrk/wallet-sdk-abstractions';
import {
  type WalletRuntimeError,
  type Variant,
  StateChange,
  VersionChangeType,
} from '@midnight-ntwrk/wallet-sdk-runtime/abstractions';
import { EitherOps } from '@midnight-ntwrk/wallet-sdk-utilities';
import { type ProvingService } from './Proving.js';
import { type SerializationCapability } from './Serialization.js';
import { type EventsSyncUpdate, type SyncCapability, type SyncService } from './Sync.js';
import { type TransactingCapability, type TokenTransfer, type BalancingResult } from './Transacting.js';
import { OtherWalletError, type WalletError } from './WalletError.js';
import { type CoinsAndBalancesCapability } from './CoinsAndBalances.js';
import { type KeysCapability } from './Keys.js';
import { type SubmissionService, type SubmitTransactionMethod } from './Submission.js';
import { type CoinSelection } from '@midnight-ntwrk/wallet-sdk-capabilities';
import { type CoreWallet } from './CoreWallet.js';
import { type TransactionHistoryCapability } from './TransactionHistory.js';

const progress = (state: CoreWallet): StateChange.StateChange<CoreWallet>[] => {
  const appliedIndex = state.progress?.appliedIndex ?? 0n;
  const highestRelevantWalletIndex = state.progress?.highestRelevantWalletIndex ?? 0n;
  const highestIndex = state.progress?.highestIndex ?? 0n;
  const highestRelevantIndex = state.progress?.highestRelevantIndex ?? 0n;

  const sourceGap = highestIndex - highestRelevantIndex;
  const applyGap = highestRelevantWalletIndex - appliedIndex;

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
  export type Context<TSerialized, TSyncUpdate, TTransaction, TStartAux> = {
    serializationCapability: SerializationCapability<CoreWallet, null, TSerialized>;
    syncService: SyncService<CoreWallet, TStartAux, TSyncUpdate>;
    syncCapability: SyncCapability<CoreWallet, TSyncUpdate>;
    transactingCapability: TransactingCapability<ledger.ZswapSecretKeys, CoreWallet, TTransaction>;
    provingService: ProvingService<TTransaction>;
    coinsAndBalancesCapability: CoinsAndBalancesCapability<CoreWallet>;
    keysCapability: KeysCapability<CoreWallet>;
    submissionService: SubmissionService<TTransaction>;
    coinSelection: CoinSelection<ledger.QualifiedShieldedCoinInfo>;
    transactionHistoryCapability: TransactionHistoryCapability<CoreWallet, TTransaction>;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type AnyContext = Context<any, any, any, any>;
}

export const V1Tag: unique symbol = Symbol('V1');

export type DefaultRunningV1 = RunningV1Variant<
  string,
  EventsSyncUpdate,
  ledger.FinalizedTransaction,
  ledger.ZswapSecretKeys
>;

export class RunningV1Variant<TSerialized, TSyncUpdate, TTransaction, TStartAux> implements Variant.RunningVariant<
  typeof V1Tag,
  CoreWallet
> {
  readonly __polyTag__: typeof V1Tag = V1Tag;
  readonly #scope: Scope.Scope;
  readonly #context: Variant.VariantContext<CoreWallet>;
  readonly #v1Context: RunningV1Variant.Context<TSerialized, TSyncUpdate, TTransaction, TStartAux>;

  readonly state: Stream.Stream<StateChange.StateChange<CoreWallet>, WalletRuntimeError>;

  constructor(
    scope: Scope.Scope,
    context: Variant.VariantContext<CoreWallet>,
    v1Context: RunningV1Variant.Context<TSerialized, TSyncUpdate, TTransaction, TStartAux>,
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

  startSyncInBackground(startAux: TStartAux): Effect.Effect<void> {
    return this.startSync(startAux).pipe(
      Stream.runScoped(Sink.drain),
      Effect.forkScoped,
      Effect.provideService(Scope.Scope, this.#scope),
    );
  }

  startSync(startAux: TStartAux): Stream.Stream<void, WalletError, Scope.Scope> {
    return pipe(
      SubscriptionRef.get(this.#context.stateRef),
      Stream.fromEffect,
      Stream.flatMap((state) => this.#v1Context.syncService.updates(state, startAux)),
      Stream.mapEffect((update) => {
        return SubscriptionRef.updateEffect(this.#context.stateRef, (state) =>
          Effect.try({
            try: () => this.#v1Context.syncCapability.applyUpdate(state, update),
            catch: (err) =>
              new OtherWalletError({
                message: 'Error while applying sync update',
                cause: err,
              }),
          }),
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

  balanceTransaction(
    secretKeys: ledger.ZswapSecretKeys,
    tx: ledger.Transaction<ledger.Signaturish, ledger.Proofish, ledger.Bindingish>,
  ): Effect.Effect<BalancingResult, WalletError> {
    return SubscriptionRef.modifyEffect(this.#context.stateRef, (state) => {
      return pipe(this.#v1Context.transactingCapability.balanceTransaction(secretKeys, state, tx), EitherOps.toEffect);
    });
  }

  transferTransaction(
    secretKeys: ledger.ZswapSecretKeys,
    outputs: ReadonlyArray<TokenTransfer>,
  ): Effect.Effect<ledger.UnprovenTransaction, WalletError> {
    return SubscriptionRef.modifyEffect(this.#context.stateRef, (state) => {
      return pipe(this.#v1Context.transactingCapability.makeTransfer(secretKeys, state, outputs), EitherOps.toEffect);
    });
  }

  initSwap(
    secretKeys: ledger.ZswapSecretKeys,
    desiredInputs: Record<ledger.RawTokenType, bigint>,
    desiredOutputs: ReadonlyArray<TokenTransfer>,
  ): Effect.Effect<ledger.UnprovenTransaction, WalletError> {
    return SubscriptionRef.modifyEffect(this.#context.stateRef, (state) => {
      return pipe(
        this.#v1Context.transactingCapability.initSwap(secretKeys, state, desiredInputs, desiredOutputs),
        EitherOps.toEffect,
      );
    });
  }

  finalizeTransaction(transaction: ledger.UnprovenTransaction): Effect.Effect<TTransaction, WalletError> {
    return this.#v1Context.provingService
      .prove(transaction)
      .pipe(
        Effect.tapError(() =>
          SubscriptionRef.updateEffect(this.#context.stateRef, (state) =>
            EitherOps.toEffect(this.#v1Context.transactingCapability.revertTransaction(state, transaction)),
          ),
        ),
      );
  }

  submitTransaction: SubmitTransactionMethod<TTransaction> = ((
    transaction: TTransaction,
    waitForStatus: 'Submitted' | 'InBlock' | 'Finalized' = 'InBlock',
  ) => {
    return this.#v1Context.submissionService
      .submitTransaction(transaction, waitForStatus)
      .pipe(
        Effect.tapError(() =>
          SubscriptionRef.updateEffect(this.#context.stateRef, (state) =>
            EitherOps.toEffect(this.#v1Context.transactingCapability.revertTransaction(state, transaction)),
          ),
        ),
      );
  }) as SubmitTransactionMethod<TTransaction>;

  serializeState(state: CoreWallet): TSerialized {
    return this.#v1Context.serializationCapability.serialize(state);
  }
}
