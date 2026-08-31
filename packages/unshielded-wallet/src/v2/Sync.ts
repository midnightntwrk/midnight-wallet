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
import {
  Duration,
  Effect,
  type Scope,
  Stream,
  Schema,
  Schedule,
  identity,
  Option,
  pipe,
  Either,
  HashMap,
} from 'effect';
import { ProtocolVersion, Token } from '@midnightntwrk/wallet-sdk-abstractions';
import { CoreWallet } from './CoreWallet.js';
import { UtxoWithMeta } from './UnshieldedState.js';
import {
  type Simulator,
  type SimulatorState,
  getCurrentBlockNumber,
} from '@midnightntwrk/wallet-sdk-capabilities/simulation';
import { BlockHash, UnshieldedTransactionTip, UnshieldedTransactions } from '@midnightntwrk/wallet-sdk-indexer-client';
import {
  WsSubscriptionClient,
  HttpQueryClient,
  ConnectionHelper,
} from '@midnightntwrk/wallet-sdk-indexer-client/effect';
import { SyncWalletError, type WalletError } from './WalletError.js';
import { WsURL } from '@midnightntwrk/wallet-sdk-utilities/networking';
import { type TransactionHistoryService } from './TransactionHistory.js';
import { EitherOps } from '@midnightntwrk/wallet-sdk-utilities';
import { VersionSignalSyncUpdate, type WalletSyncUpdate, WalletSyncUpdateSchema } from './SyncSchema.js';

export interface SyncService<TState, TUpdate> {
  updates: (state: TState) => Stream.Stream<TUpdate, WalletError, Scope.Scope>;
}

export interface SyncCapability<TState, TUpdate> {
  /**
   * Folds a single sync message into the wallet state.
   *
   * @param state The state to fold into.
   * @param update The message to apply.
   * @param activeRange The half-open protocol version range the running variant owns. A message the source reports at
   *   or beyond its end belongs to a later variant and must be left entirely unapplied, for that variant to fetch.
   */
  applyUpdate: (
    state: TState,
    update: TUpdate,
    activeRange: ProtocolVersion.ProtocolVersion.Range,
  ) => Either.Either<TState, WalletError>;
}

/**
 * Whether a reported protocol version belongs to a variant later than the one owning `activeRange`.
 *
 * @remarks
 *   Unshielded sync is message-at-a-time, so this is the whole of the boundary rule — there is no batch to split into an
 *   applied prefix and a deferred suffix, only a yes/no per message. Exported so the indexer and simulator sync
 *   capabilities cannot drift apart on the question.
 * @param version The protocol version the source reported for this message.
 * @param activeRange The running variant's half-open activation range.
 * @returns `true` when the message must be left unapplied.
 */
export const isBeyondActiveRange = (version: number, activeRange: ProtocolVersion.ProtocolVersion.Range): boolean =>
  BigInt(version) >= activeRange[1];

/**
 * Records an observed protocol version on the state, monotonically.
 *
 * @remarks
 *   This is the only thing written when a message is deferred at the boundary, and it is what the runtime watches to
 *   decide that the variant must hand over.
 * @param state The state to annotate.
 * @param version The protocol version the source reported.
 * @returns The state carrying the higher of the two versions.
 */
export const annotateVersion = (state: CoreWallet, version: number): CoreWallet =>
  CoreWallet.withProtocolVersion(state, ProtocolVersion.ProtocolVersion(BigInt(version)));

export type IndexerClientConnection = {
  indexerHttpUrl: string;
  indexerWsUrl?: string;
  keepAlive?: number;
};

/**
 * How often the sync source re-asks the chain which protocol version it is on.
 *
 * @remarks
 *   The subscription this source reads is scoped to one address, and its progress arm carries no version — it says how
 *   far this address's timeline goes and nothing else. A wallet therefore observes the chain's protocol version only
 *   through transactions that touch its own address, and on a chain that crosses a protocol boundary and then pays this
 *   address nothing it observes no version at all — it stays on the variant it was running, and everything built
 *   through it stays routed to that variant's ledger. Asking on a timer is what closes that, and the cost of asking is
 *   one small query per interval on a chain that has not moved.
 */
