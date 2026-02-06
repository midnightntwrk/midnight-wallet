// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) 2025 Midnight Foundation
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
  type DustParameters,
  type DustPublicKey,
  DustSecretKey,
  type FinalizedTransaction,
  type Signature,
  type SignatureVerifyingKey,
  type UnprovenTransaction,
} from '@midnight-ntwrk/ledger-v7';
import { type ProtocolState, ProtocolVersion } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { DustAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { type Runtime, WalletBuilder } from '@midnight-ntwrk/wallet-sdk-runtime';
import { type Variant, type WalletLike } from '@midnight-ntwrk/wallet-sdk-runtime/abstractions';
import { type TransactionHistory } from '@midnight-ntwrk/wallet-sdk-shielded/v1';
import { Effect, Either, type Scope } from 'effect';
import * as rx from 'rxjs';
import { type Balance, type CoinsAndBalancesCapability, type UtxoWithFullDustDetails } from './CoinsAndBalances.js';
import { CoreWallet } from './CoreWallet.js';
import { type KeysCapability } from './Keys.js';
import { V1Tag } from './RunningV1Variant.js';
import { type SerializationCapability } from './Serialization.js';
import { type DustToken, type DustTokenFullInfo, type UtxoWithMeta } from './types/Dust.js';
import { type AnyTransaction } from './types/ledger.js';
import { type DefaultV1Configuration, type DefaultV1Variant, V1Builder } from './V1Builder.js';

export type DustWalletCapabilities = {
  serialization: SerializationCapability<CoreWallet, null, string>;
  coinsAndBalances: CoinsAndBalancesCapability<CoreWallet>;
  keys: KeysCapability<CoreWallet>;
};

export class DustWalletState {
  static readonly mapState =
    (capabilities: DustWalletCapabilities) =>
    (state: ProtocolState.ProtocolState<CoreWallet>): DustWalletState => {
      return new DustWalletState(state, capabilities);
    };

  readonly protocolVersion: ProtocolVersion.ProtocolVersion;
  readonly state: CoreWallet;
  readonly capabilities: DustWalletCapabilities;

  get totalCoins(): readonly DustToken[] {
    return this.capabilities.coinsAndBalances.getTotalCoins(this.state);
  }

  get availableCoins(): readonly DustToken[] {
    return this.capabilities.coinsAndBalances.getAvailableCoins(this.state);
  }

  get pendingCoins(): readonly DustToken[] {
    return this.capabilities.coinsAndBalances.getPendingCoins(this.state);
  }

  get publicKey(): DustPublicKey {
    return this.capabilities.keys.getPublicKey(this.state);
  }

  get address(): DustAddress {
    return this.capabilities.keys.getAddress(this.state);
  }

  get progress(): TransactionHistory.ProgressUpdate {
    return {
      appliedIndex: this.state.progress.appliedIndex,
      highestRelevantWalletIndex: this.state.progress.highestRelevantWalletIndex,
      highestIndex: this.state.progress.highestIndex,
      highestRelevantIndex: this.state.progress.highestRelevantIndex,
    };
  }

  /**
   * Transaction history for the wallet.
   * @throws Error - Not yet implemented
   */
  get transactionHistory(): never {
    throw new Error('Transaction history is not yet implemented for DustWallet');
  }

  constructor(state: ProtocolState.ProtocolState<CoreWallet>, capabilities: DustWalletCapabilities) {
    this.protocolVersion = state.version;
    this.state = state.state;
    this.capabilities = capabilities;
  }

  balance(time: Date): Balance {
    return this.capabilities.coinsAndBalances.getWalletBalance(this.state, time);
  }

  availableCoinsWithFullInfo(time: Date): readonly DustTokenFullInfo[] {
    return this.capabilities.coinsAndBalances.getAvailableCoinsWithFullInfo(this.state, time);
  }

  estimateDustGeneration(
    nightUtxos: ReadonlyArray<UtxoWithMeta>,
    currentTime: Date,
  ): ReadonlyArray<UtxoWithFullDustDetails> {
    return this.capabilities.coinsAndBalances.estimateDustGeneration(this.state, nightUtxos, currentTime);
  }

  serialize(): string {
    return this.capabilities.serialization.serialize(this.state);
  }
}

export type DustWalletAPI = {
  readonly state: rx.Observable<DustWalletState>;

  start(secretKey: DustSecretKey): Promise<void>;

  createDustGenerationTransaction(
    currentTime: Date | undefined,
    ttl: Date,
    nightUtxos: Array<UtxoWithMeta>,
    nightVerifyingKey: SignatureVerifyingKey,
    dustReceiverAddress: DustAddress | undefined,
  ): Promise<UnprovenTransaction>;

  addDustGenerationSignature(transaction: UnprovenTransaction, signature: Signature): Promise<UnprovenTransaction>;

  calculateFee(transactions: ReadonlyArray<AnyTransaction>): Promise<bigint>;

  balanceTransactions(
    secretKey: DustSecretKey,
    transactions: ReadonlyArray<AnyTransaction>,
    ttl: Date,
    currentTime?: Date,
  ): Promise<UnprovenTransaction>;

  proveTransaction(transaction: UnprovenTransaction): Promise<FinalizedTransaction>;

  serializeState(): Promise<string>;

  waitForSyncedState(allowedGap?: bigint): Promise<DustWalletState>;

  revertTransaction(transaction: AnyTransaction): Promise<void>;

  getAddress(): Promise<DustAddress>;

  stop(): Promise<void>;
};

export type DustWallet = DustWalletAPI & WalletLike.WalletLike<[Variant.VersionedVariant<DefaultV1Variant>]>;

export interface DustWalletClass extends WalletLike.BaseWalletClass<[Variant.VersionedVariant<DefaultV1Variant>]> {
  startWithSeed(seed: Uint8Array, dustParameters: DustParameters): DustWallet;

  startWithSecretKey(secretKey: DustSecretKey, dustParameters: DustParameters): DustWallet;

  restore(serializedState: string): DustWallet;
}

export type DefaultDustConfiguration = DefaultV1Configuration;

export function DustWallet(configuration: DefaultDustConfiguration): DustWalletClass {
  const BaseWallet = WalletBuilder.init()
    .withVariant(ProtocolVersion.MinSupportedVersion, new V1Builder().withDefaults())
    .build(configuration);

  return class DustWalletImplementation extends BaseWallet implements DustWallet {
    static startWithSeed(seed: Uint8Array, dustParameters: DustParameters): DustWalletImplementation {
      const dustSecretKey = DustSecretKey.fromSeed(seed);
      return DustWalletImplementation.startFirst(
        DustWalletImplementation,
        CoreWallet.initEmpty(dustParameters, dustSecretKey, configuration.networkId),
      );
    }

    static startWithSecretKey(secretKey: DustSecretKey, dustParameters: DustParameters): DustWalletImplementation {
      return DustWalletImplementation.startFirst(
        DustWalletImplementation,
        CoreWallet.initEmpty(dustParameters, secretKey, configuration.networkId),
      );
    }

    static restore(serializedState: string): DustWalletImplementation {
      const deserialized: CoreWallet = DustWalletImplementation.allVariantsRecord()
        [V1Tag].variant.deserializeState(serializedState)
        .pipe(Either.getOrThrow);
      return DustWalletImplementation.startFirst(DustWalletImplementation, deserialized);
    }

    readonly state: rx.Observable<DustWalletState>;

    constructor(runtime: Runtime.Runtime<[Variant.VersionedVariant<DefaultV1Variant>]>, scope: Scope.CloseableScope) {
      super(runtime, scope);
      this.state = this.rawState.pipe(
        rx.map(DustWalletState.mapState(DustWalletImplementation.allVariantsRecord()[V1Tag].variant)),
        rx.shareReplay({ refCount: true, bufferSize: 1 }),
      );
    }

    start(secretKey: DustSecretKey): Promise<void> {
      return this.runtime.dispatch({ [V1Tag]: (v1) => v1.startSyncInBackground(secretKey) }).pipe(Effect.runPromise);
    }

    async createDustGenerationTransaction(
      currentTime: Date | undefined,
      ttl: Date,
      nightUtxos: Array<UtxoWithMeta>,
      nightVerifyingKey: SignatureVerifyingKey,
      dustReceiverAddress: DustAddress | undefined,
    ): Promise<UnprovenTransaction> {
      return this.runtime
        .dispatch({
          [V1Tag]: (v1) =>
            v1.createDustGenerationTransaction(currentTime, ttl, nightUtxos, nightVerifyingKey, dustReceiverAddress),
        })
        .pipe(Effect.runPromise);
    }

    addDustGenerationSignature(transaction: UnprovenTransaction, signature: Signature): Promise<UnprovenTransaction> {
      return this.runtime
        .dispatch({
          [V1Tag]: (v1) => v1.addDustGenerationSignature(transaction, signature),
        })
        .pipe(Effect.runPromise);
    }

    calculateFee(transactions: ReadonlyArray<AnyTransaction>): Promise<bigint> {
      return this.runtime
        .dispatch({
          [V1Tag]: (v1) => v1.calculateFee(transactions),
        })
        .pipe(Effect.runPromise);
    }

    balanceTransactions(
      secretKey: DustSecretKey,
      transactions: ReadonlyArray<AnyTransaction>,
      ttl: Date,
      currentTime?: Date,
    ): Promise<UnprovenTransaction> {
      return this.runtime
        .dispatch({
          [V1Tag]: (v1) => v1.balanceTransactions(secretKey, transactions, ttl, currentTime),
        })
        .pipe(Effect.runPromise);
    }

    proveTransaction(transaction: UnprovenTransaction): Promise<FinalizedTransaction> {
      return this.runtime
        .dispatch({
          [V1Tag]: (v1) => v1.proveTransaction(transaction),
        })
        .pipe(Effect.runPromise);
    }

    revertTransaction(transaction: AnyTransaction): Promise<void> {
      return this.runtime
        .dispatch({
          [V1Tag]: (v1) => v1.revertTransaction(transaction),
        })
        .pipe(Effect.runPromise);
    }

    waitForSyncedState(allowedGap: bigint = 0n): Promise<DustWalletState> {
      return rx.firstValueFrom(
        this.state.pipe(rx.filter((state) => state.state.progress.isCompleteWithin(allowedGap))),
      );
    }

    /**
     * Serializes the most recent state
     * It's preferable to use [[DustWalletState.serialize]] instead, to know exactly, which state is serialized
     */
    serializeState(): Promise<string> {
      return rx.firstValueFrom(this.state).then((state) => state.serialize());
    }

    getAddress(): Promise<DustAddress> {
      return rx.firstValueFrom(this.state).then((state) => state.address);
    }
  };
}
