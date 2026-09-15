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
import { Effect, type Scope, Stream, Schema, pipe, Either, HashMap, Match } from 'effect';
import { ProtocolVersion, Token } from '@midnightntwrk/wallet-sdk-abstractions';
import { CoreWallet } from './CoreWallet.js';
import { UtxoWithMeta } from './UnshieldedState.js';
// The simulation package re-exports the ledger-v9 twin unqualified and offers both lines as `V8`/`V9` namespaces. This
// variant must name `V8` explicitly: the two twins are structurally identical, so the unqualified (v9) import
// typechecks here perfectly well and would silently hand ledger-v9 objects to ledger-v8 WASM at runtime.
import { V8 as Simulation } from '@midnightntwrk/wallet-sdk-capabilities/simulation';
import { UnshieldedTransactions } from '@midnightntwrk/wallet-sdk-indexer-client';
import { WsSubscriptionClient, ConnectionHelper } from '@midnightntwrk/wallet-sdk-indexer-client/effect';
import { OutOfOrderSyncUpdateError, SyncWalletError, type WalletError } from './WalletError.js';
import { WsURL } from '@midnightntwrk/wallet-sdk-utilities/networking';
import { type TransactionHistoryService } from './TransactionHistory.js';
import { EitherOps } from '@midnightntwrk/wallet-sdk-utilities';
import {
  type IndexerSyncUpdate,
  type ProgressSchema,
  type UnshieldedUpdate,
  VersionSignalSyncUpdate,
  type WalletSyncUpdate,
  WalletSyncUpdateSchema,
} from './SyncSchema.js';

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

export type DefaultSyncConfiguration = {
  indexerClientConnection: IndexerClientConnection;
};

export type DefaultSyncContext = {
  transactionHistoryService: TransactionHistoryService;
};

/**
 * Splits the chain's protocol version off a progress frame, into a signal of its own.
 *
 * @remarks
 *   This is how a wallet nobody pays learns that the chain moved. Ordinarily a version reaches it on a transaction it was
 *   served, and it is served only the transactions that touch its own address — so on a chain that crosses a protocol
 *   boundary and then pays this address nothing, it would observe no version at all and stay on the variant it was
 *   running, with everything built through it routed to that variant's ledger. The progress arm has no such silence:
 *   the indexer emits it before its first sleep and keeps emitting it, on an address the chain has never mentioned
 *   exactly as on a busy one, and it states the version at the chain's tip.
 *
 *   Split off rather than folded in place, because the two things a frame says are governed by different rules. Progress
 *   is bookkeeping and always applies. A version may be recorded only when the wallet is level with the far end of this
 *   address's timeline, or the hand-over would park the sync cursor in front of history that the next variant would
 *   then apply without ever having seen what led to it. Keeping the signal a message of its own leaves that gate
 *   exactly where the capability already implements it — and the frame states both halves in one indexed instant, so
 *   the version can no longer be read against a timeline end that moved between two separate answers.
 *
 *   Two frames are worth no signal. Zero is the source reporting that it has indexed no block yet, not a chain at version
 *   zero; read as a version it would be a claim nobody made. And a version at or below the one the wallet already held
 *   could only ever be a no-op, because the recorded version never goes backwards — suppressing it is what keeps a
 *   settled wallet's progress frames from putting a redundant message on the stream for the rest of its life.
 * @param update The decoded subscription message.
 * @param knownVersion The version the wallet held when this stream opened — a lower bound on what it holds now.
 * @returns The message, followed by the signal when the frame carries a version worth recording.
 */
const withVersionSignal = (
  update: IndexerSyncUpdate,
  knownVersion: ProtocolVersion.ProtocolVersion,
): readonly WalletSyncUpdate[] =>
  update.type === 'UnshieldedTransactionsProgress' &&
  update.protocolVersion !== 0 &&
  BigInt(update.protocolVersion) > knownVersion
    ? [update, VersionSignalSyncUpdate.create(update.protocolVersion, update.highestTransactionId)]
    : [update];

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

      return pipe(
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
        Stream.mapConcat((update) => withVersionSignal(update, state.protocolVersion)),
      );
    },
  };
};

/** A progress frame: how far the source has got with this address. */
type ProgressUpdate = Schema.Schema.Type<typeof ProgressSchema>;