export type VersionWatchConfig = {
  /**
   * Milliseconds between checks. Zero or less turns the watcher off entirely, which is what a source driving a wallet
   * from something other than a live chain wants.
   *
   * @default 30000
   */
  readonly intervalMs?: number;
};

export type DefaultSyncConfiguration = {
  indexerClientConnection: IndexerClientConnection;
  versionWatch?: VersionWatchConfig;
};

export type DefaultSyncContext = {
  transactionHistoryService: TransactionHistoryService;
};

/** How often the chain is asked its version when the configuration does not say. */
const DEFAULT_VERSION_WATCH_INTERVAL_MS = 30_000;

/**
 * How long one address-tip probe is given to produce its single answer.
 *
 * @remarks
 *   Only a stall guard. The indexer's progress loop emits before its first sleep, so the answer arrives at once or the
 *   transport is broken; without a bound, a half-open socket would leave the poll loop parked on a tick that never
 *   completes and the wallet would stop asking altogether. A bound turns that into a skipped tick.
 */
const ADDRESS_TIP_PROBE_TIMEOUT = Duration.seconds(10);

/**
 * Asks the source how far this address's transaction timeline goes.
 *
 * @remarks
 *   Over the subscription rather than a query, because the schema has no query that answers it: nothing aggregates
 *   transactions per owner, and `Query.transactions` reaches one only by an offset the caller would have to know
 *   already. The subscription's progress arm is where the indexer states it, and it states it eagerly — the progress
 *   loop yields before its first sleep, on any address, reporting zero for one the chain has never mentioned.
 *
 *   The cursor is **one past** the wallet's own, unlike the sync stream's. The indexer's cursor is inclusive, so asking
 *   at the cursor itself re-delivers the already-applied boundary transaction; the two arms of the subscription are
 *   merged by readiness rather than ordered, so that frame could win the race indefinitely and every tick would read it
 *   as unapplied history. One past, the transaction arm is provably empty for a caught-up wallet, so the progress frame
 *   is the only thing that can arrive first.
 * @param config The sync configuration, for the keep-alive the source's subscriptions use.
 * @param url Where to subscribe.
 * @param address The wallet's own address; the timeline this asks about is nobody else's.
 * @param appliedId The last transaction id the wallet applied.
 * @returns The highest transaction id for this address, or nothing when the source answered with a transaction still
 *   waiting to be applied — or did not answer at all.
 */
const highestTransactionId = (
  config: DefaultSyncConfiguration,
  url: URL | string,
  address: string,
  appliedId: bigint,
): Effect.Effect<Option.Option<number>> =>
  pipe(
    UnshieldedTransactionTip.run({ address, transactionId: Number(appliedId + 1n) }),
    Stream.runHead,
    Effect.map(
      Option.flatMap((answer) =>
        answer.unshieldedTransactions.type === 'UnshieldedTransactionsProgress'
          ? Option.some(answer.unshieldedTransactions.highestTransactionId)
          : Option.none(),
      ),
    ),
    Effect.provide(WsSubscriptionClient.layer({ url, keepAlive: config.indexerClientConnection.keepAlive })),
    Effect.scoped,
    Effect.timeout(ADDRESS_TIP_PROBE_TIMEOUT),
    Effect.catchAll(() => Effect.succeedNone),
  );

/**
 * One check of the chain's protocol version, gated on the wallet being caught up on this address's transaction ids.
 *
 * @remarks
 *   The order of the two questions is load-bearing. The tip is read **first**: a tip reported at a version means the
 *   source has indexed through the block that carries it, so every transaction below it is already counted in the
 *   address tip read afterwards. Asked the other way round, a transaction indexed between the two answers could be one
 *   of the version that preceded the tip — unapplied, uncounted, and exactly what the gate exists to catch.
 *
 *   The one short-circuit is an answer rather than a shortcut: a tip at or below the version the wallet already held is a
 *   signal that could only be a no-op, so no probe is opened and nothing is emitted — which is what keeps a settled
 *   wallet from polling a subscription for the rest of its life.
 *
 *   Everything else is swallowed. A tick that fails says nothing about the chain, so it must neither reach the state nor
 *   take the sync stream down with it; the next tick is the retry, and costs nothing to wait for.
 * @param config The sync configuration, for the indexer to ask.
 * @param url Where to run the address-tip probe.
 * @param address The wallet's own address.
 * @param appliedId The last transaction id the wallet applied, for the probe's cursor.
 * @param knownVersion The version the wallet already held when this stream opened — a lower bound on what it holds now.
 * @returns The signal, or nothing when there is nothing to say or nobody said it.
 */
