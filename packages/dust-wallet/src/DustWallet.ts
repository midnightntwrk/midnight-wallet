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
  type DustParameters,
  type DustPublicKey,
  DustSecretKey,
  type Signature,
  type SignatureVerifyingKey,
  type UnprovenTransaction,
} from '@midnight-ntwrk/ledger-v8';
import { type ProtocolState, ProtocolVersion, SyncProgress } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { DustAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { type Runtime, WalletBuilder } from '@midnight-ntwrk/wallet-sdk-runtime';
import { type Variant, type VariantBuilder, type WalletLike } from '@midnight-ntwrk/wallet-sdk-runtime/abstractions';
import { Effect, Either, type Scope } from 'effect';
import * as rx from 'rxjs';
import { type Balance, type CoinsAndBalancesCapability, type UtxoWithFullDustDetails } from './v1/CoinsAndBalances.js';
import { CoreWallet } from './v1/CoreWallet.js';
import { type KeysCapability } from './v1/Keys.js';
import { V1Tag } from './v1/RunningV1Variant.js';
import { type SerializationCapability } from './v1/Serialization.js';
import { type Dust, type DustFullInfo, type UtxoWithMeta } from './v1/types/Dust.js';
import { type AnyTransaction } from './v1/types/ledger.js';
import {
  type BaseV1Configuration,
  type DefaultV1Configuration,
  type DefaultV1Variant,
  V1Builder,
  type V1Variant,
} from './v1/V1Builder.js';

export type DustWalletCapabilities<TSerialized = string> = {
  serialization: SerializationCapability<CoreWallet, null, TSerialized>;
  coinsAndBalances: CoinsAndBalancesCapability<CoreWallet>;
  keys: KeysCapability<CoreWallet>;
};

export class DustWalletState<TSerialized = string> {
  static readonly mapState =
    <TSerialized = string>(capabilities: DustWalletCapabilities<TSerialized>) =>
    (state: ProtocolState.ProtocolState<CoreWallet>): DustWalletState<TSerialized> => {
      return new DustWalletState(state, capabilities);
    };

  readonly protocolVersion: ProtocolVersion.ProtocolVersion;
  readonly state: CoreWallet;
  readonly capabilities: DustWalletCapabilities<TSerialized>;

  get totalCoins(): readonly Dust[] {
    return this.capabilities.coinsAndBalances.getTotalCoins(this.state);
  }

  get availableCoins(): readonly Dust[] {
    return this.capabilities.coinsAndBalances.getAvailableCoins(this.state);
  }

  get pendingCoins(): readonly Dust[] {
    return this.capabilities.coinsAndBalances.getPendingCoins(this.state);
  }

  get publicKey(): DustPublicKey {
    return this.capabilities.keys.getPublicKey(this.state);
  }

  get address(): DustAddress {
    return this.capabilities.keys.getAddress(this.state);
  }

  get progress(): SyncProgress.SyncProgress {
    return this.state.progress;
  }

  /**
   * Transaction history for the wallet.
   * @throws Error - Not yet implemented
   */
  get transactionHistory(): never {
    throw new Error('Transaction history is not yet implemented for DustWallet');
  }

  constructor(state: ProtocolState.ProtocolState<CoreWallet>, capabilities: DustWalletCapabilities<TSerialized>) {
    this.protocolVersion = state.version;
    this.state = state.state;
    this.capabilities = capabilities;
  }

  balance(time: Date): Balance {
    return this.capabilities.coinsAndBalances.getWalletBalance(this.state, time);
  }

  availableCoinsWithFullInfo(time: Date): readonly DustFullInfo[] {
    return this.capabilities.coinsAndBalances.getAvailableCoinsWithFullInfo(this.state, time);
  }

  estimateDustGeneration(
    nightUtxos: ReadonlyArray<UtxoWithMeta>,
    currentTime: Date,
  ): ReadonlyArray<UtxoWithFullDustDetails> {
    return this.capabilities.coinsAndBalances.estimateDustGeneration(this.state, nightUtxos, currentTime);
  }

  serialize(): TSerialized {
    return this.capabilities.serialization.serialize(this.state);
  }
}

export type DustWalletAPI<TSerialized = string> = {
  readonly state: rx.Observable<DustWalletState<TSerialized>>;

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

  estimateFee(
    secretKey: DustSecretKey,
    transactions: ReadonlyArray<AnyTransaction>,
    ttl?: Date,
    currentTime?: Date,
  ): Promise<bigint>;

  balanceTransactions(
    secretKey: DustSecretKey,
    transactions: ReadonlyArray<AnyTransaction>,
    ttl: Date,
    currentTime?: Date,
  ): Promise<UnprovenTransaction>;

  serializeState(): Promise<TSerialized>;

  waitForSyncedState(allowedGap?: bigint): Promise<DustWalletState<TSerialized>>;

  revertTransaction(transaction: AnyTransaction): Promise<void>;

  getAddress(): Promise<DustAddress>;

  stop(): Promise<void>;
};

export type CustomizedDustWallet<
  TStartAux = DustSecretKey,
  TSyncUpdate = unknown,
  TSerialized = string,
> = DustWalletAPI<TSerialized> &
  WalletLike.WalletLike<[Variant.VersionedVariant<V1Variant<TSerialized, TSyncUpdate, unknown, TStartAux>>]>;

export interface CustomizedDustWalletClass<
  TStartAux = DustSecretKey,
  TSyncUpdate = unknown,
  TSerialized = string,
  TConfig extends BaseV1Configuration = DefaultDustConfiguration,
> extends WalletLike.BaseWalletClass<
  [Variant.VersionedVariant<V1Variant<TSerialized, TSyncUpdate, unknown, TStartAux>>]
> {
  configuration: TConfig;
  startWithSeed(
    seed: Uint8Array,
    dustParameters: DustParameters,
  ): CustomizedDustWallet<TStartAux, TSyncUpdate, TSerialized>;
  startWithSecretKey(
    secretKey: DustSecretKey,
    dustParameters: DustParameters,
  ): CustomizedDustWallet<TStartAux, TSyncUpdate, TSerialized>;
  restore(serializedState: TSerialized): CustomizedDustWallet<TStartAux, TSyncUpdate, TSerialized>;
}

export type DustWallet = DustWalletAPI & WalletLike.WalletLike<[Variant.VersionedVariant<DefaultV1Variant>]>;

export interface DustWalletClass extends WalletLike.BaseWalletClass<[Variant.VersionedVariant<DefaultV1Variant>]> {
  startWithSeed(seed: Uint8Array, dustParameters: DustParameters): DustWallet;

  startWithSecretKey(secretKey: DustSecretKey, dustParameters: DustParameters): DustWallet;

  restore(serializedState: string): DustWallet;
}

export type DefaultDustConfiguration = DefaultV1Configuration;

export function DustWallet(configuration: DefaultDustConfiguration): DustWalletClass {
  return CustomDustWallet(configuration, new V1Builder().withDefaults());
}

export function CustomDustWallet<
  TConfig extends BaseV1Configuration = DefaultDustConfiguration,
  TStartAux = DustSecretKey,
  TSyncUpdate = unknown,
  TSerialized = string,
>(
  configuration: TConfig,
  builder: VariantBuilder.VariantBuilder<V1Variant<TSerialized, TSyncUpdate, unknown, TStartAux>, TConfig>,
): CustomizedDustWalletClass<TStartAux, TSyncUpdate, TSerialized, TConfig> {
  const buildArgs = [configuration] as WalletBuilder.BuildArguments<
    [
      VariantBuilder.VersionedVariantBuilder<
        VariantBuilder.VariantBuilder<V1Variant<TSerialized, TSyncUpdate, unknown, TStartAux>, TConfig>
      >,
    ]
  >;
  const BaseWallet = WalletBuilder.init()
    .withVariant(ProtocolVersion.MinSupportedVersion, builder)
    .build(...buildArgs) as WalletLike.BaseWalletClass<
    [Variant.VersionedVariant<V1Variant<TSerialized, TSyncUpdate, unknown, TStartAux>>],
    TConfig
  >;

  return class CustomDustWalletImplementation
    extends BaseWallet
    implements CustomizedDustWallet<TStartAux, TSyncUpdate, TSerialized>
  {
    static startWithSeed(seed: Uint8Array, dustParameters: DustParameters): CustomDustWalletImplementation {
      const dustSecretKey = DustSecretKey.fromSeed(seed);
      return CustomDustWalletImplementation.startFirst(
        CustomDustWalletImplementation,
        CoreWallet.initEmpty(dustParameters, dustSecretKey, configuration.networkId),
      );
    }

    static startWithSecretKey(
      secretKey: DustSecretKey,
      dustParameters: DustParameters,
    ): CustomDustWalletImplementation {
      return CustomDustWalletImplementation.startFirst(
        CustomDustWalletImplementation,
        CoreWallet.initEmpty(dustParameters, secretKey, configuration.networkId),
      );
    }

    static restore(serializedState: TSerialized): CustomDustWalletImplementation {
      const deserialized: CoreWallet = CustomDustWalletImplementation.allVariantsRecord()
        [V1Tag].variant.deserializeState(serializedState)
        .pipe(Either.getOrThrow);
      return CustomDustWalletImplementation.startFirst(CustomDustWalletImplementation, deserialized);
    }

    readonly state: rx.Observable<DustWalletState<TSerialized>>;

    constructor(
      runtime: Runtime.Runtime<[Variant.VersionedVariant<V1Variant<TSerialized, TSyncUpdate, unknown, TStartAux>>]>,
      scope: Scope.CloseableScope,
    ) {
      super(runtime, scope);
      this.state = this.rawState.pipe(
        rx.map(
          DustWalletState.mapState<TSerialized>(CustomDustWalletImplementation.allVariantsRecord()[V1Tag].variant),
        ),
        rx.shareReplay({ refCount: true, bufferSize: 1 }),
      );
    }

    start(secretKey: DustSecretKey): Promise<void> {
      return this.runtime
        .dispatch({ [V1Tag]: (v1) => v1.startSyncInBackground(secretKey as TStartAux) })
        .pipe(Effect.runPromise);
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

    estimateFee(
      secretKey: DustSecretKey,
      transactions: ReadonlyArray<AnyTransaction>,
      ttl?: Date,
      currentTime?: Date,
    ): Promise<bigint> {
      const effectiveTtl = ttl ?? new Date(Date.now() + 60 * 60 * 1000);
      return this.runtime
        .dispatch({
          [V1Tag]: (v1) => v1.estimateFee(secretKey, transactions, effectiveTtl, currentTime),
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

    revertTransaction(transaction: AnyTransaction): Promise<void> {
      return this.runtime
        .dispatch({
          [V1Tag]: (v1) => v1.revertTransaction(transaction),
        })
        .pipe(Effect.runPromise);
    }

    waitForSyncedState(allowedGap: bigint = 0n): Promise<DustWalletState<TSerialized>> {
      return rx.firstValueFrom(
        this.state.pipe(rx.filter((state) => state.state.progress.isCompleteWithin(allowedGap))),
      );
    }

    serializeState(): Promise<TSerialized> {
      return rx.firstValueFrom(this.state).then((state) => state.serialize());
    }

    getAddress(): Promise<DustAddress> {
      return rx.firstValueFrom(this.state).then((state) => state.address);
    }
  };
}
