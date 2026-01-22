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
import { type ProtocolState, ProtocolVersion } from '@midnight-ntwrk/wallet-sdk-abstractions';
import {
  type BaseV1Configuration,
  type DefaultV1Configuration,
  V1Builder,
  V1Tag,
  type V1Variant,
  CoreWallet,
} from './v1/index.js';
import * as ledger from '@midnight-ntwrk/ledger-v7';
import { Effect, Either, type Scope } from 'effect';
import * as rx from 'rxjs';
import { type BalancingResult } from './v1/Transacting.js';
import { type SerializationCapability } from './v1/Serialization.js';
import { type ProgressUpdate, type TransactionHistoryCapability } from './v1/TransactionHistory.js';
import { type AvailableCoin, type CoinsAndBalancesCapability, type PendingCoin } from './v1/CoinsAndBalances.js';
import { type KeysCapability } from './v1/Keys.js';
import {
  type ShieldedAddress,
  type ShieldedCoinPublicKey,
  type ShieldedEncryptionPublicKey,
} from '@midnight-ntwrk/wallet-sdk-address-format';
import { type TokenTransfer } from './v1/Transacting.js';
import { type WalletSyncUpdate } from './v1/Sync.js';
import { type Variant, type VariantBuilder, type WalletLike } from '@midnight-ntwrk/wallet-sdk-runtime/abstractions';
import { type Runtime, WalletBuilder } from '@midnight-ntwrk/wallet-sdk-runtime';

export type ShieldedWalletCapabilities<TSerialized = string, TTransaction = ledger.FinalizedTransaction> = {
  serialization: SerializationCapability<CoreWallet, null, TSerialized>;
  coinsAndBalances: CoinsAndBalancesCapability<CoreWallet>;
  keys: KeysCapability<CoreWallet>;
  transactionHistory: TransactionHistoryCapability<CoreWallet, TTransaction>;
};

export type UnboundTransaction = ledger.Transaction<ledger.SignatureEnabled, ledger.Proof, ledger.PreBinding>;

export class ShieldedWalletState<TSerialized = string, TTransaction = ledger.FinalizedTransaction> {
  static readonly mapState =
    <TSerialized = string, TTransaction = ledger.FinalizedTransaction>(
      capabilities: ShieldedWalletCapabilities<TSerialized, TTransaction>,
    ) =>
    (state: ProtocolState.ProtocolState<CoreWallet>): ShieldedWalletState<TSerialized, TTransaction> => {
      return new ShieldedWalletState(state, capabilities);
    };

  readonly protocolVersion: ProtocolVersion.ProtocolVersion;
  readonly state: CoreWallet;
  readonly capabilities: ShieldedWalletCapabilities<TSerialized, TTransaction>;

  get balances(): Record<ledger.RawTokenType, bigint> {
    return this.capabilities.coinsAndBalances.getAvailableBalances(this.state);
  }

  get totalCoins(): readonly (AvailableCoin | PendingCoin)[] {
    return this.capabilities.coinsAndBalances.getTotalCoins(this.state);
  }

  get availableCoins(): readonly AvailableCoin[] {
    return this.capabilities.coinsAndBalances.getAvailableCoins(this.state);
  }

  get pendingCoins(): readonly PendingCoin[] {
    return this.capabilities.coinsAndBalances.getPendingCoins(this.state);
  }

  get coinPublicKey(): ShieldedCoinPublicKey {
    return this.capabilities.keys.getCoinPublicKey(this.state);
  }

  get encryptionPublicKey(): ShieldedEncryptionPublicKey {
    return this.capabilities.keys.getEncryptionPublicKey(this.state);
  }

  get address(): ShieldedAddress {
    return this.capabilities.keys.getAddress(this.state);
  }

  get progress(): ProgressUpdate {
    return this.capabilities.transactionHistory.progress(this.state);
  }

  get transactionHistory(): readonly TTransaction[] {
    return this.capabilities.transactionHistory.transactionHistory(this.state);
  }

  constructor(
    state: ProtocolState.ProtocolState<CoreWallet>,
    capabilities: ShieldedWalletCapabilities<TSerialized, TTransaction>,
  ) {
    this.protocolVersion = state.version;
    this.state = state.state;
    this.capabilities = capabilities;
  }

  serialize(): TSerialized {
    return this.capabilities.serialization.serialize(this.state);
  }
}

export type ShieldedWallet = CustomizedShieldedWallet<
  ledger.ZswapSecretKeys,
  ledger.FinalizedTransaction,
  WalletSyncUpdate,
  string
>;

export type ShieldedWalletClass = CustomizedShieldedWalletClass<
  ledger.ZswapSecretKeys,
  ledger.FinalizedTransaction,
  WalletSyncUpdate,
  string
