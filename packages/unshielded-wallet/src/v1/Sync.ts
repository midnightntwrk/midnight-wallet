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
import { type Duration, Effect, type Scope, Stream, Schema, pipe, Either, HashMap, Option } from 'effect';
import { IndexerLiveness } from '@midnightntwrk/wallet-sdk-abstractions';
import { CoreWallet } from './CoreWallet.js';
import { UtxoWithMeta } from './UnshieldedState.js';
import {
  type Simulator,
  type SimulatorState,
  getCurrentBlockNumber,
} from '@midnightntwrk/wallet-sdk-capabilities/simulation';
import {
  DEFAULT_LIVENESS_CONFIGURATION,
  DEFAULT_POLL_INTERVAL,
  type DefaultSubmissionConfiguration,
  type LivenessConfiguration,
  type LivenessReads,
  type LivenessReadsConfiguration,
  LivenessServiceImpl,
  makeDefaultLivenessReads,
} from '@midnightntwrk/wallet-sdk-capabilities';
import { UnshieldedTransactions } from '@midnightntwrk/wallet-sdk-indexer-client';
import { WsSubscriptionClient, ConnectionHelper } from '@midnightntwrk/wallet-sdk-indexer-client/effect';
import { SyncWalletError, type WalletError } from './WalletError.js';
import { WsURL } from '@midnightntwrk/wallet-sdk-utilities/networking';
import { type TransactionHistoryService } from './TransactionHistory.js';
import { EitherOps } from '@midnightntwrk/wallet-sdk-utilities';
import { type IndexerLivenessUpdate, type SyncUpdate, WalletSyncUpdateSchema } from './SyncSchema.js';
import * as ledger from '@midnight-ntwrk/ledger-v8';

export interface SyncService<TState, TUpdate> {
  /** The wallet's subscription to its update source. Rebuilt by the variant's retry whenever it fails. */
  updates: (state: TState) => Stream.Stream<TUpdate, WalletError, Scope.Scope>;
  /**
   * Updates whose lifetime is the wallet's, not the subscription's.
   *
   * @remarks
   *   Forked once at wallet scope and never rebuilt: `updates` failing and retrying must not restart this feed, so a
   *   liveness poller keeps its node connection — and keeps publishing verdicts — while the indexer subscription is
   *   down. Optional because not every source has such a feed: the simulator reports its skipped check through its
   *   capability instead.
   */
  livenessUpdates?: (state: TState) => Stream.Stream<TUpdate, WalletError, Scope.Scope>;
}

export interface SyncCapability<TState, TUpdate> {
  applyUpdate: (state: TState, update: TUpdate) => Either.Either<TState, WalletError>;
}

export type IndexerClientConnection = {
  indexerHttpUrl: string;
  indexerWsUrl?: string;
  keepAlive?: number;
};

export type NodeClientConnection = {
  /** The node's WebSocket RPC endpoint, used only to read the finalized head. */
  nodeURL: string;
};

/**
 * The node transactions are submitted through, borrowed from the submission configuration as the default source of a
 * finalized head.
 *
 * @remarks
 *   Every wallet configured to submit already names a node, and demanding that same endpoint a second time would leave
 *   the cross-check switched off for anyone who did not know to opt in.
 *
 *   Taken from `DefaultSubmissionConfiguration` rather than redeclared, so that renaming or retyping the field there
 *   fails to compile here. Declared independently it would merely stop matching, and the check would go quiet — the
 *   class of silent failure this feature exists to prevent.
 */
type SubmissionNodeFallback = Partial<Pick<DefaultSubmissionConfiguration, 'relayURL'>>;

