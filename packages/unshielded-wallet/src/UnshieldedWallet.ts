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
import { ProtocolState, ProtocolVersion } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { BaseV1Configuration, DefaultV1Configuration, V1Builder, V1Tag, V1Variant, CoreWallet } from './v1/index.js';
import * as ledger from '@midnight-ntwrk/ledger-v7';
import { Effect, Either, Scope } from 'effect';
import * as rx from 'rxjs';
import { SerializationCapability } from './v1/Serialization.js';
import { TransactionHistoryService } from './v1/TransactionHistory.js';
import { CoinsAndBalancesCapability } from './v1/CoinsAndBalances.js';
import { KeysCapability } from './v1/Keys.js';
import { TokenTransfer } from './v1/Transacting.js';
import { WalletSyncUpdate } from './v1/SyncSchema.js';
import { UtxoWithMeta } from './v1/UnshieldedState.js';
import { Variant, VariantBuilder, WalletLike } from '@midnight-ntwrk/wallet-sdk-runtime/abstractions';
import { Runtime, WalletBuilder } from '@midnight-ntwrk/wallet-sdk-runtime';
import { PublicKey } from './KeyStore.js';
import { SyncProgress } from './v1/SyncProgress.js';
import { UnshieldedUpdate } from './v1/SyncSchema.js';
import { UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';

export type UnshieldedWalletCapabilities<TSerialized = string> = {
  serialization: SerializationCapability<CoreWallet, TSerialized>;
  coinsAndBalances: CoinsAndBalancesCapability<CoreWallet>;
  keys: KeysCapability<CoreWallet>;
  transactionHistory: TransactionHistoryService<UnshieldedUpdate>;
};

export class UnshieldedWalletState<TSerialized = string> {
  static readonly mapState =
    <TSerialized = string>(capabilities: UnshieldedWalletCapabilities<TSerialized>) =>
    (state: ProtocolState.ProtocolState<CoreWallet>): UnshieldedWalletState<TSerialized> => {
      return new UnshieldedWalletState(state, capabilities);
    };

  readonly protocolVersion: ProtocolVersion.ProtocolVersion;
  readonly state: CoreWallet;
  readonly capabilities: UnshieldedWalletCapabilities<TSerialized>;

  get balances(): Record<ledger.RawTokenType, bigint> {
    return this.capabilities.coinsAndBalances.getAvailableBalances(this.state);
  }

  get totalCoins(): readonly UtxoWithMeta[] {
    return this.capabilities.coinsAndBalances.getTotalCoins(this.state);
  }

  get availableCoins(): readonly UtxoWithMeta[] {
    return this.capabilities.coinsAndBalances.getAvailableCoins(this.state);
  }

  get pendingCoins(): readonly UtxoWithMeta[] {
    return this.capabilities.coinsAndBalances.getPendingCoins(this.state);
  }

  get address(): UnshieldedAddress {
    return this.capabilities.keys.getAddress(this.state);
  }

  get progress(): SyncProgress {
    return this.state.progress;
  }

  get transactionHistory(): TransactionHistoryService<UnshieldedUpdate> {
    return this.capabilities.transactionHistory;
  }

  constructor(state: ProtocolState.ProtocolState<CoreWallet>, capabilities: UnshieldedWalletCapabilities<TSerialized>) {
    this.protocolVersion = state.version;
    this.state = state.state;
    this.capabilities = capabilities;
  }

  serialize(): TSerialized {
    return this.capabilities.serialization.serialize(this.state);
  }
}

export type UnshieldedWallet = CustomizedUnshieldedWallet<ledger.FinalizedTransaction, WalletSyncUpdate, string>;

export type UnshieldedWalletClass = CustomizedUnshieldedWalletClass<
  ledger.FinalizedTransaction,
  WalletSyncUpdate,
  string
>;

export interface CustomizedUnshieldedWallet<
  TTransaction = ledger.Transaction<ledger.SignatureEnabled, ledger.Proofish, ledger.Bindingish>,
  TSyncUpdate = WalletSyncUpdate,
  TSerialized = string,
> extends WalletLike.WalletLike<[Variant.VersionedVariant<V1Variant<TSerialized, TSyncUpdate, TTransaction>>]> {
  readonly state: rx.Observable<UnshieldedWalletState<TSerialized>>;

  start(): Promise<void>;

  balanceTransaction(
    tx: ledger.Transaction<ledger.SignatureEnabled, ledger.Proofish, ledger.Bindingish>,
  ): Promise<ledger.Transaction<ledger.SignatureEnabled, ledger.Proofish, ledger.Bindingish>>;

  transferTransaction(outputs: readonly TokenTransfer[], ttl: Date): Promise<ledger.UnprovenTransaction>;

  initSwap(
    desiredInputs: Record<ledger.RawTokenType, bigint>,
    desiredOutputs: readonly TokenTransfer[],
    ttl: Date,
  ): Promise<ledger.UnprovenTransaction>;

  signTransaction(
    transaction: ledger.UnprovenTransaction,
    signSegment: (data: Uint8Array) => ledger.Signature,
  ): Promise<ledger.UnprovenTransaction>;

  serializeState(): Promise<TSerialized>;

  waitForSyncedState(allowedGap?: bigint): Promise<UnshieldedWalletState<TSerialized>>;

  getAddress(): Promise<UnshieldedAddress>;
}

export interface CustomizedUnshieldedWalletClass<
  TTransaction = ledger.Transaction<ledger.SignatureEnabled, ledger.Proofish, ledger.Bindingish>,
  TSyncUpdate = WalletSyncUpdate,
  TSerialized = string,
  TConfig extends BaseV1Configuration = DefaultV1Configuration,
> extends WalletLike.BaseWalletClass<[Variant.VersionedVariant<V1Variant<TSerialized, TSyncUpdate, TTransaction>>]> {
  configuration: TConfig;
  startWithPublicKey(publicKey: PublicKey): CustomizedUnshieldedWallet<TTransaction, TSyncUpdate, TSerialized>;
  restore(serializedState: TSerialized): CustomizedUnshieldedWallet<TTransaction, TSyncUpdate, TSerialized>;
}

export function UnshieldedWallet(configuration: DefaultV1Configuration): UnshieldedWalletClass {
  return CustomUnshieldedWallet(configuration, new V1Builder().withDefaults());
}

export function CustomUnshieldedWallet<
  TConfig extends BaseV1Configuration = DefaultV1Configuration,
  TTransaction = ledger.Transaction<ledger.SignatureEnabled, ledger.Proofish, ledger.Bindingish>,
  TSyncUpdate = WalletSyncUpdate,
  TSerialized = string,
>(
  configuration: TConfig,
  builder: VariantBuilder.VariantBuilder<V1Variant<TSerialized, TSyncUpdate, TTransaction>, TConfig>,
): CustomizedUnshieldedWalletClass<TTransaction, TSyncUpdate, TSerialized, TConfig> {
  const buildArgs = [configuration] as WalletBuilder.BuildArguments<
    [
      VariantBuilder.VersionedVariantBuilder<
        VariantBuilder.VariantBuilder<V1Variant<TSerialized, TSyncUpdate, TTransaction>, TConfig>
      >,
    ]
  >;
  const BaseWallet = WalletBuilder.init()
    .withVariant(ProtocolVersion.MinSupportedVersion, builder)
    .build(...buildArgs) as WalletLike.BaseWalletClass<
    [Variant.VersionedVariant<V1Variant<TSerialized, TSyncUpdate, TTransaction>>],
    TConfig
  >;

  return class CustomUnshieldedWalletImplementation
    extends BaseWallet
    implements CustomizedUnshieldedWallet<TTransaction, TSyncUpdate, TSerialized>
  {
    static startWithPublicKey(publicKeys: PublicKey): CustomUnshieldedWalletImplementation {
      return CustomUnshieldedWalletImplementation.startFirst(
        CustomUnshieldedWalletImplementation,
        CoreWallet.init(publicKeys, configuration.networkId),
      );
    }

    static restore(serializedState: TSerialized): CustomUnshieldedWalletImplementation {
      const deserialized: CoreWallet = CustomUnshieldedWalletImplementation.allVariantsRecord()
        [V1Tag].variant.deserializeState(serializedState)
        .pipe(Either.getOrThrow);
      return CustomUnshieldedWalletImplementation.startFirst(CustomUnshieldedWalletImplementation, deserialized);
    }

    readonly state: rx.Observable<UnshieldedWalletState<TSerialized>>;

    constructor(
      runtime: Runtime.Runtime<[Variant.VersionedVariant<V1Variant<TSerialized, TSyncUpdate, TTransaction>>]>,
      scope: Scope.CloseableScope,
    ) {
      super(runtime, scope);
      this.state = this.rawState.pipe(
        rx.map(
          UnshieldedWalletState.mapState<TSerialized>(
            CustomUnshieldedWalletImplementation.allVariantsRecord()[V1Tag].variant,
          ),
        ),
        rx.shareReplay({ refCount: true, bufferSize: 1 }),
      );
    }

    start(): Promise<void> {
      return this.runtime.dispatch({ [V1Tag]: (v1) => v1.startSyncInBackground() }).pipe(Effect.runPromise);
    }

    balanceTransaction(
      tx: ledger.Transaction<ledger.SignatureEnabled, ledger.Proofish, ledger.Bindingish>,
    ): Promise<ledger.Transaction<ledger.SignatureEnabled, ledger.Proofish, ledger.Bindingish>> {
      return this.runtime
        .dispatch({
          [V1Tag]: (v1) => v1.balanceTransaction(tx),
        })
        .pipe(Effect.runPromise);
    }

    transferTransaction(outputs: readonly TokenTransfer[], ttl: Date): Promise<ledger.UnprovenTransaction> {
      return this.runtime
        .dispatch({
          [V1Tag]: (v1) => v1.transferTransaction(outputs, ttl),
        })
        .pipe(Effect.runPromise);
    }

    initSwap(
      desiredInputs: Record<ledger.RawTokenType, bigint>,
      desiredOutputs: readonly TokenTransfer[],
      ttl: Date,
    ): Promise<ledger.UnprovenTransaction> {
      return this.runtime
        .dispatch({ [V1Tag]: (v1) => v1.initSwap(desiredInputs, desiredOutputs, ttl) })
        .pipe(Effect.runPromise);
    }

    signTransaction(
      transaction: ledger.UnprovenTransaction,
      signSegment: (data: Uint8Array) => ledger.Signature,
    ): Promise<ledger.UnprovenTransaction> {
      return this.runtime
        .dispatch({
          [V1Tag]: (v1) => v1.signTransaction(transaction, signSegment),
        })
        .pipe(Effect.runPromise);
    }

    waitForSyncedState(allowedGap: bigint = 0n): Promise<UnshieldedWalletState<TSerialized>> {
      return rx.firstValueFrom(
        this.state.pipe(rx.filter((state) => state.state.progress.isCompleteWithin(allowedGap))),
      );
    }

    /**
     * Serializes the most recent state
     * It's preferable to use [[UnshieldedWalletState.serialize]] instead, to know exactly, which state is serialized
     */
    serializeState(): Promise<TSerialized> {
      return rx.firstValueFrom(this.state).then((state) => state.serialize());
    }

    getAddress(): Promise<UnshieldedAddress> {
      return rx.firstValueFrom(this.state).then((state) => state.address);
    }
  };
}
