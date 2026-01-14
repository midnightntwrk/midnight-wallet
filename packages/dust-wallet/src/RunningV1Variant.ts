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
import { Effect, SubscriptionRef, Stream, pipe, Scope, Sink, Console, Duration, Schedule } from 'effect';
import {
  DustSecretKey,
  nativeToken,
  Signature,
  SignatureVerifyingKey,
  FinalizedTransaction,
  UnprovenTransaction,
} from '@midnight-ntwrk/ledger-v7';
import { ProtocolVersion } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { Proving, ProvingRecipe, WalletError } from '@midnight-ntwrk/wallet-sdk-shielded/v1';
import { EitherOps } from '@midnight-ntwrk/wallet-sdk-utilities';
import {
  WalletRuntimeError,
  Variant,
  StateChange,
  VersionChangeType,
} from '@midnight-ntwrk/wallet-sdk-runtime/abstractions';
import { DustToken, UtxoWithMeta } from './types/Dust.js';
import { KeysCapability } from './Keys.js';
import { SyncCapability, SyncService } from './Sync.js';
import { SimulatorState } from './Simulator.js';
import { CoinsAndBalancesCapability, CoinSelection, UtxoWithFullDustDetails } from './CoinsAndBalances.js';
import { TransactingCapability } from './Transacting.js';
import { SubmissionService, SubmitTransactionMethod } from './Submission.js';
import { DustCoreWallet } from './DustCoreWallet.js';
import { SerializationCapability } from './Serialization.js';
import { AnyTransaction } from './types/ledger.js';

const progress = (state: DustCoreWallet): StateChange.StateChange<DustCoreWallet>[] => {
  const appliedIndex = state.progress?.appliedIndex ?? 0n;
  const highestRelevantWalletIndex = state.progress?.highestRelevantWalletIndex ?? 0n;
  const highestIndex = state.progress?.highestIndex ?? 0n;
  const highestRelevantIndex = state.progress?.highestRelevantIndex ?? 0n;

  const sourceGap = highestIndex - highestRelevantIndex;
  const applyGap = highestRelevantWalletIndex - appliedIndex;

  return [StateChange.ProgressUpdate({ sourceGap, applyGap })];
};

const protocolVersionChange = (
  previous: DustCoreWallet,
  current: DustCoreWallet,
): StateChange.StateChange<DustCoreWallet>[] => {
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
    serializationCapability: SerializationCapability<DustCoreWallet, null, TSerialized>;
    syncService: SyncService<DustCoreWallet, TStartAux, TSyncUpdate>;
    syncCapability: SyncCapability<DustCoreWallet, TSyncUpdate>;
    transactingCapability: TransactingCapability<DustSecretKey, DustCoreWallet, TTransaction>;
    provingService: Proving.ProvingService<TTransaction>;
    coinsAndBalancesCapability: CoinsAndBalancesCapability<DustCoreWallet>;
    keysCapability: KeysCapability<DustCoreWallet>;
    submissionService: SubmissionService<TTransaction>;
    coinSelection: CoinSelection<DustToken>;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type AnyContext = Context<any, any, any, any>;
}

export const V1Tag: unique symbol = Symbol('V1');

export type DefaultRunningV1 = RunningV1Variant<string, SimulatorState, FinalizedTransaction, DustSecretKey>;

export class RunningV1Variant<TSerialized, TSyncUpdate, TTransaction, TStartAux> implements Variant.RunningVariant<
  typeof V1Tag,
  DustCoreWallet