export type DefaultSyncConfiguration = {
  indexerClientConnection: IndexerClientConnection;
  /**
   * Where to read the node's finalized head, for cross-checking the indexer's reported position.
   *
   * @remarks
   *   Synchronizing needs a node as well as an indexer, and this is where sync says so. Optional only because a wallet
   *   may run without one, in which case no cross-check happens and the wallet reports {@link IndexerLiveness.Skipped}.
   *
   *   A wallet configured for transaction submission need not set it: the endpoint named by `relayURL` is used, so the
   *   same node is not configured twice. Set this to name the node explicitly — a wallet built without submission
   *   configuration has no `relayURL` to borrow.
   */
  nodeClientConnection?: NodeClientConnection;
  /**
   * How far the indexer may drift from the node's finalized head before the difference is reported.
   *
   * @remarks
   *   Defaults to {@link DEFAULT_LIVENESS_CONFIGURATION}, whose tolerances suit a chain producing blocks seconds apart.
   *   Set this for a chain with a different block time, or to tighten the staleness allowance a caller is willing to
   *   treat as current.
   */
  livenessConfiguration?: LivenessConfiguration;
  /**
   * How often to compare the indexer against the node.
   *
   * @remarks
   *   Defaults to {@link DEFAULT_POLL_INTERVAL}. Each poll costs one request to the indexer and one to a node the wallet
   *   does not own, so shortening this trades load for how quickly a stalled indexer is noticed. Polling faster than
   *   blocks are produced only re-reads the same block.
   *
   *   Polls never overlap: each one is awaited before the next tick is taken. An interval shorter than the time a read
   *   takes — a read of the node is given ten seconds before it is abandoned — therefore slows the effective cadence to
   *   the speed of the reads rather than running two at once.
   */
  livenessPollInterval?: Duration.DurationInput;
} & SubmissionNodeFallback;

export type DefaultSyncContext = {
  transactionHistoryService: TransactionHistoryService;
};

