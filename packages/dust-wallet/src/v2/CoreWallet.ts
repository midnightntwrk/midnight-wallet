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
  type Bindingish,
  DustLocalState,
  type DustNonce,
  type DustNullifier,
  type DustParameters,
  type DustPublicKey,
  type DustSecretKey,
  type DustStateChanges,
  type Proofish,
  type Signaturish,
  type Transaction,
  type Event,
  updatedValue,
} from '@midnightntwrk/ledger-v9';
import { ProtocolVersion, type SnapshotFormat, SyncProgress } from '@midnightntwrk/wallet-sdk-abstractions';
import { Array as Arr, HashMap, Option, pipe } from 'effect';
import { type Dust, type PendingDust } from './types/Dust.js';
import { type CoinWithValue } from './CoinsAndBalances.js';
import { type NetworkId, type UnprovenDustSpend } from './types/ledger.js';
import { type SyncKind } from '../SnapshotFormat.js';
import {
  type CollapsedMerkleTree,
  type NewDustGeneration,
  type DustGenerationDtimUpdate,
  type DustUtxoEntry,
  type DustUtxoMap,
  readCollapsedUpdate,
  readGenerationTreeInsertionPath,
} from './SyncSchema.js';

export type PublicKey = {
  publicKey: DustPublicKey;
};

export const PublicKey = {
  fromSecretKey: (secretKey: DustSecretKey): PublicKey => {
    return {
      publicKey: secretKey.publicKey,
    };
  },
};

/** `date` truncated to whole seconds, as the ledger keeps the time a transaction declares in its `dustActions`. */
const toWholeSeconds = (date: Date): Date => new Date(Math.floor(date.getTime() / 1000) * 1000);

export type CoreWallet = Readonly<{
  state: DustLocalState;
  publicKey: PublicKey;
  protocolVersion: ProtocolVersion.ProtocolVersion;
  progress: SyncProgress.SyncProgress;
  /**
   * Which synchronization moved `progress`, and so which of its indexes is the position it resumes from. Set by the
   * sync capability that moves it; a restore that cannot resume from it is refused. See {@link SyncKind}.
   */
  syncKind: SyncKind;
  networkId: NetworkId;
  pendingDust: Array<PendingDust>;
  /**
   * The snapshot fields this variant's schema does not declare, exactly as they were read, written back with the next
   * snapshot so a later release that wrote them still finds them. Absent when the snapshot carried none.
   */
  unknownFields?: SnapshotFormat.UnknownFields;
}>;

