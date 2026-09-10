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
import { ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { createSyncProgress, type SyncProgress, type SyncProgressData } from './SyncProgress.js';
import { type PublicKey } from '../KeyStore.js';
import { UnshieldedState, type UnshieldedUpdate, type UtxoHash } from './UnshieldedState.js';
import type * as ledger from '@midnight-ntwrk/ledger-v8';
import { Either, Array as Arr, pipe } from 'effect';
import { ApplyTransactionError, RollbackUtxoError, SpendUtxoError, type WalletError } from './WalletError.js';

export type CoreWallet = Readonly<{
  state: UnshieldedState;
  publicKey: PublicKey;
  protocolVersion: ProtocolVersion.ProtocolVersion;
  progress: SyncProgress;
  networkId: string;
}>;

export const CoreWallet = {
  init(publicKey: PublicKey, networkId: string): CoreWallet {
    return {
      state: UnshieldedState.empty(),
      publicKey,
      protocolVersion: ProtocolVersion.MinSupportedVersion,
      progress: createSyncProgress(),
      networkId,
    };
  },

  restore(
    state: UnshieldedState,
    publicKey: PublicKey,
    syncProgress: Omit<SyncProgressData, 'isConnected'>,
    protocolVersion: ProtocolVersion.ProtocolVersion,
    networkId: string,
  ): CoreWallet {
    return {
      state,
      publicKey,
      protocolVersion,
      progress: createSyncProgress(syncProgress),
      networkId,
    };
  },

  updateProgress(
    wallet: CoreWallet,
    { appliedId, highestTransactionId, isConnected }: Partial<SyncProgressData>,
  ): CoreWallet {
    const progress = createSyncProgress({
      appliedId: appliedId ?? wallet.progress.appliedId,
      highestTransactionId: highestTransactionId ?? wallet.progress.highestTransactionId,
      isConnected: isConnected ?? wallet.progress.isConnected,
    });
    return { ...wallet, progress };
  },

  applyUpdate(coreWallet: CoreWallet, update: UnshieldedUpdate): Either.Either<CoreWallet, WalletError> {
    return UnshieldedState.applyUpdate(coreWallet.state, update).pipe(
      Either.map((state) => ({ ...coreWallet, state })),
      Either.mapLeft((error) => new ApplyTransactionError(error)),
    );
  },

  applyFailedUpdate(coreWallet: CoreWallet, update: UnshieldedUpdate): Either.Either<CoreWallet, WalletError> {
    return UnshieldedState.applyFailedUpdate(coreWallet.state, update).pipe(
      Either.map((state) => ({ ...coreWallet, state })),
      Either.mapLeft((error) => new ApplyTransactionError(error)),
    );
  },

  rollbackUtxo(coreWallet: CoreWallet, utxo: ledger.Utxo): Either.Either<CoreWallet, WalletError> {
    return UnshieldedState.rollbackSpendByUtxo(coreWallet.state, utxo).pipe(
      Either.map((state) => ({ ...coreWallet, state })),
      Either.mapLeft((error) => new RollbackUtxoError(error)),
    );
  },

  /** Releases every booking that has reached its expiry. See {@link UnshieldedState.expirePending}. */
  expirePending(coreWallet: CoreWallet, now: Date): CoreWallet {
    return { ...coreWallet, state: UnshieldedState.expirePending(coreWallet.state, now) };
  },

  /**
   * Releases the booked coins named by `hashes`. Unlike {@link CoreWallet.rollbackUtxo}, this needs no transaction,
   * which is what lets a caller holding only a record of the ids release them. Ids that are not booked are ignored.
   */
  revertUtxos(coreWallet: CoreWallet, hashes: ReadonlyArray<UtxoHash>): CoreWallet {
    return {
      ...coreWallet,
      state: hashes.reduce(UnshieldedState.rollbackSpendByHash, coreWallet.state),
    };
  },

  spend(coreWallet: CoreWallet, utxo: ledger.Utxo, ttl: Date): Either.Either<CoreWallet, WalletError> {
    return UnshieldedState.spendByUtxo(coreWallet.state, utxo, ttl).pipe(
      Either.map((state) => ({ ...coreWallet, state })),
      Either.mapLeft((error) => new SpendUtxoError(error)),
    );
  },

  /**
   * Books each of `utxos` for a transaction being balanced.
   *
   * @param ttl - The TTL of the transaction the coins are being booked for; it bounds every reservation taken here.
   */
  spendUtxos(
    wallet: CoreWallet,
    utxos: ReadonlyArray<ledger.Utxo>,
    ttl: Date,
  ): Either.Either<[ReadonlyArray<ledger.Utxo>, CoreWallet], WalletError> {
    return pipe(
      utxos,
      Arr.reduce(
        Either.right([[], wallet.state]) as Either.Either<[ledger.Utxo[], UnshieldedState], WalletError>,
        (acc, utxoToSpend) =>
          acc.pipe(
            Either.flatMap(([accUtxos, state]) =>
              UnshieldedState.spendByUtxo(state, utxoToSpend, ttl).pipe(
                Either.map(
                  (nextState) => [accUtxos.concat([utxoToSpend]), nextState] as [ledger.Utxo[], UnshieldedState],
                ),
                Either.mapLeft((error) => new SpendUtxoError(error)),
              ),
            ),
          ),
      ),
      Either.map(
        ([spentUtxos, state]) => [spentUtxos, { ...wallet, state }] as [ReadonlyArray<ledger.Utxo>, CoreWallet],
      ),
    );
  },
};