const readVersionSignal = (
  config: DefaultSyncConfiguration,
  url: URL | string,
  address: string,
  appliedId: bigint,
  knownVersion: ProtocolVersion.ProtocolVersion,
): Effect.Effect<Option.Option<VersionSignalSyncUpdate>> =>
  pipe(
    BlockHash.run({ offset: null }),
    Effect.provide(HttpQueryClient.layer({ url: config.indexerClientConnection.indexerHttpUrl })),
    Effect.scoped,
    Effect.flatMap((answer) =>
      Option.match(Option.fromNullable(answer.block), {
        onNone: () => Effect.succeedNone,
        onSome: (tip) =>
          BigInt(tip.protocolVersion) <= knownVersion
            ? Effect.succeedNone
            : pipe(
                highestTransactionId(config, url, address, appliedId),
                Effect.map(Option.map((highest) => VersionSignalSyncUpdate.create(tip.protocolVersion, highest))),
              ),
      }),
    ),
    Effect.catchAll(() => Effect.succeedNone),
  );

/**
 * The chain's version, re-asked on a timer for as long as sync runs.
 *
 * @remarks
 *   Deliberately silent about ticks that say nothing: a tick that finds the chain where the wallet left it, that finds
 *   history still waiting to be applied, or that cannot reach the chain at all, emits no element rather than an empty
 *   one, so nothing downstream has to know that polling is how the answer was arrived at.
 * @param config The sync configuration, carrying the interval.
 * @param url Where to run the address-tip probe.
 * @param address The wallet's own address.
 * @param appliedId The last transaction id the wallet applied, for the probe's cursor.
 * @param knownVersion The version the wallet held when this stream opened.
 * @returns The signals, or an empty stream when watching is turned off.
 */
const versionWatch = (
  config: DefaultSyncConfiguration,
  url: URL | string,
  address: string,
  appliedId: bigint,
  knownVersion: ProtocolVersion.ProtocolVersion,
): Stream.Stream<VersionSignalSyncUpdate> => {
  const intervalMs = config.versionWatch?.intervalMs ?? DEFAULT_VERSION_WATCH_INTERVAL_MS;

  return intervalMs <= 0
    ? Stream.empty
    : pipe(
        Stream.fromSchedule(Schedule.spaced(Duration.millis(intervalMs))),
        Stream.mapEffect(() => readVersionSignal(config, url, address, appliedId, knownVersion)),
        Stream.filterMap(identity),
      );
};

export const makeDefaultSyncService = (config: DefaultSyncConfiguration): SyncService<CoreWallet, WalletSyncUpdate> => {
  return {
    updates: (state: CoreWallet): Stream.Stream<WalletSyncUpdate, WalletError, Scope.Scope> => {
      const { indexerClientConnection } = config;

      const webSocketUrlResult = ConnectionHelper.createWebSocketUrl(
        indexerClientConnection.indexerHttpUrl,
        indexerClientConnection.indexerWsUrl,
      );

      if (Either.isLeft(webSocketUrlResult)) {
        return Stream.fail(
          new SyncWalletError(
            new Error(`Could not derive WebSocket URL from indexer HTTP URL: ${webSocketUrlResult.left.message}`),
          ),
        );
      }

      const indexerWsUrlResult = WsURL.make(webSocketUrlResult.right);

      if (Either.isLeft(indexerWsUrlResult)) {
        return Stream.fail(
          new SyncWalletError(new Error(`Invalid indexer WS URL: ${indexerWsUrlResult.left.message}`)),
        );
      }

      const indexerWsUrl = indexerWsUrlResult.right;

      const { appliedId } = state.progress;
      const { address } = state.publicKey;

      const timeline = pipe(
        UnshieldedTransactions.run({ address, transactionId: Number(appliedId) }),
        Stream.provideLayer(
          WsSubscriptionClient.layer({ url: indexerWsUrl, keepAlive: indexerClientConnection.keepAlive }),
        ),
        Stream.mapError((error) => new SyncWalletError(error)),
        Stream.mapEffect((subscription) => {
          const { unshieldedTransactions } = subscription;

          return pipe(
            Schema.decodeUnknownEither(WalletSyncUpdateSchema)(unshieldedTransactions),
            Either.mapLeft((err) => new SyncWalletError(err)),
            EitherOps.toEffect,
          );
        }),
      );

      // The timeline is what the source is for, so it decides when the source is done: `haltStrategy: 'left'` stops the
      // watcher with it rather than leaving a poll loop running against a stream nobody is reading. It has nothing to
      // say about failure — a failing timeline still fails the merged stream, where the variant's retry can see it.
      return Stream.merge(timeline, versionWatch(config, indexerWsUrl, address, appliedId, state.protocolVersion), {
        haltStrategy: 'left',
      });
    },
  };
};