export const makeDefaultSyncService = (config: DefaultSyncConfiguration): SyncService<CoreWallet, SyncUpdate> => {
  return {
    updates: (state: CoreWallet): Stream.Stream<SyncUpdate, WalletError, Scope.Scope> => {
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

      const indexerUpdates: Stream.Stream<SyncUpdate, WalletError, Scope.Scope> = pipe(
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

      return indexerUpdates;
    },
    // Both outcomes live here so the decision is made in one place — a caller choosing between them separately would
    // leave one branch dead code, exercised only by tests.
    livenessUpdates: (state: CoreWallet): Stream.Stream<SyncUpdate, WalletError, Scope.Scope> =>
      Option.match(makeLivenessUpdates(config, state.progress.indexerLiveness), {
        // Reported from the one place that can see the configuration: no node means no check, said once rather than
        // left as `Unknown` forever. The stream then ends — there is nothing more this feed will ever say.
        onNone: () =>
          Stream.make({
            type: 'IndexerLiveness' as const,
            verdict: IndexerLiveness.Skipped({ reason: 'no-node-configured' as const }),
          }),
        onSome: (verdicts) => verdicts,
      }),
  };
};

/**
 * Decides which node endpoint the liveness check should read, if any.
 *
 * @remarks
 *   `nodeClientConnection` is sync's own statement of the node it needs, so it is preferred. A wallet configured for
 *   submission need not repeat that endpoint, so `relayURL` serves as the default. Only a wallet naming neither goes
 *   unchecked.
 * @param config - The sync configuration.
 * @returns The endpoint to read the finalized head from, or `Option.none` when the wallet names no node at all.
 */
export const resolveNodeEndpoint = (config: DefaultSyncConfiguration): Option.Option<NodeClientConnection> =>
  Option.orElse(Option.fromNullable(config.nodeClientConnection), () =>
    Option.map(Option.fromNullable(config.relayURL), (relayURL) => ({ nodeURL: relayURL.toString() })),
  );

/**
 * Builds the stream of liveness verdicts for a wallet, when one can be produced.
 *
 * @remarks
 *   Returns `Option.none` when no node endpoint is configured. There is nothing to compare the indexer against in that
 *   case, so no service is started and the wallet's progress keeps the {@link IndexerLiveness.Skipped} default set by
 *   `createSyncProgress` — "no check ran, because you configured no node".
 * @param config - The sync configuration, whose `nodeClientConnection` decides whether a check is possible, and whose
 *   `livenessConfiguration` and `livenessPollInterval` override the defaults.
 * @param initialVerdict - The verdict to start from, so a rebuilt stream does not discard what is already known.
 * @param makeReads - Where the two block heights come from. Defaults to reading the configured indexer and node;
 *   supplying this is how a test drives the check without either of them.
 * @returns The stream of verdict updates to merge into the sync stream, or `Option.none` when no node is configured.
 */
export const makeLivenessUpdates = (
  config: DefaultSyncConfiguration,
  initialVerdict: IndexerLiveness.IndexerLiveness,
  makeReads: (
    readsConfig: LivenessReadsConfiguration,
  ) => Effect.Effect<LivenessReads, never, Scope.Scope> = makeDefaultLivenessReads,
): Option.Option<Stream.Stream<IndexerLivenessUpdate, WalletError, Scope.Scope>> =>
  resolveNodeEndpoint(config).pipe(
    Option.map((nodeClientConnection) =>
      Stream.unwrapScoped(
        Effect.gen(function* () {
          // Built in the stream's scope, so the node connection the reads share is released when sync stops.
          const reads = yield* makeReads({
            indexerClientConnection: config.indexerClientConnection,
            nodeClientConnection,
          });

          const service = yield* LivenessServiceImpl.make(
            reads,
            config.livenessConfiguration ?? DEFAULT_LIVENESS_CONFIGURATION,
            // Seeded from what the wallet already knows. The feed lives at wallet scope and is only ever rebuilt
            // after an unexpected failure — and starting afresh at `Unknown` there would clear a `Behind` verdict,
            // handing back a "synchronized" answer over the stale view the check had just caught.
            initialVerdict,
          );

          // Forked into the caller's scope so polling stops when sync does, rather than outliving the wallet.
          yield* Effect.forkScoped(
            service.startPolling(Stream.tick(config.livenessPollInterval ?? DEFAULT_POLL_INTERVAL)),
          );

          return service
            .state()
            .pipe(Stream.map((verdict): IndexerLivenessUpdate => ({ type: 'IndexerLiveness', verdict })));
        }),
      ),
    ),
  );

export const makeDefaultSyncCapability = (
  _config: DefaultSyncConfiguration,
  getContext: () => DefaultSyncContext,
): SyncCapability<CoreWallet, SyncUpdate> => {
  return {
    applyUpdate: (state: CoreWallet, update: SyncUpdate): Either.Either<CoreWallet, WalletError> => {
      if (update.type === 'IndexerLiveness') {
        // Only the verdict is written. A verdict says nothing about which transactions have been applied, so touching
        // the sync cursor here would let the liveness check corrupt it.
        return Either.right(CoreWallet.updateProgress(state, { indexerLiveness: update.verdict }));
      } else if (update.type === 'UnshieldedTransactionsProgress') {
        return Either.right(
          CoreWallet.updateProgress(state, {
            highestTransactionId: BigInt(update.highestTransactionId),
            isConnected: true,
          }),
        );
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

            return stateAfterUpdatingProgress;
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
    applyUpdate: (state: CoreWallet, update: SimulatorSyncUpdate): Either.Either<CoreWallet, WalletError> => {
      const { ledger: ledgerState, currentTime } = update.update;
      const walletAddress = state.publicKey.addressHex;
      const nativeTokenType = ledger.nativeToken().raw;

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
        CoreWallet.updateProgress(wallet, {
          appliedId: blockNumber,
          isConnected: true,
          // `Unknown` gates sync completion, so a wallet whose progress never left it would never report itself
          // synchronized. A simulation has no node to cross-check against and never will — the wiring that knows
          // says so, the same way the default sync service reports `Skipped` when no node is configured.
          indexerLiveness: IndexerLiveness.Skipped({ reason: 'simulation' }),
        });

      if (createdUtxos.length === 0 && spentUtxos.length === 0) {
        return Either.right(updateProgress(state));
      }

      return pipe(
        CoreWallet.applyUpdate(state, { createdUtxos, spentUtxos, status: 'SUCCESS' as const }),
        Either.map(updateProgress),
      );
    },
  };
};