/**
 * Folds a version signal: records the chain's version, and nothing else.
 *
 * @remarks
 *   The same recording the transaction path makes through {@link annotateVersion}: no cursor moves, no UTXO changes hands.
 *   A signal is an observation about the chain, not a piece of it.
 *
 *   One situation makes the observation unsafe to record, and it leaves the state exactly as it was. A transaction still
 *   unapplied below the address's tip means the hand-over would park the cursor in front of history the next variant
 *   would then apply without ever having seen what led to it — and that transaction carries the version itself, so
 *   nothing is lost by waiting for it. That is not an error: the next tick asks again.
 *
 *   A version at or below the one already recorded needs no guard of its own — `annotateVersion` never goes backwards —
 *   so a source briefly answering from a lagging replica cannot drag a wallet back over a boundary.
 * @param state The wallet to record on.
 * @param signal What the chain said, and how far this address's timeline goes.
 * @returns The wallet, annotated or untouched.
 */
const applyVersionSignal = (state: CoreWallet, signal: VersionSignalSyncUpdate): Either.Either<CoreWallet, never> =>
  Either.right(
    BigInt(signal.highestTransactionId) > state.progress.appliedId ? state : annotateVersion(state, signal.version),
  );

/**
 * Folds a progress frame: moves the far end of the cursor, and nothing else.
 *
 * @remarks
 *   A progress message reports how far the source has got with this address, not a transaction. The chain version it also
 *   carries is deliberately not read here: the source splits that off into its own `VersionSignal`, which is the only
 *   message allowed to annotate, and which alone carries the gate in {@link applyVersionSignal}. Annotating from both
 *   places would put the gate on one route and not the other.
 * @param state The wallet to record on.
 * @param progress The frame.
 * @returns The wallet with the far end of its cursor moved and marked connected.
 */
const applyProgress = (state: CoreWallet, progress: ProgressUpdate): Either.Either<CoreWallet, never> =>
  Either.right(
    CoreWallet.updateProgress(state, {
      highestTransactionId: BigInt(progress.highestTransactionId),
      isConnected: true,
    }),
  );

/**
 * Where a delivered transaction stands against the cursor and the variant's activation range.
 *
 * - `replayed`: below the cursor — history this wallet has already folded.
 * - `redelivered`: the cursor itself, handed back.
 * - `deferred`: at or beyond the activation range — the next variant's to apply.
 * - `applicable`: past the cursor and within range — the one placement that changes the UTXO set.
 */
type TransactionPlacement = 'replayed' | 'redelivered' | 'deferred' | 'applicable';

/**
 * Classifies a delivered transaction; {@link applyTransaction} acts on the answer.
 *
 * @remarks
 *   "Is this past the cursor?" is the only ordering question askable here. The id is the indexer's global transaction id
 *   filtered to this address, so a wallet is served a strictly increasing but SPARSE subsequence of it — consecutive
 *   deliveries routinely skip whole runs of ids belonging to other addresses — and demanding contiguity would reject
 *   every honest stream. What a gap cannot hide is a spend whose create was never folded: `UnshieldedState` refuses a
 *   spend of a UTXO it holds in neither map, and that refusal, not this classification, is what catches a spend
 *   delivered ahead of its create. It happens before the cursor moves, so the retry re-fetches the pair in order.
 *
 *   Whether the resume cursor the subscription is opened with is inclusive is undocumented, so the transaction it names
 *   may or may not reappear on a reconnect; calling an equal id `redelivered` makes the fold indifferent either way,
 *   exactly as the shielded and dust wallets treat their own boundary event.
 * @param state The wallet the transaction was delivered to.
 * @param update The delivered transaction.
 * @param activeRange The half-open protocol version range the running variant owns.
 * @returns The placement.
 */
const placeTransaction = (
  state: CoreWallet,
  update: UnshieldedUpdate,
  activeRange: ProtocolVersion.ProtocolVersion.Range,
): TransactionPlacement => {
  const received = BigInt(update.transaction.id);
  const cursor = state.progress.appliedId;
  return received < cursor
    ? 'replayed'
    : received === cursor
      ? 'redelivered'
      : isBeyondActiveRange(update.transaction.protocolVersion, activeRange)
        ? 'deferred'
        : 'applicable';
};