export const makeDefaultSyncCapability = (
  _config: DefaultSyncConfiguration,
  getContext: () => DefaultSyncContext,
): SyncCapability<CoreWallet, WalletSyncUpdate> => {
  return {
    applyUpdate: (
      state: CoreWallet,
      update: WalletSyncUpdate,
      activeRange: ProtocolVersion.ProtocolVersion.Range,
    ): Either.Either<CoreWallet, WalletError> => {
      if (update.type === 'VersionSignal') {
        // The same recording the transaction path makes through `annotateVersion`, and nothing else: no cursor moves,
        // no UTXO changes hands. A signal is an observation about the chain, not a piece of it.
        //
        // One situation makes the observation unsafe to record, and it leaves the state exactly as it was. A
        // transaction still unapplied below the address's tip means the hand-over would park the cursor in front of
        // history the next variant would then apply without ever having seen what led to it — and that transaction
        // carries the version itself, so nothing is lost by waiting for it. That is not an error: the next tick asks
        // again.
        //
        // A version at or below the one already recorded needs no guard of its own — `annotateVersion` never goes
        // backwards — so a source briefly answering from a lagging replica cannot drag a wallet back over a boundary.
        return Either.right(
          BigInt(update.highestTransactionId) > state.progress.appliedId
            ? state
            : annotateVersion(state, update.version),
        );
      } else if (update.type === 'UnshieldedTransactionsProgress') {
        // A progress message reports the tip of the source, not a transaction, and the wire schema carries no protocol
        // version on it. It therefore never annotates: reading one as version zero would drag a wallet that has
        // already crossed a boundary back below it.
        return Either.right(
          CoreWallet.updateProgress(state, {
            highestTransactionId: BigInt(update.highestTransactionId),
            isConnected: true,
          }),
        );
      } else if (isBeyondActiveRange(update.transaction.protocolVersion, activeRange)) {
        // The hand-over point. This transaction belongs to the next variant, so NOTHING about it is applied: no UTXO
        // change, no cursor movement, no transaction-history write. Only the version is recorded, which is what makes
        // the runtime migrate. Because the cursor did not move, the next variant re-fetches this very transaction from
        // it and applies it exactly once.
        return Either.right(annotateVersion(state, update.transaction.protocolVersion));
      } else {
        const updatePayload = {
          createdUtxos: update.createdUtxos,
          spentUtxos: update.spentUtxos,
          status: update.status,
        };

        const stateAfterApplyingUpdate =
          update.status === 'FAILURE'
            ? CoreWallet.applyFailedUpdate(state, updatePayload)
            : CoreWallet.applyUpdate(state, updatePayload);

        return stateAfterApplyingUpdate.pipe(
          Either.map((wallet) => {
            const stateAfterUpdatingProgress = CoreWallet.updateProgress(wallet, {
              appliedId: BigInt(update.transaction.id),
            });

            const { transactionHistoryService } = getContext();
            Effect.runFork(transactionHistoryService.put(update));

            return annotateVersion(stateAfterUpdatingProgress, update.transaction.protocolVersion);
          }),
        );
      }
    },
  };
};

export type SimulatorSyncConfiguration = {
  simulator: Simulator;
};

