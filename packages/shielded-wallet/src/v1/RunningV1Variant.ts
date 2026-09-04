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
import type * as ledger from '@midnight-ntwrk/ledger-v8';
import { Effect, pipe, type Record, Scope, Stream, SubscriptionRef, Schedule, Duration, Sink, Console } from 'effect';
import { ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import {
  type WalletRuntimeError,
  type Variant,
  StateChange,
  VersionChangeType,
} from '@midnightntwrk/wallet-sdk-runtime/abstractions';
import { EitherOps } from '@midnightntwrk/wallet-sdk-utilities';
import { type SerializationCapability } from './Serialization.js';
import { type ChangesResult, type EventsSyncUpdate, type SyncCapability, type SyncService } from './Sync.js';
import { type TransactingCapability, type TokenTransfer, type BalancingResult } from './Transacting.js';
import { OtherWalletError, type WalletError } from './WalletError.js';
import { type CoinsAndBalancesCapability } from './CoinsAndBalances.js';
import { type KeysCapability } from './Keys.js';
import { type CoinSelection } from '@midnightntwrk/wallet-sdk-capabilities';
import { type CoreWallet } from './CoreWallet.js';
import { type TransactionHistoryService } from './TransactionHistory.js';

const progress = (state: CoreWallet): StateChange.StateChange<CoreWallet>[] => {
  const appliedIndex = state.progress?.appliedIndex ?? 0n;
  const highestRelevantWalletIndex = state.progress?.highestRelevantWalletIndex ?? 0n;
  const highestIndex = state.progress?.highestIndex ?? 0n;
  const highestRelevantIndex = state.progress?.highestRelevantIndex ?? 0n;

  const sourceGap = highestIndex - highestRelevantIndex;
  const applyGap = highestRelevantWalletIndex - appliedIndex;

  return [StateChange.ProgressUpdate({ sourceGap, applyGap })];
};

/**
 * Reports the protocol version a state observation implies, if any.
 *
 * @remarks
 *   Two situations call for a signal. The ordinary one is a transition: sync annotated the state with a version it did
 *   not have before, and the runtime decides whether that is a re-annotation inside this variant's range or a hand-over
 *   to the next one.
 *
 *   The other is a state that arrives already outside this variant's range — a snapshot serialized in the window between
 *   the annotation and the migration it should have caused, or one written by an older protocol version entirely.
 *   Nothing further will change that value, so waiting for a transition would strand the wallet on a version it does
 *   not own. Emitting on sight heals it.
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
  export type Context<TSerialized, TSyncUpdate, TTransaction, TStartAux> = {
    serializationCapability: SerializationCapability<CoreWallet, null, TSerialized>;
    syncService: SyncService<CoreWallet, TStartAux, TSyncUpdate>;
    syncCapability: SyncCapability<CoreWallet, TSyncUpdate, ChangesResult>;
    transactingCapability: TransactingCapability<ledger.ZswapSecretKeys, CoreWallet, TTransaction>;
    coinsAndBalancesCapability: CoinsAndBalancesCapability<CoreWallet>;
    keysCapability: KeysCapability<CoreWallet>;
    coinSelection: CoinSelection<ledger.QualifiedShieldedCoinInfo>;
    transactionHistoryService: TransactionHistoryService;
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
  // Variant-wide cap on concurrent tx-history lookups. Each sync batch forks its own fan-out fiber, so a per-batch
  // `concurrency` limit alone would let in-flight indexer queries grow with the number of live batches while their
  // lookups retry through the indexer-lag window. Every lookup acquires a permit here, making the cap global.
  readonly #txHistoryPermits = Effect.makeSemaphore(8).pipe(Effect.runSync);

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
          // The accumulator carries the "have we seen anything yet" flag alongside the previous state: the first
          // observation is the only one that can be a restored state nobody has inspected against this variant's
          // range yet, and `SubscriptionRef.changes` replays the current value, so it is exactly this element.
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
              const [newState, changesResult] = this.#v1Context.syncCapability.applyUpdate(
                state,
                update,
                this.#context.activationRange,
              );
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
            // Skip the tx-history fork entirely when there are no changes.
            // Forking unconditionally allocates a fiber per apply call (one
            // for every batch the sync emits, even the all-progress ones),
            // which adds up fast during catch-up.
            changes.length === 0
              ? Effect.void
              : pipe(
                  Effect.forEach(
                    changes,
                    (change) =>
                      pipe(
                        this.#txHistoryPermits.withPermits(1)(
                          pipe(
                            this.#v1Context.transactionHistoryService.getTransactionDetails(change.source),
                            Effect.flatMap((metadata) =>
                              this.#v1Context.transactionHistoryService.put(change, metadata, protocolVersion),
                            ),
                          ),
                        ),
                        Effect.catchAllCause((cause) =>
                          // A sustained indexer outage (longer than getTransactionDetails' retry window) still lands
                          // here. applyUpdate has already advanced appliedIndex, so this change.source won't be
                          // re-processed — the shielded section is permanently lost. Surface that as a structured
                          // error carrying the tx hash, not a silent Console.error defect.
                          Effect.logError(cause, `Failed to record shielded tx-history section for ${change.source}`),
                        ),
                      ),
                    // `concurrency` only bounds fiber creation within this one batch; the real cap on simultaneous
                    // indexer queries is the variant-wide semaphore acquired around each lookup above.
                    { discard: true, concurrency: 8 },
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

  revertTransaction(
    transaction: ledger.Transaction<ledger.Signaturish, ledger.Proofish, ledger.Bindingish>,
  ): Effect.Effect<void, WalletError> {
    return SubscriptionRef.updateEffect(this.#context.stateRef, (state) => {
      return pipe(this.#v1Context.transactingCapability.revertTransaction(state, transaction), EitherOps.toEffect);
    });
  }

  serializeState(state: CoreWallet): TSerialized {
    return this.#v1Context.serializationCapability.serialize(state);
  }
}