/**
 * Folds an applicable transaction: the UTXO changes, then the cursor, the history record and the version.
 *
 * @remarks
 *   The history is written only once the fold has succeeded, so a rejected transaction leaves no trace there either.
 * @param state The wallet to fold into.
 * @param update The delivered transaction.
 * @param getContext Where the transaction history lives.
 * @returns The folded wallet, or the fold's refusal.
 */
const foldTransaction = (
  state: CoreWallet,
  update: UnshieldedUpdate,
  getContext: () => DefaultSyncContext,
): Either.Either<CoreWallet, WalletError> => {
  const payload = { createdUtxos: update.createdUtxos, spentUtxos: update.spentUtxos, status: update.status };
  const folded =
    update.status === 'FAILURE' ? CoreWallet.applyFailedUpdate(state, payload) : CoreWallet.applyUpdate(state, payload);

  return folded.pipe(
    Either.map((wallet) => {
      const advanced = CoreWallet.updateProgress(wallet, { appliedId: BigInt(update.transaction.id) });
      Effect.runFork(getContext().transactionHistoryService.put(update));
      return annotateVersion(advanced, update.transaction.protocolVersion);
    }),
  );
};

/**
 * Folds a delivered transaction according to its {@link TransactionPlacement}.
 *
 * @remarks
 *   - `replayed` is refused with {@link OutOfOrderSyncUpdateError} and nothing is applied: folding a create twice resurrects
 *       a UTXO some later transaction has since spent; folding a spend twice removes one some later transaction
 *       re-created. The state is handed back untouched so the retry can re-fetch in order.
 *   - `redelivered` is a no-op in the strongest sense — the same state comes back: no UTXO change, no cursor movement, no
 *       version annotation, no transaction-history write. All of that was done the first time it arrived.
 *   - `deferred` is the hand-over point. The transaction belongs to the next variant, so NOTHING about it is applied; only
 *       the version is recorded, which is what makes the runtime migrate. Because the cursor did not move, the next
 *       variant re-fetches this very transaction and applies it exactly once.
 *   - `applicable` is folded by {@link foldTransaction}.
 *
 * @param state The wallet the transaction was delivered to.
 * @param update The delivered transaction.
 * @param activeRange The half-open protocol version range the running variant owns.
 * @param getContext Where the transaction history lives.
 * @returns The next wallet, or the refusal.
 */
const applyTransaction = (
  state: CoreWallet,
  update: UnshieldedUpdate,
  activeRange: ProtocolVersion.ProtocolVersion.Range,
  getContext: () => DefaultSyncContext,
): Either.Either<CoreWallet, WalletError> =>
  Match.value(placeTransaction(state, update, activeRange)).pipe(
    Match.when('replayed', () =>
      Either.left(
        new OutOfOrderSyncUpdateError({
          message:
            `Sync source delivered transaction ${update.transaction.id}, below the applied cursor ` +
            `${state.progress.appliedId}; the state is left untouched so the retry can re-fetch in order`,
          expected: state.progress.appliedId,
          received: BigInt(update.transaction.id),
        }),
      ),
    ),
    Match.when('redelivered', () => Either.right(state)),
    Match.when('deferred', () => Either.right(annotateVersion(state, update.transaction.protocolVersion))),
    Match.when('applicable', () => foldTransaction(state, update, getContext)),
    Match.exhaustive,
  );

export const makeDefaultSyncCapability = (
  _config: DefaultSyncConfiguration,
  getContext: () => DefaultSyncContext,
): SyncCapability<CoreWallet, WalletSyncUpdate> => {
  return {
    applyUpdate: (
      state: CoreWallet,
      update: WalletSyncUpdate,
      activeRange: ProtocolVersion.ProtocolVersion.Range,
    ): Either.Either<CoreWallet, WalletError> =>
      Match.value(update).pipe(
        Match.discriminatorsExhaustive('type')({
          VersionSignal: (signal) => applyVersionSignal(state, signal),
          UnshieldedTransactionsProgress: (progress) => applyProgress(state, progress),
          UnshieldedTransaction: (transaction) => applyTransaction(state, transaction, activeRange, getContext),
        }),
      ),
  };
};

export type SimulatorSyncConfiguration = {
  simulator: Simulation.Simulator;
};

export type SimulatorSyncUpdate = {
  update: Simulation.SimulatorState;
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

      const blockNumber = Simulation.getCurrentBlockNumber(update.update);
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