>;

export type ShieldedWalletAPI<
  TStartAux = ledger.ZswapSecretKeys,
  TTransaction = ledger.FinalizedTransaction,
  TSerialized = string,
> = {
  readonly state: rx.Observable<ShieldedWalletState<TSerialized, TTransaction>>;

  start(secretKeys: TStartAux): Promise<void>;

  // we can balance bound and unbound txs
  balanceTransaction(
    secretKeys: ledger.ZswapSecretKeys,
    tx: ledger.Transaction<ledger.Signaturish, ledger.Proofish, ledger.Bindingish>,
  ): Promise<BalancingResult>;

  transferTransaction(
    secretKeys: ledger.ZswapSecretKeys,
    outputs: readonly TokenTransfer[],
  ): Promise<ledger.UnprovenTransaction>;

  initSwap(
    secretKeys: ledger.ZswapSecretKeys,
    desiredInputs: Record<ledger.RawTokenType, bigint>,
    desiredOutputs: readonly TokenTransfer[],
  ): Promise<ledger.UnprovenTransaction>;

  finalizeTransaction(transaction: ledger.UnprovenTransaction): Promise<TTransaction>;

  serializeState(): Promise<TSerialized>;

  waitForSyncedState(allowedGap?: bigint): Promise<ShieldedWalletState<TSerialized, TTransaction>>;

  getAddress(): Promise<ShieldedAddress>;

  revertTransaction(
    transaction: ledger.Transaction<ledger.Signaturish, ledger.Proofish, ledger.Bindingish>,
  ): Promise<void>;

  stop(): Promise<void>;
};

export type CustomizedShieldedWallet<
  TStartAux = ledger.ZswapSecretKeys,
  TTransaction = ledger.FinalizedTransaction,
  TSyncUpdate = WalletSyncUpdate,
  TSerialized = string,
> = ShieldedWalletAPI<TStartAux, TTransaction, TSerialized> &
  WalletLike.WalletLike<[Variant.VersionedVariant<V1Variant<TSerialized, TSyncUpdate, TTransaction, TStartAux>>]>;

export type DefaultShieldedConfiguration = DefaultV1Configuration;

export interface CustomizedShieldedWalletClass<
  TStartAux = ledger.ZswapSecretKeys,
  TTransaction = ledger.FinalizedTransaction,
  TSyncUpdate = WalletSyncUpdate,
  TSerialized = string,
  TConfig extends BaseV1Configuration = DefaultShieldedConfiguration,
> extends WalletLike.BaseWalletClass<
  [Variant.VersionedVariant<V1Variant<TSerialized, TSyncUpdate, TTransaction, TStartAux>>]
> {
  configuration: TConfig;
  startWithShieldedSeed(seed: Uint8Array): CustomizedShieldedWallet<TStartAux, TTransaction, TSyncUpdate, TSerialized>;
  startWithSecretKeys(
    secretKeys: ledger.ZswapSecretKeys,
  ): CustomizedShieldedWallet<TStartAux, TTransaction, TSyncUpdate, TSerialized>;
  restore(serializedState: TSerialized): CustomizedShieldedWallet<TStartAux, TTransaction, TSyncUpdate, TSerialized>;
}

export function ShieldedWallet(configuration: DefaultV1Configuration): ShieldedWalletClass {
  return CustomShieldedWallet(configuration, new V1Builder().withDefaults());
}

export function CustomShieldedWallet<
  TConfig extends BaseV1Configuration = DefaultV1Configuration,
  TStartAux = ledger.ZswapSecretKeys,
  TTransaction = ledger.FinalizedTransaction,
  TSyncUpdate = WalletSyncUpdate,
  TSerialized = string,
