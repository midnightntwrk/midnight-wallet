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
} from '@midnight-ntwrk/ledger-v8';
import { ProtocolVersion, type SnapshotFormat, SyncProgress } from '@midnightntwrk/wallet-sdk-abstractions';
import { Array as Arr, Option, pipe } from 'effect';
import { type Dust, type DustWithNullifier } from './types/Dust.js';
import { type CoinWithValue } from './CoinsAndBalances.js';
import { type NetworkId, type UnprovenDustSpend } from './types/ledger.js';

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
    pendingDust: Array<DustWithNullifier>,
    beforeTtls: DustLocalState,
    afterTtls: DustLocalState,
    spentNonces: ReadonlyArray<DustNonce>,
    time: Date,
  ): Array<DustWithNullifier> {
    if (pendingDust.length === 0) return pendingDust;
    const spent = new Set(spentNonces);
    const wholeSeconds = (date: Date): number => Math.floor(date.getTime() / 1000);
    const backUnlocked = (coin: DustWithNullifier): boolean =>
      afterTtls.findUtxoByNullifier(coin.nullifier) !== undefined;
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
    return pendingDust.filter((coin) => !spent.has(coin.nonce) && !backUnlocked(coin) && !decayedAway(coin));
  },

  /**
   * Releases the pending Dust coins a reverted transaction spent, and only those.
   *
   * @remarks
   *   Only for a transaction whose Dust spends never ran on chain: one never included, or one that failed outright. A
   *   partially successful transaction ran its guaranteed segment, where every Dust spend sits, so its coins are spent
   *   and are settled by sync instead. Each coin is put back unlocked. `processTtls` cannot target coins: run at the
   *   end of the grace period, it would also drop every coin that decays to nothing by then and release coins other
   *   pending transactions hold.
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
    const spentNullifiers = new Set(
      [...(tx.intents?.values() ?? [])].flatMap((intent) =>
        (intent.dustActions?.spends ?? []).map((spend) => spend.oldNullifier),
      ),
    );
    const [kept, released] = Arr.partition(wallet.pendingDust, (coin) => spentNullifiers.has(coin.nullifier));

    return {
      ...wallet,
      state: released.reduce((state, { nullifier, ...coin }) => state.addUtxo(nullifier, coin), wallet.state),
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
