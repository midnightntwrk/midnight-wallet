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
  type DustNullifier,
  type DustParameters,
  type DustPublicKey,
  type DustSecretKey,
  type DustStateChanges,
  type Proofish,
  type Signaturish,
  type Transaction,
  type Event,
} from '@midnight-ntwrk/ledger-v8';
import { ProtocolVersion, SyncProgress } from '@midnightntwrk/wallet-sdk-abstractions';
import { DateOps } from '@midnightntwrk/wallet-sdk-utilities';
import { Array as Arr, HashMap, Option, pipe } from 'effect';
import { type Dust, type DustWithNullifier } from './types/Dust.js';
import { type CoinWithValue } from './CoinsAndBalances.js';
import { type NetworkId, type UnprovenDustSpend } from './types/ledger.js';
import {
  type CollapsedMerkleTree,
  type NewDustGeneration,
  type DustGenerationDtimUpdate,
  type DustUtxoEntry,
  type DustUtxoMap,
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

export type CoreWallet = Readonly<{
  state: DustLocalState;
  publicKey: PublicKey;
  protocolVersion: ProtocolVersion.ProtocolVersion;
  progress: SyncProgress.SyncProgress;
  networkId: NetworkId;
  pendingDust: Array<DustWithNullifier>;
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
      protocolVersion: ProtocolVersion.MinSupportedVersion,
    };
  },

  restore(
    localState: DustLocalState,
    publicKey: PublicKey,
    pendingTokens: Array<DustWithNullifier>,
    syncProgress: Omit<SyncProgress.SyncProgressData, 'isConnected'>,
    protocolVersion: bigint,
    networkId: NetworkId,
  ): CoreWallet {
    return {
      state: localState,
      publicKey,
      networkId,
      pendingDust: pendingTokens,
      progress: SyncProgress.createSyncProgress(syncProgress),
      protocolVersion: ProtocolVersion.ProtocolVersion(protocolVersion),
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
    const availableNonces = updatedState.utxos.map((utxo) => utxo.nonce);
    return [
      {
        ...wallet,
        state: updatedState,
        pendingDust: wallet.pendingDust.filter((t) => availableNonces.includes(t.nonce)),
      },
      stateWithChanges.changes,
    ];
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
        .reduce((current, update) => current.applyGenerationCollapsedUpdate(update.update), state);

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
      (state, update) => state.updateGenerationTreeFromEvidence(update.treeInsertionPath),
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

    const stateAfterCollapsed = collapsedCommitments.reduce((state, { startIndex, update }) => {
      // apply utxos going before the current index, then the current update
      const priorUtxos = newUtxos.filter(
        (utxoInfo) =>
          Number(utxoInfo.qdo.mtIndex) < startIndex && utxoInfo.qdo.mtIndex >= state.commitmentTreeFirstFree,
      );
      return insertCommitments(state, priorUtxos).applyCommitmentCollapsedUpdate(update);
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

  applyFailed(wallet: CoreWallet, tx: Transaction<Signaturish, Proofish, Bindingish>): CoreWallet {
    const pendingSpendsMap = CoreWallet.pendingDustToMap(wallet.pendingDust);

    const relevantSpends = pipe(
      [...(tx.intents?.values() ?? [])],
      Arr.flatMap((intent) => {
        const spendTime = intent.dustActions?.ctime;
        return (intent.dustActions?.spends ?? []).map((spend) => ({ spend, spendTime }));
      }),
      Arr.filterMap(({ spend, spendTime }) =>
        pipe(
          Option.fromNullable(pendingSpendsMap.get(spend.oldNullifier)),
          Option.map(() => ({ spend, spendTime })),
        ),
      ),
    );

    const [updatedState, removedNullifiers] = pipe(
      relevantSpends,
      Arr.reduce(
        [wallet.state, [] as DustNullifier[]] as [DustLocalState, DustNullifier[]],
        ([state, removed], { spend, spendTime }): [DustLocalState, DustNullifier[]] => [
          state.processTtls(DateOps.addSeconds(spendTime!, wallet.state.params.dustGracePeriodSeconds)),
          Arr.append(removed, spend.oldNullifier),
        ],
      ),
    );

    return {
      ...wallet,
      state: updatedState,
      pendingDust: wallet.pendingDust.filter((coin) => !removedNullifiers.includes(coin.nullifier)),
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
          Array<DustWithNullifier>,
        ],
        ([spends, localState, pending], { token: coinToSpend, value: takeFee }) => {
          const [newState, dustSpend] = localState.spend(secretKey, coinToSpend, takeFee, currentTime);
          const newPending = [...pending, { ...coinToSpend, nullifier: dustSpend.oldNullifier }];
          return [Arr.append(spends, dustSpend), newState, newPending] as [
            ReadonlyArray<UnprovenDustSpend>,
            DustLocalState,
            Array<DustWithNullifier>,
          ];
        },
      ),
    );
    return [output, { ...wallet, state: newState, pendingDust: newPending }];
  },

  pendingDustToMap(coins: Array<DustWithNullifier>): Map<DustNullifier, Dust> {
    return new Map<DustNullifier, Dust>(coins.map(({ nullifier, ...coins }) => [nullifier, coins]));
  },
};
