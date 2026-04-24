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
  Bindingish,
  DustLocalState,
  DustNullifier,
  DustParameters,
  DustPublicKey,
  DustSecretKey,
  Proofish,
  Signaturish,
  Transaction,
  QualifiedDustOutput,
  Event,
} from '@midnight-ntwrk/ledger-v8';
import { ProtocolVersion, SyncProgress } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { DateOps } from '@midnight-ntwrk/wallet-sdk-utilities';
import { Array as Arr, Option, pipe } from 'effect';
import { Dust, DustGenerationInfo, DustWithNullifier } from './types/Dust.js';
import { CoinWithValue } from './CoinsAndBalances.js';
import { NetworkId, UnprovenDustSpend } from './types/ledger.js';
import { CollapsedMerkleTree } from './SyncSchema.js';

export type PublicKey = {
  publicKey: DustPublicKey;
};

export type SyncedDustNullifier = {
  dustNullifier: DustNullifier;
  isSynced: boolean;
};

export type DustGenerationWithNullifierUpdate = {
  dustNullifier: DustNullifier;
  genInfo: DustGenerationInfo;
  generationIndex: number;
  qdo: QualifiedDustOutput;
  isSynced: boolean;
};

export type DustUtxoUpdate = Pick<DustGenerationWithNullifierUpdate, 'dustNullifier' | 'qdo' | 'isSynced'>;

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
  dustNullifiers: Array<SyncedDustNullifier>;
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
      dustNullifiers: [],
      progress: SyncProgress.createSyncProgress(),
      protocolVersion: ProtocolVersion.MinSupportedVersion,
    };
  },

  restore(
    localState: DustLocalState,
    publicKey: PublicKey,
    pendingTokens: Array<DustWithNullifier>,
    dustNullifiers: Array<SyncedDustNullifier>,
    syncProgress: Omit<SyncProgress.SyncProgressData, 'isConnected'>,
    protocolVersion: bigint,
    networkId: NetworkId,
  ): CoreWallet {
    return {
      state: localState,
      publicKey,
      networkId,
      pendingDust: pendingTokens,
      dustNullifiers,
      progress: SyncProgress.createSyncProgress(syncProgress),
      protocolVersion: ProtocolVersion.ProtocolVersion(protocolVersion),
    };
  },

  applyEvents(wallet: CoreWallet, secretKey: DustSecretKey, events: Event[], currentTime: Date): CoreWallet {
    // TODO: replace currentTime with `updatedState.syncTime` introduced in ledger-6.2.0-rc.1
    const updatedState = wallet.state.replayEvents(secretKey, events).processTtls(currentTime);
    const availableNonces = updatedState.utxos.map((utxo) => utxo.nonce);
    return {
      ...wallet,
      state: updatedState,
      pendingDust: wallet.pendingDust.filter((t) => availableNonces.includes(t.nonce)),
    };
  },

  applyDustGenerations(
    wallet: CoreWallet,
    updates: CollapsedMerkleTree[],
    generationUpdates: DustGenerationWithNullifierUpdate[],
  ): CoreWallet {
    let updatedState = wallet.state;

    let lastUpdatedIndex = -1;
    for (const { generationIndex, genInfo, qdo } of generationUpdates) {
      // apply updates prior to the current generation index
      updatedState = updates
        .filter(({ startIndex, endIndex }) => startIndex > lastUpdatedIndex && endIndex < generationIndex)
        .reduce((state, update) => state.applyGenerationCollapsedUpdate(update.update), updatedState);

      // now, insert the generation info
      updatedState = updatedState.insertGenerationInfo(BigInt(generationIndex), genInfo, qdo.backingNight);
      lastUpdatedIndex = generationIndex;
    }

    // apply the rest of the updates
    updatedState = updates
      .filter(({ startIndex }) => startIndex > lastUpdatedIndex)
      .reduce((state, update) => state.applyGenerationCollapsedUpdate(update.update), updatedState);

    return this.applyDustUtxos(
      {
        ...wallet,
        state: updatedState,
      },
      generationUpdates,
    );
  },

  applyDustUtxos(wallet: CoreWallet, utxoUpdates: DustUtxoUpdate[]): CoreWallet {
    const updatedState = utxoUpdates.reduce(
      (state, { dustNullifier, qdo }) => state.addUtxo(dustNullifier, qdo),
      wallet.state,
    );
    return {
      ...wallet,
      state: updatedState,
      dustNullifiers: wallet.dustNullifiers.concat(
        utxoUpdates.map(({ dustNullifier, isSynced }) => ({ dustNullifier, isSynced })),
      ),
    };
  },

  applyDustCommitments(
    wallet: CoreWallet,
    newUtxos: QualifiedDustOutput[],
    collapsedCommitments: CollapsedMerkleTree[],
  ): CoreWallet {
    let updatedState = wallet.state;
    for (const { startIndex, update } of collapsedCommitments) {
      // apply utxos going before the current index
      const utxos = newUtxos.filter((utxo) => Number(utxo.mtIndex) < startIndex);
      updatedState = utxos.reduce((state, utxo) => state.insertCommitment(utxo.mtIndex, utxo, true), updatedState);
      // apply current update
      updatedState = updatedState.applyCommitmentCollapsedUpdate(update);
    }

    // check utxos after the last index
    const lastCollapsedIndex = collapsedCommitments.at(-1);
    if (lastCollapsedIndex !== undefined) {
      const utxosAfterLastIndex = newUtxos.filter((utxo) => Number(utxo.mtIndex) > lastCollapsedIndex.endIndex);
      updatedState = utxosAfterLastIndex.reduce(
        (state, utxo) => state.insertCommitment(utxo.mtIndex, utxo, true),
        updatedState,
      );
    }

    // edge-case: no collapsed commitments but new utxos
    if (!collapsedCommitments.length && newUtxos.length) {
      updatedState = newUtxos.reduce((state, utxo) => state.insertCommitment(utxo.mtIndex, utxo, true), updatedState);
    }

    return { ...wallet, state: updatedState };
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