export type SimulatorSyncUpdate = {
  update: SimulatorState;
};

export const makeSimulatorSyncService = (
  config: SimulatorSyncConfiguration,
): SyncService<CoreWallet, SimulatorSyncUpdate> => {
  return {
    updates: (_state: CoreWallet) => {
      // Get the initial state immediately to ensure we process existing blocks.
      // Then subscribe to state$ for subsequent changes.
      return pipe(
        Stream.fromEffect(config.simulator.getLatestState()),
        Stream.concat(config.simulator.state$),
        Stream.map((state) => ({ update: state })),
      );
    },
  };
};

/**
 * Creates a sync capability that extracts UTXOs from the simulator's ledger state and applies them to the wallet.
 *
 * This capability:
 *
 * 1. Extracts all UTXOs for the wallet's address from the simulator ledger
 * 2. Compares with the wallet's current UTXOs to determine created/spent
 * 3. Applies the update to the wallet state
 *
 * Note: The `registeredForDustGeneration` flag is set based on whether the address appears in the ledger's dust
 * delegation table. This is a heuristic that may not perfectly match the indexer's behavior but provides reasonable
 * accuracy.
 */
export const makeSimulatorSyncCapability = (): SyncCapability<CoreWallet, SimulatorSyncUpdate> => {
  const utxoKey = (utxo: { intentHash: string; outputNo: number }) => `${utxo.intentHash}#${utxo.outputNo}`;

  return {
    applyUpdate: (
      state: CoreWallet,
      update: SimulatorSyncUpdate,
      activeRange: ProtocolVersion.ProtocolVersion.Range,
    ): Either.Either<CoreWallet, WalletError> => {
      // The same rule at the simulator's granularity: a chain state tagged at or beyond the boundary belongs to the
      // next variant, so nothing of it is applied and only the version is recorded.
      if (isBeyondActiveRange(Number(update.update.protocolVersion), activeRange)) {
        return Either.right(annotateVersion(state, Number(update.update.protocolVersion)));
      }

      const { ledger: ledgerState, currentTime } = update.update;
      const walletAddress = state.publicKey.addressHex;
      const nativeTokenType = Token.night;

      // Heuristic: check if address appears in the ledger's dust delegation table
      const isAddressRegisteredForDust = ledgerState.dust.toString().includes(walletAddress);

      // Build a Map of simulator UTXOs keyed by intent hash + output number
      const simulatorUtxoMap = new Map(
        Array.from(ledgerState.utxo.filter(walletAddress)).map((utxo) => [
          utxoKey(utxo),
          new UtxoWithMeta({
            utxo,
            meta: {
              ctime: currentTime,
              registeredForDustGeneration: utxo.type === nativeTokenType && isAddressRegisteredForDust,
            },
          }),
        ]),
      );

      // Created: in simulator but not in wallet (neither available nor pending)
      const createdUtxos = Array.from(simulatorUtxoMap)
        .filter(
          ([hash]) => !HashMap.has(state.state.availableUtxos, hash) && !HashMap.has(state.state.pendingUtxos, hash),
        )
        .map(([, utxo]) => utxo);

      // Spent: in wallet (pending or available) but no longer in simulator
      const spentUtxos = [
        ...Array.from(HashMap.entries(state.state.pendingUtxos)),
        ...Array.from(HashMap.entries(state.state.availableUtxos)),
      ]
        .filter(([hash]) => !simulatorUtxoMap.has(hash))
        .map(([, utxo]) => utxo);

      const blockNumber = getCurrentBlockNumber(update.update);
      const updateProgress = (wallet: CoreWallet) =>
        CoreWallet.updateProgress(wallet, { appliedId: blockNumber, isConnected: true });

      const annotate = (wallet: CoreWallet) => annotateVersion(wallet, Number(update.update.protocolVersion));

      if (createdUtxos.length === 0 && spentUtxos.length === 0) {
        return Either.right(annotate(updateProgress(state)));
      }

      return pipe(
        CoreWallet.applyUpdate(state, { createdUtxos, spentUtxos, status: 'SUCCESS' as const }),
        Either.map(updateProgress),
        Either.map(annotate),
      );
    },
  };
};
