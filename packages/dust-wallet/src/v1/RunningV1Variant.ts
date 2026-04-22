// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) Midnight Foundation
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
import { Effect, SubscriptionRef, Stream, pipe, Scope, Sink, Console, Duration, Schedule, Array as Arr } from 'effect';
import { type TransactionHistoryService } from './TransactionHistory.js';
import {
  type DustSecretKey,
  nativeToken,
  type Signature,
  type SignatureVerifyingKey,
  type FinalizedTransaction,
  type UnprovenTransaction,
} from '@midnight-ntwrk/ledger-v8';
import { ProtocolVersion } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { OtherWalletError, type WalletError } from './WalletError.js';
import { ArrayOps, EitherOps } from '@midnight-ntwrk/wallet-sdk-utilities';
import {
  type WalletRuntimeError,
  type Variant,
  StateChange,
  VersionChangeType,
} from '@midnight-ntwrk/wallet-sdk-runtime/abstractions';
import { type Dust, type UtxoWithMeta } from './types/Dust.js';
import { type KeysCapability } from './Keys.js';
import { type ChangesResult, type SyncCapability, type SyncService } from './Sync.js';
import { type SimulatorState } from '@midnight-ntwrk/wallet-sdk-capabilities/simulation';
import {
  type CoinsAndBalancesCapability,
  type CoinSelection,
  type UtxoWithFullDustDetails,
} from './CoinsAndBalances.js';
import { type TransactingCapability } from './Transacting.js';
import { type CoreWallet } from './CoreWallet.js';
import { type SerializationCapability } from './Serialization.js';
import { type AnyTransaction } from './types/ledger.js';
import { type DustAddress } from '@midnight-ntwrk/wallet-sdk-address-format';

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
    syncCapability: SyncCapability<CoreWallet, TSyncUpdate, ChangesResult>;
    transactingCapability: TransactingCapability<DustSecretKey, CoreWallet, TTransaction>;
    coinsAndBalancesCapability: CoinsAndBalancesCapability<CoreWallet>;
    keysCapability: KeysCapability<CoreWallet>;
    coinSelection: CoinSelection<Dust>;
    transactionHistoryService: TransactionHistoryService;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type AnyContext = Context<any, any, any, any>;
}

export const V1Tag: unique symbol = Symbol('V1');

export type DefaultRunningV1 = RunningV1Variant<string, SimulatorState, FinalizedTransaction, DustSecretKey>;

export class RunningV1Variant<TSerialized, TSyncUpdate, TTransaction, TStartAux> implements Variant.RunningVariant<
  typeof V1Tag,
  CoreWallet
> {
  __polyTag__: typeof V1Tag = V1Tag;
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
      Stream.mapEffect((update) =>
        SubscriptionRef.modifyEffect(this.#context.stateRef, (state) =>
          Effect.try({
            try: () => {
              const [newState, changesResult] = this.#v1Context.syncCapability.applyUpdate(state, update);
              return [changesResult, newState] as const;
            },
            catch: (err) =>
              new OtherWalletError({
                message: 'Error while applying sync update',
                cause: err,
              }),
          }),
        ).pipe(
          Effect.flatMap(({ changes, protocolVersion }) =>
            pipe(
              Effect.forEach(
                changes,
                (change) =>
                  pipe(
                    this.#v1Context.transactionHistoryService.getTransactionDetails(change.source),
                    Effect.flatMap((metadata) =>
                      this.#v1Context.transactionHistoryService.put(change, metadata, protocolVersion),
                    ),
                    Effect.catchAllCause((cause) => Console.error('Error processing tx history metadata', cause)),
                  ),
                { discard: true, concurrency: 'unbounded' },
              ),
              Effect.forkScoped,
            ),
          ),
          Effect.provideService(Scope.Scope, this.#scope),
        ),
      ),
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
    dustReceiverAddress: DustAddress | undefined,
  ): Effect.Effect<UnprovenTransaction, WalletError> {
    if (nightUtxos.some((utxo) => utxo.type !== nativeToken().raw)) {
      return Effect.fail(new OtherWalletError({ message: 'Token of a non-Night type received' }));
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
  ): Effect.Effect<UnprovenTransaction, WalletError> {
    return this.#v1Context.transactingCapability
      .addDustGenerationSignature(transaction, signature)
      .pipe(EitherOps.toEffect);
  }

  calculateFee(transactions: ReadonlyArray<AnyTransaction>): Effect.Effect<bigint, WalletError> {
    return pipe(
      this.#v1Context.syncService.blockData(),
      Effect.map((blockData) =>
        pipe(
          transactions,
          Arr.map((transaction) =>
            this.#v1Context.transactingCapability.calculateFee(transaction, blockData.ledgerParameters),
          ),
          ArrayOps.sumBigInt,
        ),
      ),
    );
  }

  estimateFee(
    secretKey: DustSecretKey,
    transactions: ReadonlyArray<AnyTransaction>,
    ttl: Date,
    currentTime?: Date,
  ): Effect.Effect<bigint, WalletError> {
    return pipe(
      Effect.all([SubscriptionRef.get(this.#context.stateRef), this.#v1Context.syncService.blockData()]),
      Effect.flatMap(([state, blockData]) =>
        pipe(
          this.#v1Context.transactingCapability.estimateFee(
            secretKey,
            state,
            transactions,
            ttl,
            currentTime ?? blockData.timestamp,
            blockData.ledgerParameters,
          ),
          EitherOps.toEffect,
        ),
      ),
    );
  }

  balanceTransactions(
    secretKey: DustSecretKey,
    transactions: ReadonlyArray<AnyTransaction>,
    ttl: Date,
    currentTime?: Date,
  ): Effect.Effect<UnprovenTransaction, WalletError> {
    return SubscriptionRef.modifyEffect(this.#context.stateRef, (state) => {
      return pipe(
        this.#v1Context.syncService.blockData(),
        Effect.flatMap((blockData) =>
          this.#v1Context.transactingCapability.balanceTransactions(
            secretKey,
            state,
            transactions,
            ttl,
            currentTime ?? blockData.timestamp,
            blockData.ledgerParameters,
          ),
        ),
      );
    });
  }

  revertTransaction(transaction: AnyTransaction): Effect.Effect<void, WalletError> {
    return SubscriptionRef.updateEffect(this.#context.stateRef, (state) => {
      return pipe(this.#v1Context.transactingCapability.revertTransaction(state, transaction), EitherOps.toEffect);
    });
  }
}
