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
import type * as ledger from '@midnightntwrk/ledger-v9';
import {
  type Option,
  Effect,
  pipe,
  type Record,
  Scope,
  Stream,
  SubscriptionRef,
  Schedule,
  Duration,
  Sink,
  Console,
} from 'effect';
import { ProtocolVersion, VariantState } from '@midnightntwrk/wallet-sdk-abstractions';
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
import {
  type BlocklessFinalizedEntryError,
  OtherWalletError,
  TransactionHistoryError,
  type WalletError,
} from './WalletError.js';
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

export declare namespace RunningV2Variant {
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

/**
 * How often a change's history entry is attempted again after an attempt gave up: its lookup outlasted
 * `getTransactionDetails`' own retry window, or the write failed. The state has already moved past the change, so this
 * is the only path by which its entry still reaches the history; it keeps going for as long as the variant runs. Each
 * attempt takes a lookup permit only while it runs, so a change the indexer cannot answer for yet never holds one while
 * it waits.
 */
const recordRetrySchedule = Schedule.spaced(Duration.minutes(1)).pipe(Schedule.jittered);

export const V2Tag: unique symbol = Symbol('V2');

/**
 * This variant's core state, when this variant produced the wallet state it is read from.
 *
 * @remarks
 *   A shielded wallet's state carries its core state sealed, because that state is made of one ledger version's objects.
 *   This is how the variant — or a test or tool that needs its ledger-level detail — reads it back. A state another
 *   variant produced gives nothing, since this variant's ledger version could not read it.
 * @example
 *   ```typescript
 *   import { coreStateOf } from '@midnightntwrk/wallet-sdk-shielded/v2';
 *
 *   const state = await shieldedWallet.waitForSyncedState();
 *   // Some once the V2 variant runs; none while the wallet is still on the V1 variant.
 *   const core = coreStateOf(state);
 *   ```;
 *
 * @param walletState A state, as a shielded wallet emits it.
 * @returns This variant's core state, or nothing when another variant produced the state.
 */
export const coreStateOf = (walletState: Readonly<{ state: VariantState }>): Option.Option<CoreWallet> =>
  VariantState.unwrapFor<CoreWallet>(walletState.state, V2Tag);

export type DefaultRunningV2 = RunningV2Variant<
  string,
  EventsSyncUpdate,
  ledger.FinalizedTransaction,
  ledger.ZswapSecretKeys
>;

export class RunningV2Variant<TSerialized, TSyncUpdate, TTransaction, TStartAux> implements Variant.RunningVariant<
  typeof V2Tag,
  CoreWallet
> {
  readonly __polyTag__: typeof V2Tag = V2Tag;
  readonly #scope: Scope.Scope;
  readonly #context: Variant.VariantContext<CoreWallet>;
  readonly #v2Context: RunningV2Variant.Context<TSerialized, TSyncUpdate, TTransaction, TStartAux>;
  // This variant's cap on concurrent tx-history writes. Each sync batch forks its own fan-out fiber, so a per-batch
  // `concurrency` limit alone would let in-flight indexer queries grow with the number of live batches while their
  // lookups retry through the indexer-lag window. Every write acquires a permit here, making the cap span every batch
  // of this variant. Each variant has its own, so while the writes a hand-over carries are still finishing, the wallet
  // briefly runs up to twice as many.
  readonly #txHistoryPermits = Effect.makeSemaphore(8).pipe(Effect.runSync);

  readonly state: Stream.Stream<StateChange.StateChange<CoreWallet>, WalletRuntimeError>;

  constructor(
    scope: Scope.Scope,
    context: Variant.VariantContext<CoreWallet>,
    v2Context: RunningV2Variant.Context<TSerialized, TSyncUpdate, TTransaction, TStartAux>,
  ) {
    this.#scope = scope;
    this.#context = context;
    this.#v2Context = v2Context;
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
      // Entries a previous run stored but never completed (the wallet stopped, or was restored from a snapshot taken
      // mid-lookup) are completed first. Forked once, outside the retried sync below, so a sync retry never repeats it.
      Stream.fromEffect(Effect.forkIn(this.#completePendingDetails(), this.#scope)),
      Stream.drain,
      Stream.concat(this.#syncUpdates(startAux)),
    );
  }

  #syncUpdates(startAux: TStartAux): Stream.Stream<void, WalletError, Scope.Scope> {
    const historyScope = this.#context.runtimeScope ?? this.#scope;

    return pipe(
      SubscriptionRef.get(this.#context.stateRef),
      Stream.fromEffect,
      Stream.flatMap((state) => this.#v2Context.syncService.updates(state, startAux)),
      Stream.mapEffect((update) =>
        // Applying an update and registering the fiber that records its changes happen as one step: a stop between the
        // two would leave applied changes that nothing records and nothing logs. The recording itself stays
        // interruptible.
        Effect.uninterruptibleMask((restore) =>
          SubscriptionRef.modifyEffect(this.#context.stateRef, (state) =>
            Effect.try({
              try: () => {
                const [newState, changesResult] = this.#v2Context.syncCapability.applyUpdate(
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
            }).pipe(
              // Each change's entry is stored before the state that moves past it is committed, so a snapshot taken at
              // any moment is never ahead of its history. A failed write fails the update: the state stays where it was
              // and the sync retries, rather than move past a change the history does not hold.
              Effect.tap(([changesResult]) => this.#recordApplied(changesResult)),
            ),
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
                        this.#recordWithRetries(
                          change.source,
                          pipe(
                            this.#v2Context.transactionHistoryService.getTransactionDetails(change.source),
                            Effect.flatMap((metadata) =>
                              this.#v2Context.transactionHistoryService.put(change, metadata, protocolVersion),
                            ),
                          ),
                        ),
                      // `concurrency` only bounds fiber creation within this one batch; the cap on simultaneous writes
                      // across batches is the variant's semaphore acquired around each write.
                      { discard: true, concurrency: 8 },
                    ),
                    restore,
                    // Into the runtime's scope, not this variant's: these changes are applied, so nothing will record
                    // them again, and the update that hands over to the next variant closes this variant's scope while
                    // its own writes are still running. Stopping the wallet interrupts them rather than waiting: a
                    // write it interrupts is logged and not recorded.
                    Effect.forkIn(historyScope),
                  ),
            ),
          ),
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

  /** Stores every change of an applied update as an incomplete entry, when the history service can. */
  #recordApplied({ changes, protocolVersion }: ChangesResult): Effect.Effect<void, WalletError> {
    const service = this.#v2Context.transactionHistoryService;
    return service.recordApplied === undefined || changes.length === 0
      ? Effect.void
      : Effect.forEach(changes, (change) => service.recordApplied?.(change, protocolVersion) ?? Effect.void, {
          discard: true,
        }).pipe(
          Effect.mapError(
            (cause) => new OtherWalletError({ message: 'Error while recording applied changes in the history', cause }),
          ),
        );
  }

  /** Looks up and fills in every entry the history still marks `shieldedDetailsPending`. */
  #completePendingDetails(): Effect.Effect<void> {
    const service = this.#v2Context.transactionHistoryService;
    return service.pendingDetails === undefined || service.completeDetails === undefined
      ? Effect.void
      : pipe(
          service.pendingDetails(),
          Effect.retry({ schedule: recordRetrySchedule }),
          Effect.flatMap((hashes) =>
            Effect.forEach(
              hashes,
              (hash) =>
                this.#recordWithRetries(
                  hash,
                  pipe(
                    service.getTransactionDetails(hash),
                    Effect.flatMap((metadata) => service.completeDetails?.(hash, metadata) ?? Effect.void),
                  ),
                ),
              { discard: true, concurrency: 8 },
            ),
          ),
          Effect.catchAllCause((cause) => Effect.logError(cause, 'Failed to read pending shielded tx-history entries')),
        );
  }

  /**
   * Runs one history write for `hash` under a lookup permit until it succeeds. The state has already moved past the
   * change, so it will not be re-processed: an attempt that gives up (an indexer outage longer than
   * getTransactionDetails' retry window) is tried again, rather than losing the shielded section.
   */
  #recordWithRetries(
    hash: string,
    attempt: Effect.Effect<void, TransactionHistoryError | BlocklessFinalizedEntryError>,
  ): Effect.Effect<void> {
    return pipe(
      this.#txHistoryPermits.withPermits(1)(attempt),
      Effect.tapError((error) =>
        Effect.logWarning(error, `Failed to record shielded tx-history section for ${hash}; trying again`),
      ),
      Effect.retry({
        schedule: recordRetrySchedule,
        while: (error) => error instanceof TransactionHistoryError,
      }),
      Effect.onInterrupt(() =>
        Effect.logWarning(`Shielded tx-history section for ${hash} not recorded: wallet stopped`),
      ),
      Effect.catchAllCause((cause) =>
        // Only a failure that waiting cannot fix lands here. Surface it as a structured error carrying the tx hash, not
        // a silent Console.error defect.
        Effect.logError(cause, `Failed to record shielded tx-history section for ${hash}`),
      ),
    );
  }

  balanceTransaction(
    secretKeys: ledger.ZswapSecretKeys,
    tx: ledger.Transaction<ledger.Signaturish, ledger.Proofish, ledger.Bindingish>,
    ttl?: Date,
  ): Effect.Effect<BalancingResult, WalletError> {
    return SubscriptionRef.modifyEffect(this.#context.stateRef, (state) => {
      return pipe(
        this.#v2Context.transactingCapability.balanceTransaction(secretKeys, state, tx, ttl),
        EitherOps.toEffect,
      );
    });
  }

  transferTransaction(
    secretKeys: ledger.ZswapSecretKeys,
    outputs: ReadonlyArray<TokenTransfer>,
    ttl?: Date,
  ): Effect.Effect<ledger.UnprovenTransaction, WalletError> {
    return SubscriptionRef.modifyEffect(this.#context.stateRef, (state) => {
      return pipe(
        this.#v2Context.transactingCapability.makeTransfer(secretKeys, state, outputs, ttl),
        EitherOps.toEffect,
      );
    });
  }

