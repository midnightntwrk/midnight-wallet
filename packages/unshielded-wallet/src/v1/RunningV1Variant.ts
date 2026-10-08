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
import { Effect, pipe, type Record, Scope, Stream, SubscriptionRef, Sink, Console } from 'effect';
import { ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import {
  type WalletRuntimeError,
  type Variant,
  StateChange,
  VersionChangeType,
} from '@midnightntwrk/wallet-sdk-runtime/abstractions';
import { EitherOps } from '@midnightntwrk/wallet-sdk-utilities';
import { type SerializationCapability } from './Serialization.js';
import { type SyncCapability, type SyncService } from './Sync.js';
import { type SyncUpdate } from './SyncSchema.js';
import { retrySchedule } from './RetrySchedule.js';
import {
  type TransactingCapability,
  type TokenTransfer,
  type FinalizedTransactionBalanceResult,
  type UnboundTransactionBalanceResult,
  type UnprovenTransactionBalanceResult,
} from './Transacting.js';
import { type UtxoHash, type UtxoWithMeta } from './UnshieldedState.js';
import { type UnboundTransaction } from './TransactionOps.js';
import { type SignSegment, type SigningService } from './Signing.js';
import { SyncWalletError, type WalletError } from './WalletError.js';
import { type CoinsAndBalancesCapability } from './CoinsAndBalances.js';
import { type KeysCapability } from './Keys.js';
import { type CoinSelection } from '@midnightntwrk/wallet-sdk-capabilities';
import { CoreWallet } from './CoreWallet.js';
import { type TransactionHistoryService } from './TransactionHistory.js';
import type * as ledger from '@midnight-ntwrk/ledger-v8';

const progress = (state: CoreWallet): StateChange.StateChange<CoreWallet>[] => {
  const appliedId = state.progress?.appliedId ?? 0n;
  const highestTransactionId = state.progress?.highestTransactionId ?? 0n;

  const sourceGap = highestTransactionId - appliedId;
  const applyGap = appliedId - appliedId;

  return [StateChange.ProgressUpdate({ sourceGap, applyGap })];
};

/**
 * The version signals this variant puts on its state stream.
 *
 * @remarks
 *   Two of them, for two different situations. A transition is the ordinary one: the state moved to a version the variant
 *   may or may not own, and the runtime decides. The healing emission covers restore: a snapshot taken between the
 *   moment sync annotated an out-of-range version and the moment the runtime acted on it comes back with a version this
 *   variant does not own and no transition to announce it, so it would sit there forever. Announcing it on the first
 *   observation is what forward-migrates such a snapshot.
 */
const protocolVersionChange = (
  previous: CoreWallet,
  current: CoreWallet,
  isInitial: boolean,
  activationRange: ProtocolVersion.ProtocolVersion.Range,
): StateChange.StateChange<CoreWallet>[] => {
  const transitioned = previous.protocolVersion != current.protocolVersion;
  const strandedOutsideRange = isInitial && !ProtocolVersion.withinRange(current.protocolVersion, activationRange);

  return transitioned || strandedOutsideRange
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
    signingService: SigningService;
    coinsAndBalancesCapability: CoinsAndBalancesCapability<CoreWallet>;
    keysCapability: KeysCapability<CoreWallet>;
    coinSelection: CoinSelection<ledger.Utxo>;
    transactionHistoryService: TransactionHistoryService;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type AnyContext = Context<any, any>;
}

export const V1Tag: unique symbol = Symbol('V1');

// `SyncUpdate`, matching `DefaultV1Variant` and `UnshieldedWallet`: the default sync stream carries liveness verdicts
// alongside the indexer's own updates, so an alias still naming `WalletSyncUpdate` would describe no wallet the
// default builder can produce.
export type DefaultRunningV1 = RunningV1Variant<string, SyncUpdate>;

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
          // The accumulator carries a "have we seen anything yet" flag alongside the previous state: the first
          // observation is the only one that can be a restored state nobody has checked against this variant's range
          // yet, and `SubscriptionRef.changes` replays the current value, so it is exactly this element.
          Stream.mapAccum(
            { previous: initialState, isInitial: true },
            (seen, current: CoreWallet) =>
              [{ previous: current, isInitial: false }, [seen.previous, current, seen.isInitial] as const] as const,
          ),
        ),
      ),
      Stream.mapConcat(
        ([previous, current, isInitial]: readonly [
          CoreWallet,
          CoreWallet,
          boolean,
        ]): StateChange.StateChange<CoreWallet>[] => {
          // TODO: emit progress only upon actual change
          return [
            StateChange.State({ state: current }),
            ...progress(current),
            ...protocolVersionChange(previous, current, isInitial, context.activationRange),
          ];
        },
      ),
    );
  }

  startSyncInBackground(): Effect.Effect<void> {
    return Effect.zipRight(
      this.#startLivenessInBackground(),
      this.startSync().pipe(Stream.runScoped(Sink.drain), Effect.forkScoped),
    ).pipe(Effect.asVoid, Effect.provideService(Scope.Scope, this.#scope));
  }

  /**
   * Forks the sync service's liveness feed for the lifetime of the wallet.
   *
   * @remarks
   *   Deliberately outside {@link RunningV1Variant.startSync} and its retry: rebuilding the feed on every indexer-stream
   *   retry reconnected its node client each time and silenced verdicts during exactly the windows — indexer outages —
   *   the liveness check exists for. The feed is built once, from the state the wallet holds at start, and lives until
   *   the wallet's scope closes. It still retries on its own failures, which its verdict streams are built never to
   *   produce — a failure here is a bug, and backing off beats silently losing the check.
   *
   *   Every service has a feed, so there is no absence to interpret here. A source that runs no check reports
   *   `IndexerLiveness.Skipped` through its own feed, which is a statement this fibre applies like any other verdict
   *   rather than a missing field this class has to translate.
   */
  #startLivenessInBackground(): Effect.Effect<void, never, Scope.Scope> {
    return pipe(
      SubscriptionRef.get(this.#context.stateRef),
      Stream.fromEffect,
      Stream.flatMap((state) => this.#v1Context.syncService.livenessUpdates(state)),
      Stream.mapEffect((update) => this.#applyUpdate(update)),
      Stream.tapError((error) => Console.error(error)),
      Stream.retry(retrySchedule()),
      Stream.runScoped(Sink.drain),
      Effect.forkScoped,
      Effect.asVoid,
    );
  }

  /** Folds one update into the wallet state through the sync capability. */
  #applyUpdate(update: TSyncUpdate): Effect.Effect<void, WalletError> {
    return SubscriptionRef.updateEffect(this.#context.stateRef, (state) =>
      pipe(
        this.#v1Context.syncCapability.applyUpdate(state, update, this.#context.activationRange),
        EitherOps.toEffect,
      ),
    );
  }

  startSync(): Stream.Stream<void, WalletError, Scope.Scope> {
    return pipe(
      SubscriptionRef.get(this.#context.stateRef),
      Stream.fromEffect,
      Stream.flatMap((state) => this.#v1Context.syncService.updates(state)),
      // A live wallet's update source has no legitimate end — the indexer subscription and the simulator's state feed
      // are both open-ended — so a stream that completes has been dropped as surely as one that failed. The indexer
      // does exactly this: a graphql-ws `complete` ends the stream cleanly. Left as an end, the sync fibre simply
      // finished: no retry, no flag reset, and no further transaction could ever reach the wallet. Failing here puts
      // an end through the same path as a failure — the log, the flag, the backoff.
      Stream.concat(Stream.fail(new SyncWalletError({ message: 'Sync subscription ended' }))),
      Stream.mapEffect((update) => this.#applyUpdate(update)),
      Stream.tapError((error) => Console.error(error)),
      // The flag is written true on every progress update and nowhere else goes false, so without this it latches: a
      // wallet whose subscription just died would sit through the retry backoff — or an entire indexer outage — still
      // holding isConnected: true, a caught-up cursor, and its last liveness verdict, and so still reporting itself
      // synchronized. The liveness check cannot catch that case: the indexer itself may be healthy while this wallet's
      // subscription is dead. The connection flag is the one truthful signal, and the stream failing is the one place
      // that knows it.
      Stream.tapError(() =>
        SubscriptionRef.update(this.#context.stateRef, (state) =>
          CoreWallet.updateProgress(state, { isConnected: false }),
        ),
      ),
      Stream.retry(retrySchedule()),
    );
  }

  balanceFinalizedTransaction(
    tx: ledger.FinalizedTransaction,
  ): Effect.Effect<FinalizedTransactionBalanceResult, WalletError> {
    return SubscriptionRef.modifyEffect(this.#context.stateRef, (state) => {
      return pipe(this.#v1Context.transactingCapability.balanceFinalizedTransaction(state, tx), EitherOps.toEffect);
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

  rotateUtxos(
    guaranteedUtxos: ReadonlyArray<UtxoWithMeta>,
    fallibleUtxos: ReadonlyArray<UtxoWithMeta>,
    nightVerifyingKey: ledger.SignatureVerifyingKey,
    ttl: Date,
  ): Effect.Effect<ledger.UnprovenTransaction, WalletError> {
    return SubscriptionRef.modifyEffect(this.#context.stateRef, (state) => {
      return pipe(
        this.#v1Context.transactingCapability.rotateUtxos(
          state,
          guaranteedUtxos,
          fallibleUtxos,
          nightVerifyingKey,
          ttl,
        ),
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

  signUnprovenTransaction(
    transaction: ledger.UnprovenTransaction,
    signSegment: SignSegment,
  ): Effect.Effect<ledger.UnprovenTransaction, WalletError> {
    return this.#v1Context.signingService.sign(transaction, signSegment);
  }

  signUnboundTransaction(
    transaction: UnboundTransaction,
    signSegment: SignSegment,
  ): Effect.Effect<UnboundTransaction, WalletError> {
    return this.#v1Context.signingService.sign(transaction, signSegment);
  }

  revertTransaction(
    transaction: ledger.Transaction<ledger.SignatureEnabled, ledger.Proofish, ledger.Bindingish>,
  ): Effect.Effect<void, WalletError> {
    return SubscriptionRef.updateEffect(this.#context.stateRef, (state) => {
      return pipe(this.#v1Context.transactingCapability.revertTransaction(state, transaction), EitherOps.toEffect);
    });
  }

  revertUtxos(utxoIds: ReadonlyArray<UtxoHash>): Effect.Effect<void, WalletError> {
    return SubscriptionRef.update(this.#context.stateRef, (state) =>
      this.#v1Context.transactingCapability.revertUtxos(state, utxoIds),
    );
  }

  releaseRestoredPending(coveredIds: ReadonlyArray<UtxoHash>): Effect.Effect<void, WalletError> {
    return SubscriptionRef.update(this.#context.stateRef, (state) =>
      this.#v1Context.transactingCapability.releaseRestoredPending(state, coveredIds),
    );
  }

  serializeState(state: CoreWallet): TSerialized {
    return this.#v1Context.serializationCapability.serialize(state);
  }
}