> {
  __polyTag__: typeof V1Tag = V1Tag;
  readonly #scope: Scope.Scope;
  readonly #context: Variant.VariantContext<DustCoreWallet>;
  readonly #v1Context: RunningV1Variant.Context<TSerialized, TSyncUpdate, TTransaction, TStartAux>;

  readonly state: Stream.Stream<StateChange.StateChange<DustCoreWallet>, WalletRuntimeError>;

  constructor(
    scope: Scope.Scope,
    context: Variant.VariantContext<DustCoreWallet>,
    v1Context: RunningV1Variant.Context<TSerialized, TSyncUpdate, TTransaction, TStartAux>,
  ) {
    this.#scope = scope;
    this.#context = context;
    this.#v1Context = v1Context;
    this.state = Stream.fromEffect(context.stateRef.get).pipe(
      Stream.flatMap((initialState) =>
        context.stateRef.changes.pipe(
          Stream.mapAccum(initialState, (previous: DustCoreWallet, current: DustCoreWallet) => {
            return [current, [previous, current]] as const;
          }),
        ),
      ),
      Stream.mapConcat(
        ([previous, current]: readonly [DustCoreWallet, DustCoreWallet]): StateChange.StateChange<DustCoreWallet>[] => {
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

  startSync(startAux: TStartAux): Stream.Stream<void, WalletError.WalletError, Scope.Scope> {
    return pipe(
      SubscriptionRef.get(this.#context.stateRef),
      Stream.fromEffect,
      Stream.flatMap((state) => this.#v1Context.syncService.updates(state, startAux)),
      Stream.mapEffect((update) => {
        return SubscriptionRef.updateEffect(this.#context.stateRef, (state) =>
          Effect.try({
            try: () => this.#v1Context.syncCapability.applyUpdate(state, update),
            catch: (err) =>
              new WalletError.OtherWalletError({
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

  createDustGenerationTransaction(
    currentTime: Date | undefined,
    ttl: Date,
    nightUtxos: ReadonlyArray<UtxoWithMeta>,
    nightVerifyingKey: SignatureVerifyingKey,
    dustReceiverAddress: string | undefined,
  ): Effect.Effect<UnprovenTransaction, WalletError.WalletError> {
    if (nightUtxos.some((utxo) => utxo.type !== nativeToken().raw)) {
      return Effect.fail(WalletError.WalletError.other('Token of a non-Night type received'));
    }
    return Effect.Do.pipe(
      Effect.bind('currentState', () => SubscriptionRef.get(this.#context.stateRef)),
      Effect.bind('blockData', () => this.#v1Context.syncService.blockData()),
      Effect.let('currentTime', ({ blockData }): Date => currentTime ?? blockData.timestamp),
      Effect.let('utxosWithDustValue', ({ currentState, currentTime }): ReadonlyArray<UtxoWithFullDustDetails> => {
        return this.#v1Context.coinsAndBalancesCapability.estimateDustGeneration(currentState, nightUtxos, currentTime);
      }),
      Effect.flatMap(({ utxosWithDustValue, currentTime }) => {
        return this.#v1Context.transactingCapability
          .createDustGenerationTransaction(currentTime, ttl, utxosWithDustValue, nightVerifyingKey, dustReceiverAddress)
          .pipe(EitherOps.toEffect);
      }),
    );
  }

  addDustGenerationSignature(
    transaction: UnprovenTransaction,
    signature: Signature,
  ): Effect.Effect<ProvingRecipe.ProvingRecipe<FinalizedTransaction>, WalletError.WalletError> {
    return this.#v1Context.transactingCapability
      .addDustGenerationSignature(transaction, signature)
      .pipe(EitherOps.toEffect);
  }

  calculateFee(transaction: AnyTransaction): Effect.Effect<bigint, WalletError.WalletError> {
    return pipe(
      this.#v1Context.syncService.blockData(),
      Effect.map((blockData) =>
        this.#v1Context.transactingCapability.calculateFee(transaction, blockData.ledgerParameters),
      ),
    );
  }

  addFeePayment(
    secretKey: DustSecretKey,
    transaction: UnprovenTransaction,
    ttl: Date,
    currentTime?: Date,
  ): Effect.Effect<ProvingRecipe.ProvingRecipe<FinalizedTransaction>, WalletError.WalletError> {
    return SubscriptionRef.modifyEffect(this.#context.stateRef, (state) => {
      return pipe(
        this.#v1Context.syncService.blockData(),
        Effect.flatMap((blockData) =>
          this.#v1Context.transactingCapability.addFeePayment(
            secretKey,
            state,
            transaction,
            ttl,
            currentTime ?? blockData.timestamp,
            blockData.ledgerParameters,
          ),
        ),
        Effect.map(({ recipe, newState }) => [recipe, newState] as const),
      );
    });
  }

  finalizeTransaction(
    recipe: ProvingRecipe.ProvingRecipe<TTransaction>,
  ): Effect.Effect<TTransaction, WalletError.WalletError> {
    return this.#v1Context.provingService
      .prove(recipe)
      .pipe(
        Effect.tapError(() =>
          SubscriptionRef.updateEffect(this.#context.stateRef, (state) =>
            EitherOps.toEffect(this.#v1Context.transactingCapability.revertRecipe(state, recipe)),
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
            EitherOps.toEffect(this.#v1Context.transactingCapability.revert(state, transaction)),
          ),
        ),
      );
  }) as SubmitTransactionMethod<TTransaction>;
}