  initSwap(
    secretKeys: ledger.ZswapSecretKeys,
    desiredInputs: Record<ledger.RawTokenType, bigint>,
    desiredOutputs: ReadonlyArray<TokenTransfer>,
    ttl?: Date,
  ): Effect.Effect<ledger.UnprovenTransaction, WalletError> {
    return SubscriptionRef.modifyEffect(this.#context.stateRef, (state) => {
      return pipe(
        this.#v2Context.transactingCapability.initSwap(secretKeys, state, desiredInputs, desiredOutputs, ttl),
        EitherOps.toEffect,
      );
    });
  }

  revertTransaction(
    transaction: ledger.Transaction<ledger.Signaturish, ledger.Proofish, ledger.Bindingish>,
  ): Effect.Effect<void, WalletError> {
    return SubscriptionRef.updateEffect(this.#context.stateRef, (state) => {
      return pipe(this.#v2Context.transactingCapability.revertTransaction(state, transaction), EitherOps.toEffect);
    });
  }

  revertFailedSegments(
    transaction: ledger.Transaction<ledger.Signaturish, ledger.Proofish, ledger.Bindingish>,
    failedSegments: ReadonlyArray<number>,
  ): Effect.Effect<void, WalletError> {
    return SubscriptionRef.updateEffect(this.#context.stateRef, (state) => {
      return pipe(
        this.#v2Context.transactingCapability.revertFailedSegments(state, transaction, failedSegments),
        EitherOps.toEffect,
      );
    });
  }

  serializeState(state: CoreWallet): TSerialized {
    return this.#v2Context.serializationCapability.serialize(state);
  }
}