>(
  configuration: TConfig,
  builder: VariantBuilder.VariantBuilder<V1Variant<TSerialized, TSyncUpdate, TTransaction, TStartAux>, TConfig>,
): CustomizedShieldedWalletClass<TStartAux, TTransaction, TSyncUpdate, TSerialized, TConfig> {
  const buildArgs = [configuration] as WalletBuilder.BuildArguments<
    [
      VariantBuilder.VersionedVariantBuilder<
        VariantBuilder.VariantBuilder<V1Variant<TSerialized, TSyncUpdate, TTransaction, TStartAux>, TConfig>
      >,
    ]
  >;
  const BaseWallet = WalletBuilder.init()
    .withVariant(ProtocolVersion.MinSupportedVersion, builder)
    .build(...buildArgs) as WalletLike.BaseWalletClass<
    [Variant.VersionedVariant<V1Variant<TSerialized, TSyncUpdate, TTransaction, TStartAux>>],
    TConfig
  >;

  return class CustomShieldedWalletImplementation
    extends BaseWallet
    implements CustomizedShieldedWallet<TStartAux, TTransaction, TSyncUpdate, TSerialized>
  {
    static startWithSecretKeys(secretKeys: ledger.ZswapSecretKeys): CustomShieldedWalletImplementation {
      return CustomShieldedWalletImplementation.startFirst(
        CustomShieldedWalletImplementation,
        CoreWallet.initEmpty(secretKeys, CustomShieldedWalletImplementation.configuration.networkId),
      );
    }

    static startWithShieldedSeed(seed: Uint8Array): CustomShieldedWalletImplementation {
      const secretKeys: ledger.ZswapSecretKeys = ledger.ZswapSecretKeys.fromSeed(seed);
      return CustomShieldedWalletImplementation.startWithSecretKeys(secretKeys);
    }

    static restore(serializedState: TSerialized): CustomShieldedWalletImplementation {
      const deserialized: CoreWallet = CustomShieldedWalletImplementation.allVariantsRecord()
        [V1Tag].variant.deserializeState(serializedState)
        .pipe(Either.getOrThrow);
      return CustomShieldedWalletImplementation.startFirst(CustomShieldedWalletImplementation, deserialized);
    }

    readonly state: rx.Observable<ShieldedWalletState<TSerialized, TTransaction>>;

    constructor(
      runtime: Runtime.Runtime<
        [Variant.VersionedVariant<V1Variant<TSerialized, TSyncUpdate, TTransaction, TStartAux>>]
      >,
      scope: Scope.CloseableScope,
    ) {
      super(runtime, scope);
      this.state = this.rawState.pipe(
        rx.map(
          ShieldedWalletState.mapState<TSerialized, TTransaction>(
            CustomShieldedWalletImplementation.allVariantsRecord()[V1Tag].variant,
          ),
        ),
        rx.shareReplay({ refCount: true, bufferSize: 1 }),
      );
    }

    start(secretKeys: TStartAux): Promise<void> {
      return this.runtime.dispatch({ [V1Tag]: (v1) => v1.startSyncInBackground(secretKeys) }).pipe(Effect.runPromise);
    }

    balanceTransaction(
      secretKeys: ledger.ZswapSecretKeys,
      tx: ledger.Transaction<ledger.Signaturish, ledger.Proofish, ledger.Bindingish>,
    ): Promise<BalancingResult> {
      return this.runtime
        .dispatch({
          [V1Tag]: (v1) => v1.balanceTransaction(secretKeys, tx),
        })
        .pipe(Effect.runPromise);
    }

    transferTransaction(
      secretKeys: ledger.ZswapSecretKeys,
      outputs: readonly TokenTransfer[],
    ): Promise<ledger.UnprovenTransaction> {
      return this.runtime
        .dispatch({
          [V1Tag]: (v1) => v1.transferTransaction(secretKeys, outputs),
        })
        .pipe(Effect.runPromise);
    }

    initSwap(
      secretKeys: ledger.ZswapSecretKeys,
      desiredInputs: Record<ledger.RawTokenType, bigint>,
      desiredOutputs: readonly TokenTransfer[],
    ): Promise<ledger.UnprovenTransaction> {
      return this.runtime
        .dispatch({ [V1Tag]: (v1) => v1.initSwap(secretKeys, desiredInputs, desiredOutputs) })
        .pipe(Effect.runPromise);
    }

    finalizeTransaction(transaction: ledger.UnprovenTransaction): Promise<TTransaction> {
      return this.runtime
        .dispatch({
          [V1Tag]: (v1) => v1.finalizeTransaction(transaction),
        })
        .pipe(Effect.runPromise);
    }

    revertTransaction(
      transaction: ledger.Transaction<ledger.Signaturish, ledger.Proofish, ledger.Bindingish>,
    ): Promise<void> {
      return this.runtime
        .dispatch({
          [V1Tag]: (v1) => v1.revertTransaction(transaction),
        })
        .pipe(Effect.runPromise);
    }

    waitForSyncedState(allowedGap: bigint = 0n): Promise<ShieldedWalletState<TSerialized, TTransaction>> {
      return rx.firstValueFrom(
        this.state.pipe(rx.filter((state) => state.state.progress.isCompleteWithin(allowedGap))),
      );
    }

    /**
     * Serializes the most recent state
     * It's preferable to use [[ShieldedWalletState.serialize]] instead, to know exactly, which state is serialized
     */
    serializeState(): Promise<TSerialized> {
      return rx.firstValueFrom(this.state).then((state) => state.serialize());
    }

    getAddress(): Promise<ShieldedAddress> {
      return rx.firstValueFrom(this.state).then((state) => state.address);
    }
  };
}
