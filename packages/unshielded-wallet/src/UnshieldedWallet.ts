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
import { type ProtocolState, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import {
  type BaseV2Configuration,
  type DefaultV2Configuration,
  V2Builder,
  V2Tag,
  type V2Variant,
  CoreWallet,
  type UnboundTransaction,
} from './v2/index.js';
import type * as ledger from '@midnightntwrk/ledger-v9';
import { Effect, Either, type Scope } from 'effect';
import * as rx from 'rxjs';
import { type SerializationCapability } from './v2/Serialization.js';
import { type TransactionHistoryService } from './v2/TransactionHistory.js';
import { type CoinsAndBalancesCapability } from './v2/CoinsAndBalances.js';
import { type KeysCapability } from './v2/Keys.js';
import {
  type TokenTransfer,
  type FinalizedTransactionBalanceResult,
  type UnboundTransactionBalanceResult,
  type UnprovenTransactionBalanceResult,
} from './v2/Transacting.js';
import { type WalletSyncUpdate } from './v2/SyncSchema.js';
import { type SignSegment } from './v2/Signing.js';
import { type UtxoWithMeta } from './v2/UnshieldedState.js';
import { type Variant, type VariantBuilder, type WalletLike } from '@midnightntwrk/wallet-sdk-runtime/abstractions';
import { type Runtime, WalletBuilder } from '@midnightntwrk/wallet-sdk-runtime';
import { type PublicKey } from './KeyStore.js';
import { type SyncProgress } from './v2/SyncProgress.js';
import { type UnshieldedAddress } from '@midnightntwrk/wallet-sdk-address-format';

export type UnshieldedWalletCapabilities<TSerialized = string> = {
  serialization: SerializationCapability<CoreWallet, TSerialized>;
  coinsAndBalances: CoinsAndBalancesCapability<CoreWallet>;
  keys: KeysCapability<CoreWallet>;
};

export type UnshieldedWalletServices = {
  transactionHistory: TransactionHistoryService;
};

export class UnshieldedWalletState<TSerialized = string> {
  static readonly mapState =
    <TSerialized = string>(variant: UnshieldedWalletCapabilities<TSerialized> & UnshieldedWalletServices) =>
    (state: ProtocolState.ProtocolState<CoreWallet>): UnshieldedWalletState<TSerialized> => {
      const { serialization, coinsAndBalances, keys } = variant;
      const { transactionHistory } = variant;
      return new UnshieldedWalletState(state, { serialization, coinsAndBalances, keys }, { transactionHistory });
    };

  readonly protocolVersion: ProtocolVersion.ProtocolVersion;
  readonly state: CoreWallet;
  readonly capabilities: UnshieldedWalletCapabilities<TSerialized>;
  readonly services: UnshieldedWalletServices;

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

  constructor(
    state: ProtocolState.ProtocolState<CoreWallet>,
    capabilities: UnshieldedWalletCapabilities<TSerialized>,
    services: UnshieldedWalletServices,
  ) {
    this.protocolVersion = state.version;
    this.state = state.state;
    this.capabilities = capabilities;
    this.services = services;
  }

  serialize(): TSerialized {
    return this.capabilities.serialization.serialize(this.state);
  }
}

export type UnshieldedWallet = CustomizedUnshieldedWallet<WalletSyncUpdate, string>;

export type DefaultUnshieldedConfiguration = DefaultV2Configuration;

export type UnshieldedWalletClass = CustomizedUnshieldedWalletClass<
  WalletSyncUpdate,
  string,
  DefaultUnshieldedConfiguration
>;

export type UnshieldedWalletAPI<TSerialized = string> = {
  readonly state: rx.Observable<UnshieldedWalletState<TSerialized>>;

  start(): Promise<void>;

  balanceFinalizedTransaction(tx: ledger.FinalizedTransaction): Promise<FinalizedTransactionBalanceResult>;

  balanceUnboundTransaction(tx: UnboundTransaction): Promise<UnboundTransactionBalanceResult>;

  balanceUnprovenTransaction(tx: ledger.UnprovenTransaction): Promise<UnprovenTransactionBalanceResult>;

  transferTransaction(outputs: readonly TokenTransfer[], ttl: Date): Promise<ledger.UnprovenTransaction>;

  /**
   * Books a caller-supplied set of Night UTxOs and returns an unproven transaction that moves them back to the same
   * owner, split between the guaranteed (segment 0) and fallible (segment 1) sections of a single intent. Booking moves
   * the UTxOs from available to pending so a concurrent build call cannot reuse them. The fallible section is available
   * for callers that want to attach further actions (e.g. a Dust registration) at segment 1.
   */
  rotateUtxos(
    guaranteedUtxos: readonly UtxoWithMeta[],
    fallibleUtxos: readonly UtxoWithMeta[],
    nightVerifyingKey: ledger.SignatureVerifyingKey,
    ttl: Date,
  ): Promise<ledger.UnprovenTransaction>;

  initSwap(
    desiredInputs: Record<ledger.RawTokenType, bigint>,
    desiredOutputs: readonly TokenTransfer[],
    ttl: Date,
  ): Promise<ledger.UnprovenTransaction>;

  signUnprovenTransaction(
    transaction: ledger.UnprovenTransaction,
    signSegment: SignSegment,
  ): Promise<ledger.UnprovenTransaction>;

  signUnboundTransaction(transaction: UnboundTransaction, signSegment: SignSegment): Promise<UnboundTransaction>;

  serializeState(): Promise<TSerialized>;

  waitForSyncedState(allowedGap?: bigint): Promise<UnshieldedWalletState<TSerialized>>;

  revertTransaction(
    transaction: ledger.Transaction<ledger.Signaturish, ledger.Proofish, ledger.Bindingish>,
  ): Promise<void>;

  getAddress(): Promise<UnshieldedAddress>;

  stop(): Promise<void>;
};

export type CustomizedUnshieldedWallet<
  TSyncUpdate = WalletSyncUpdate,
  TSerialized = string,
> = UnshieldedWalletAPI<TSerialized> &
  WalletLike.WalletLike<[Variant.VersionedVariant<V2Variant<TSerialized, TSyncUpdate>>]>;

export interface CustomizedUnshieldedWalletClass<
  TSyncUpdate = WalletSyncUpdate,
  TSerialized = string,
  TConfig extends BaseV2Configuration = DefaultV2Configuration,
> extends WalletLike.BaseWalletClass<[Variant.VersionedVariant<V2Variant<TSerialized, TSyncUpdate>>]> {
  configuration: TConfig;
  startWithPublicKey(publicKey: PublicKey): CustomizedUnshieldedWallet<TSyncUpdate, TSerialized>;
  restore(serializedState: TSerialized): CustomizedUnshieldedWallet<TSyncUpdate, TSerialized>;
}

export function UnshieldedWallet(configuration: DefaultV2Configuration): UnshieldedWalletClass {
  return CustomUnshieldedWallet(configuration, new V2Builder().withDefaults());
}

export function CustomUnshieldedWallet<
  TConfig extends BaseV2Configuration = DefaultV2Configuration,
  TSyncUpdate = WalletSyncUpdate,
  TSerialized = string,
>(
  configuration: TConfig,
  builder: VariantBuilder.VariantBuilder<V2Variant<TSerialized, TSyncUpdate>, TConfig>,
): CustomizedUnshieldedWalletClass<TSyncUpdate, TSerialized, TConfig> {
  const buildArgs = [configuration] as WalletBuilder.BuildArguments<
    [
      VariantBuilder.VersionedVariantBuilder<
        VariantBuilder.VariantBuilder<V2Variant<TSerialized, TSyncUpdate>, TConfig>
      >,
    ]
  >;
  const BaseWallet = WalletBuilder.init()
    .withVariant(ProtocolVersion.MinSupportedVersion, builder)
    .build(...buildArgs) as WalletLike.BaseWalletClass<
    [Variant.VersionedVariant<V2Variant<TSerialized, TSyncUpdate>>],
    TConfig
  >;

  return class CustomUnshieldedWalletImplementation
    extends BaseWallet
    implements CustomizedUnshieldedWallet<TSyncUpdate, TSerialized>
  {
    static startWithPublicKey(publicKeys: PublicKey): CustomUnshieldedWalletImplementation {
      return CustomUnshieldedWalletImplementation.startFirst(
        CustomUnshieldedWalletImplementation,
        CoreWallet.init(publicKeys, configuration.networkId),
      );
    }

    static restore(serializedState: TSerialized): CustomUnshieldedWalletImplementation {
      const deserialized: CoreWallet = CustomUnshieldedWalletImplementation.allVariantsRecord()
        [V2Tag].variant.deserializeState(serializedState)
        .pipe(Either.getOrThrow);
      return CustomUnshieldedWalletImplementation.startFirst(CustomUnshieldedWalletImplementation, deserialized);
    }

    readonly state: rx.Observable<UnshieldedWalletState<TSerialized>>;

    constructor(
      runtime: Runtime.Runtime<[Variant.VersionedVariant<V2Variant<TSerialized, TSyncUpdate>>]>,
      scope: Scope.CloseableScope,
    ) {
      super(runtime, scope);
      this.state = this.rawState.pipe(
        rx.map(
          UnshieldedWalletState.mapState<TSerialized>(
            CustomUnshieldedWalletImplementation.allVariantsRecord()[V2Tag].variant,
          ),
        ),
        rx.shareReplay({ refCount: true, bufferSize: 1 }),
      );
    }

    start(): Promise<void> {
      return this.runtime.dispatch({ [V2Tag]: (v2) => v2.startSyncInBackground() }).pipe(Effect.runPromise);
    }

    balanceFinalizedTransaction(tx: ledger.FinalizedTransaction): Promise<FinalizedTransactionBalanceResult> {
      return this.runtime
        .dispatch({
          [V2Tag]: (v2) => v2.balanceFinalizedTransaction(tx),
        })
        .pipe(Effect.runPromise);
    }

    balanceUnboundTransaction(tx: UnboundTransaction): Promise<UnboundTransactionBalanceResult> {
      return this.runtime
        .dispatch({
          [V2Tag]: (v2) => v2.balanceUnboundTransaction(tx),
        })
        .pipe(Effect.runPromise);
    }

    balanceUnprovenTransaction(tx: ledger.UnprovenTransaction): Promise<UnprovenTransactionBalanceResult> {
      return this.runtime
        .dispatch({
          [V2Tag]: (v2) => v2.balanceUnprovenTransaction(tx),
        })
        .pipe(Effect.runPromise);
    }

    transferTransaction(outputs: readonly TokenTransfer[], ttl: Date): Promise<ledger.UnprovenTransaction> {
      return this.runtime
        .dispatch({
          [V2Tag]: (v2) => v2.transferTransaction(outputs, ttl),
        })
        .pipe(Effect.runPromise);
    }

    rotateUtxos(
      guaranteedUtxos: readonly UtxoWithMeta[],
      fallibleUtxos: readonly UtxoWithMeta[],
      nightVerifyingKey: ledger.SignatureVerifyingKey,
      ttl: Date,
    ): Promise<ledger.UnprovenTransaction> {
      return this.runtime
        .dispatch({
          [V2Tag]: (v2) => v2.rotateUtxos(guaranteedUtxos, fallibleUtxos, nightVerifyingKey, ttl),
        })
        .pipe(Effect.runPromise);
    }

    initSwap(
      desiredInputs: Record<ledger.RawTokenType, bigint>,
      desiredOutputs: readonly TokenTransfer[],
      ttl: Date,
    ): Promise<ledger.UnprovenTransaction> {
      return this.runtime
        .dispatch({ [V2Tag]: (v2) => v2.initSwap(desiredInputs, desiredOutputs, ttl) })
        .pipe(Effect.runPromise);
    }

    signUnprovenTransaction(
      transaction: ledger.UnprovenTransaction,
      signSegment: SignSegment,
    ): Promise<ledger.UnprovenTransaction> {
      return this.runtime
        .dispatch({
          [V2Tag]: (v2) => v2.signUnprovenTransaction(transaction, signSegment),
        })
        .pipe(Effect.runPromise);
    }

    signUnboundTransaction(transaction: UnboundTransaction, signSegment: SignSegment): Promise<UnboundTransaction> {
      return this.runtime
        .dispatch({
          [V2Tag]: (v2) => v2.signUnboundTransaction(transaction, signSegment),
        })
        .pipe(Effect.runPromise);
    }

    revertTransaction(
      transaction: ledger.Transaction<ledger.SignatureEnabled, ledger.Proofish, ledger.Bindingish>,
    ): Promise<void> {
      return this.runtime
        .dispatch({
          [V2Tag]: (v2) => v2.revertTransaction(transaction),
        })
        .pipe(Effect.runPromise);
    }

    waitForSyncedState(allowedGap: bigint = 0n): Promise<UnshieldedWalletState<TSerialized>> {
      return rx.firstValueFrom(
        this.state.pipe(rx.filter((state) => state.state.progress.isCompleteWithin(allowedGap))),
      );
    }

    /**
     * Serializes the most recent state It's preferable to use [[UnshieldedWalletState.serialize]] instead, to know
     * exactly, which state is serialized
     */
    serializeState(): Promise<TSerialized> {
      return rx.firstValueFrom(this.state).then((state) => state.serialize());
    }

    getAddress(): Promise<UnshieldedAddress> {
      return rx.firstValueFrom(this.state).then((state) => state.address);
    }
  };
}