export const CoreWallet = {
  init(localState: DustLocalState, secretKey: DustSecretKey, networkId: NetworkId): CoreWallet {
    return CoreWallet.empty(localState, PublicKey.fromSecretKey(secretKey), networkId);
  },

  initEmpty(dustParameters: DustParameters, secretKey: DustSecretKey, networkId: NetworkId): CoreWallet {
    return CoreWallet.empty(new DustLocalState(dustParameters), PublicKey.fromSecretKey(secretKey), networkId);
  },

  empty(localState: DustLocalState, publicKey: PublicKey, networkId: NetworkId): CoreWallet {
    return {
      state: localState,
      publicKey,
      networkId,
      pendingDust: [],
      progress: SyncProgress.createSyncProgress(),
      // Index 0, which event replay reads as "nothing applied yet" and no other synchronization reads at all.
      syncKind: 'events',
      protocolVersion: ProtocolVersion.MinSupportedVersion,
    };
  },

  /**
   * A wallet as a snapshot left it.
   *
   * @param syncKind Which synchronization moved `syncProgress`. Required, because it decides whether a wallet that
   *   replays events may resume from it, and a guess in the wrong direction is the one that misreads a position.
   */
  restore(
    localState: DustLocalState,
    publicKey: PublicKey,
    pendingTokens: Array<PendingDust>,
    syncProgress: Omit<SyncProgress.SyncProgressData, 'isConnected'>,
    protocolVersion: bigint,
    networkId: NetworkId,
    syncKind: SyncKind,
  ): CoreWallet {
    return {
      state: localState,
      publicKey,
      networkId,
      pendingDust: pendingTokens,
      progress: SyncProgress.createSyncProgress(syncProgress),
      syncKind,
      protocolVersion: ProtocolVersion.ProtocolVersion(protocolVersion),
    };
  },

  /**
   * Records an observed protocol version, monotonically.
   *
   * @remarks
   *   Only ever raises it. A stale lower report — a late batch from behind the tip, a source that rewound — would
   *   otherwise look like a downward version change and send the runtime migrating backwards into a variant this wallet
   *   has already left.
   */
  withProtocolVersion(wallet: CoreWallet, version: ProtocolVersion.ProtocolVersion): CoreWallet {
    return version > wallet.protocolVersion ? { ...wallet, protocolVersion: version } : wallet;
  },

  /**
   * The first state of this ledger version, projected from the wallet of the version it replaced.
   *
   * @remarks
   *   Identity and position only. The dust itself is deliberately absent: the indexer replays the timeline after the
   *   fork, so the same dust is generated again by events of this ledger version and re-discovered by ordinary sync.
   *
   *   `dustParameters` has to be supplied rather than carried, and this is where dust departs from shielded:
   *   `DustLocalState` is parameterised by the ledger's dust parameters, and those are a WASM object belonging to
   *   whichever ledger module produced them. The previous variant's copy cannot be handed to this one.
   */
  fromPreviousVersion(previous: {
    readonly publicKey: PublicKey;
    readonly networkId: NetworkId;
    readonly protocolVersion: bigint;
    readonly progress: SyncProgress.SyncProgressData;
    readonly dustParameters: DustParameters;
  }): CoreWallet {
    return {
      state: new DustLocalState(previous.dustParameters),
      publicKey: previous.publicKey,
      networkId: previous.networkId,
      pendingDust: [],
      progress: SyncProgress.createSyncProgress({ ...previous.progress, isConnected: false }),
      // The V1 variant only ever replays events, so the position it hands over is a dust event id.
      syncKind: 'events',
      protocolVersion: ProtocolVersion.ProtocolVersion(previous.protocolVersion),
    };
  },

  applyEventsWithChanges(
    wallet: CoreWallet,
    secretKey: DustSecretKey,
    events: Event[],
    currentTime: Date,
  ): [CoreWallet, DustStateChanges[]] {
    // TODO: replace currentTime with `updatedState.syncTime` introduced in ledger-6.2.0-rc.1
    const stateWithChanges = wallet.state.replayEventsWithChanges(secretKey, events);
    const updatedState = stateWithChanges.state.processTtls(currentTime);
    return [
      {
        ...wallet,
        state: updatedState,
        pendingDust: CoreWallet.settlePendingDust(
          wallet.pendingDust,
          stateWithChanges.state,
          updatedState,
          stateWithChanges.changes.flatMap((change) => change.spentUtxos.map((utxo) => utxo.nonce)),
          currentTime,
        ),
      },
      stateWithChanges.changes,
    ];
  },

  /**
   * The pending coins still held after a TTL pass at `time` took the state from `beforeTtls` to `afterTtls`.
   *
   * @remarks
   *   A coin settles when the chain spends it, when its lock runs out and it is back among the unlocked utxos, or when
   *   the pass drops it as worth nothing. That last test mirrors the ledger's own: valued on the state before the pass,
   *   with time counted in whole seconds, so a coin is never dropped within the second it was created.
   * @example
   *   ```ts
   *   const afterTtls = beforeTtls.processTtls(time);
   *   const pendingDust = CoreWallet.settlePendingDust(wallet.pendingDust, beforeTtls, afterTtls, spentNonces, time);
   *   ```;
   *
   * @param pendingDust The coins pending transactions have spent, as held before the sync.
   * @param beforeTtls The state with the sync's events applied, before the TTL pass.
   * @param afterTtls The state after the TTL pass at `time`.
   * @param spentNonces The nonces of the coins the sync's events spent.
   * @param time The time the TTL pass ran at.
   * @returns The coins of `pendingDust` still pending, in their original order.
   */
  settlePendingDust(
    pendingDust: Array<PendingDust>,
    beforeTtls: DustLocalState,
    afterTtls: DustLocalState,
    spentNonces: ReadonlyArray<DustNonce>,
    time: Date,
  ): Array<PendingDust> {
    if (pendingDust.length === 0) return pendingDust;
    const spent = new Set(spentNonces);
    const wholeSeconds = (date: Date): number => Math.floor(date.getTime() / 1000);
    const backUnlocked = ({ nullifier }: PendingDust): boolean =>
      afterTtls.findUtxoByNullifier(nullifier) !== undefined;
    const decayedAway = (coin: Dust): boolean =>
      pipe(
        Option.fromNullable(beforeTtls.generationInfo(coin)),
        Option.match({
          onNone: () => true,
          onSome: (genInfo) =>
            wholeSeconds(time) > wholeSeconds(coin.ctime) &&
            updatedValue(coin.ctime, coin.initialValue, genInfo, time, beforeTtls.params) === 0n,
        }),
      );
    return pendingDust.filter(
      (pending) => !spent.has(pending.coin.nonce) && !backUnlocked(pending) && !decayedAway(pending.coin),
    );
  },

  applyDustGenerations(
    wallet: CoreWallet,
    dustCollapsedGenTreeSnapshot: ReadonlyArray<CollapsedMerkleTree>, // a full snapshot starting from index 0
    newGenerations: ReadonlyArray<NewDustGeneration>,
    generationDtimeUpdates: ReadonlyArray<DustGenerationDtimUpdate>,
  ): CoreWallet {
    // apply snapshot updates covering (lastIndex, nextGenerationIndex) — the gap before the next own generation,
    // or every remaining update when there is no next generation
    const applySnapshotGap = (state: DustLocalState, lastIndex: number, nextGenerationIndex?: number): DustLocalState =>
      dustCollapsedGenTreeSnapshot
        .filter(
          ({ startIndex, endIndex }) =>
            startIndex > lastIndex && (nextGenerationIndex === undefined || endIndex < nextGenerationIndex),
        )
        // Read here rather than on arrival: the subscription serves updates this wallet may skip entirely, and one it
        // never applies must not be able to fail the fetch the rest of them arrived in.
        .reduce((current, update) => current.applyGenerationCollapsedUpdate(readCollapsedUpdate(update)), state);

    const { state: stateWithGenerations, lastIndex } = newGenerations.reduce(
      (acc, { generationMtIndex, genInfo, qdo }) => ({
        state: applySnapshotGap(acc.state, acc.lastIndex, generationMtIndex).insertGenerationInfo(
          BigInt(generationMtIndex),
          genInfo,
          qdo.backingNight,
        ),
        lastIndex: generationMtIndex,
      }),
      { state: wallet.state, lastIndex: -1 },
    );

    // apply the rest of the updates, then the dtime updates
    const updatedState = generationDtimeUpdates.reduce(
      (state, update) =>
        state.updateGenerationTreeFromEvidence(readGenerationTreeInsertionPath(update.treeInsertionPath)),
      applySnapshotGap(stateWithGenerations, lastIndex),
    );

    return {
      ...wallet,
      state: updatedState,
    };
  },

  applyNewDustUtxos(wallet: CoreWallet, newDustUtxos: Readonly<DustUtxoMap>): CoreWallet {
    const updatedState = [...newDustUtxos]
      .toSorted((a, b) => Number(a[1].qdo.mtIndex - b[1].qdo.mtIndex))
      .reduce((state, [dustNullifier, utxoInfo]) => state.addUtxo(dustNullifier, utxoInfo.qdo), wallet.state);
    return {
      ...wallet,
      state: updatedState,
    };
  },

  applyDustCommitments(
    wallet: CoreWallet,
    newDustUtxos: Readonly<DustUtxoMap>,
    collapsedCommitments: ReadonlyArray<CollapsedMerkleTree>,
  ): CoreWallet {
    const newUtxos = [...HashMap.values(newDustUtxos)].toSorted((a, b) => Number(a.qdo.mtIndex - b.qdo.mtIndex));

    const insertCommitments = (state: DustLocalState, utxos: ReadonlyArray<DustUtxoEntry>): DustLocalState =>
      utxos.reduce((current, utxoInfo) => current.insertCommitment(utxoInfo.qdo.mtIndex, utxoInfo.qdo, true), state);

    const stateAfterCollapsed = collapsedCommitments.reduce((state, collapsed) => {
      // apply utxos going before the current index, then the current update
      const priorUtxos = newUtxos.filter(
        (utxoInfo) =>
          Number(utxoInfo.qdo.mtIndex) < collapsed.startIndex && utxoInfo.qdo.mtIndex >= state.commitmentTreeFirstFree,
      );
      return insertCommitments(state, priorUtxos).applyCommitmentCollapsedUpdate(readCollapsedUpdate(collapsed));
    }, wallet.state);

    // insert the utxos after the last collapsed update — all of them when there were no collapsed updates
    const lastCollapsedIndex = collapsedCommitments.at(-1);
    const updatedState = insertCommitments(
      stateAfterCollapsed,
      lastCollapsedIndex !== undefined
        ? newUtxos.filter((utxoInfo) => Number(utxoInfo.qdo.mtIndex) > lastCollapsedIndex.endIndex)
        : newUtxos,
    );

    return { ...wallet, state: updatedState };
  },

  applySpentNullifiers(wallet: CoreWallet, spentNullifiers: ReadonlyArray<DustNullifier>): CoreWallet {
    const updatedState = spentNullifiers.reduce((state, nullifier) => state.removeUtxo(nullifier), wallet.state);
    return {
      ...wallet,
      pendingDust: wallet.pendingDust.filter((d) => !spentNullifiers.includes(d.nullifier)),
      state: updatedState,
    };
  },

  /**
   * Releases the pending Dust coins a reverted transaction spent, and only those.
   *
   * @remarks
   *   Only for a transaction whose Dust spends never ran on chain: one never included, or one that failed outright. A
   *   partially successful transaction ran its guaranteed segment, where every Dust spend sits, so its coins are spent
   *   and are settled by sync instead. Each coin is put back unlocked. `processTtls` cannot target coins: run at the
   *   end of the grace period, it would also drop every coin that decays to nothing by then and release coins other
   *   pending transactions hold. A coin is matched by its nullifier together with the time the transaction declared,
   *   because a coin whose lock ran out can be booked again by a later transaction under the same nullifier, and that
   *   booking is not this transaction's to release.
   * @example
   *   ```ts
   *   const released = CoreWallet.applyFailed(wallet, neverIncludedTransaction);
   *   ```;
   *
   * @param wallet The wallet holding the pending coins.
   * @param tx The transaction whose Dust spends are released.
   * @returns The wallet with those coins unlocked and no longer pending; every other coin as it was.
   */
  applyFailed(wallet: CoreWallet, tx: Transaction<Signaturish, Proofish, Bindingish>): CoreWallet {
    const bookingKey = (nullifier: DustNullifier, declaredTime: Date): string =>
      `${nullifier}@${declaredTime.getTime()}`;
    const revertedBookings = new Set(
      [...(tx.intents?.values() ?? [])].flatMap(({ dustActions }) =>
        dustActions === undefined
          ? []
          : dustActions.spends.map((spend) => bookingKey(spend.oldNullifier, dustActions.ctime)),
      ),
    );
    const [kept, released] = Arr.partition(wallet.pendingDust, (pending) =>
      revertedBookings.has(bookingKey(pending.nullifier, pending.declaredTime)),
    );

    return {
      ...wallet,
      state: released.reduce((state, { nullifier, coin }) => state.addUtxo(nullifier, coin), wallet.state),
      pendingDust: kept,
    };
  },

  revertTransaction<TTransaction extends Transaction<Signaturish, Proofish, Bindingish>>(
    wallet: CoreWallet,
    tx: TTransaction,
  ): CoreWallet {
    return CoreWallet.applyFailed(wallet, tx);
  },

  updateProgress(
    wallet: CoreWallet,
    {
      appliedIndex,
      highestRelevantWalletIndex,
      highestIndex,
      highestRelevantIndex,
      isConnected,
    }: Partial<SyncProgress.SyncProgressData>,
  ): CoreWallet {
    const updatedProgress = SyncProgress.createSyncProgress({
      appliedIndex: appliedIndex ?? wallet.progress.appliedIndex,
      highestRelevantWalletIndex: highestRelevantWalletIndex ?? wallet.progress.highestRelevantWalletIndex,
      highestIndex: highestIndex ?? wallet.progress.highestIndex,
      highestRelevantIndex: highestRelevantIndex ?? wallet.progress.highestRelevantIndex,
      isConnected: isConnected ?? wallet.progress.isConnected,
    });
    return { ...wallet, progress: updatedProgress };
  },

  spendCoins(
    wallet: CoreWallet,
    secretKey: DustSecretKey,
    coins: ReadonlyArray<CoinWithValue<Dust>>,
    currentTime: Date,
  ): [ReadonlyArray<UnprovenDustSpend>, CoreWallet] {
    const [output, newState, newPending] = pipe(
      coins,
      Arr.reduce(
        [[], wallet.state, wallet.pendingDust] as [
          ReadonlyArray<UnprovenDustSpend>,
          DustLocalState,
          Array<PendingDust>,
        ],
        ([spends, localState, pending], { token: coinToSpend, value: takeFee }) => {
          const [newState, dustSpend] = localState.spend(secretKey, coinToSpend, takeFee, currentTime);
          const newPending = [
            ...pending,
            { coin: coinToSpend, nullifier: dustSpend.oldNullifier, declaredTime: toWholeSeconds(currentTime) },
          ];
          return [Arr.append(spends, dustSpend), newState, newPending] as [
            ReadonlyArray<UnprovenDustSpend>,
            DustLocalState,
            Array<PendingDust>,
          ];
        },
      ),
    );
    return [output, { ...wallet, state: newState, pendingDust: newPending }];
  },

  pendingDustToMap(coins: Array<PendingDust>): Map<DustNullifier, Dust> {
    return new Map<DustNullifier, Dust>(coins.map(({ nullifier, coin }) => [nullifier, coin]));
  },
};
