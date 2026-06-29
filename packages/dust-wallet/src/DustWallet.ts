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
  type FinalizedTransaction,
  type Signature,
  type SignatureVerifyingKey,
  type UnprovenTransaction,
} from '@midnight-ntwrk/ledger-v8';
import { type ProtocolState, ProtocolVersion, type SyncProgress } from '@midnightntwrk/wallet-sdk-abstractions';
import { type DustAddress } from '@midnightntwrk/wallet-sdk-address-format';
import { type Runtime, WalletBuilder } from '@midnightntwrk/wallet-sdk-runtime';
import { type Variant, type VariantBuilder, type WalletLike } from '@midnightntwrk/wallet-sdk-runtime/abstractions';
import { type Clock } from '@midnightntwrk/wallet-sdk-utilities';
import { Effect, Either, type Scope } from 'effect';
import * as rx from 'rxjs';
import { type Balance, type CoinsAndBalancesCapability, type UtxoWithFullDustDetails } from './v1/CoinsAndBalances.js';
import { CoreWallet } from './v1/CoreWallet.js';
import { type KeysCapability } from './v1/Keys.js';
import { V1Tag } from './v1/RunningV1Variant.js';
import { type SerializationCapability } from './v1/Serialization.js';
import { type NightUtxoSplitForDustRegistration } from './v1/Transacting.js';
import { type DustFullInfo, type UtxoWithMeta } from './v1/types/Dust.js';
import { type AnyTransaction } from './v1/types/ledger.js';
import { type BaseV1Configuration, type DefaultV1Configuration, type V1Variant, V1Builder } from './v1/V1Builder.js';
import { type WalletSyncUpdate } from './v1/SyncSchema.js';

import { type TransactionHistoryService } from './v1/TransactionHistory.js';

export type DustWalletCapabilities<TSerialized = string> = {
  serialization: SerializationCapability<CoreWallet, null, TSerialized>;
  coinsAndBalances: CoinsAndBalancesCapability<CoreWallet>;
  keys: KeysCapability<CoreWallet>;
};

export type DustWalletServices = {
  transactionHistory: TransactionHistoryService;
};

export class DustWalletState<TSerialized = string> {
  static readonly mapState =
    <TSerialized = string>(variant: DustWalletCapabilities<TSerialized> & DustWalletServices) =>
    (state: ProtocolState.ProtocolState<CoreWallet>): DustWalletState<TSerialized> => {
      const { serialization, coinsAndBalances, keys } = variant;
      const { transactionHistory } = variant;
      return new DustWalletState(state, { serialization, coinsAndBalances, keys }, { transactionHistory });
    };

  readonly protocolVersion: ProtocolVersion.ProtocolVersion;
  readonly state: CoreWallet;
  readonly capabilities: DustWalletCapabilities<TSerialized>;
  readonly services: DustWalletServices;

  get totalCoins(): readonly DustFullInfo[] {
    return this.capabilities.coinsAndBalances.getTotalCoins(this.state);
  }

  get availableCoins(): readonly DustFullInfo[] {
    return this.capabilities.coinsAndBalances.getAvailableCoins(this.state);
  }

  get pendingCoins(): readonly DustFullInfo[] {
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

  constructor(
    state: ProtocolState.ProtocolState<CoreWallet>,
    capabilities: DustWalletCapabilities<TSerialized>,
    services: DustWalletServices,
  ) {
    this.protocolVersion = state.version;
    this.state = state.state;
    this.capabilities = capabilities;
    this.services = services;
  }

  balance(time: Date): Balance {
    return this.capabilities.coinsAndBalances.getWalletBalance(this.state, time);
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

export type DustWalletAPI<TStartAux = DustSecretKey, TSerialized = string> = {
  readonly state: rx.Observable<DustWalletState<TSerialized>>;

  start(secretKey: TStartAux): Promise<void>;

  stepSync(secretKey: TStartAux): Promise<void>;

  createDustGenerationTransaction(
    currentTime: Date | undefined,
    ttl: Date,
    nightUtxos: Array<UtxoWithMeta>,
    nightVerifyingKey: SignatureVerifyingKey,
    dustReceiverAddress: DustAddress | undefined,
  ): Promise<UnprovenTransaction>;

  splitNightUtxosForDustRegistration(
    currentTime: Date,
    nightUtxos: ReadonlyArray<UtxoWithMeta>,
    isRegistration: boolean,
  ): Promise<NightUtxoSplitForDustRegistration>;

  attachDustRegistration(
    transaction: UnprovenTransaction,
    currentTime: Date,
    nightVerifyingKey: SignatureVerifyingKey,
    dustReceiverAddress: DustAddress | undefined,
    feePayment: bigint,
  ): Promise<UnprovenTransaction>;

  addDustGenerationSignature(transaction: UnprovenTransaction, signature: Signature): Promise<UnprovenTransaction>;

  /**
   * Attaches a signature to the DustRegistration in segment 1's `dustActions` only. Unlike
   * {@link addDustGenerationSignature}, this does NOT touch the unshielded offers — those should be signed separately
   * via the unshielded-wallet signing path. Use this when the caller orchestrates signing across both packages (e.g.
   * the facade's `signRecipe`).
   */
  addDustRegistrationSignature(transaction: UnprovenTransaction, signature: Signature): Promise<UnprovenTransaction>;

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

  /**
   * Resolves when the dust projected to be generated by the single highest-generation unregistered Night UTxO reaches
   * `requiredAmount`. The projection is re-evaluated every second so the wait advances even when the dust state stream
   * is quiet. Tracks the same quantity used as `allow_fee_payment` for the registration (the maximum across the UTxOs,
   * not their sum, since `splitNightUtxos` puts only one UTxO in the guaranteed slot), so pairing with
   * `WalletFacade.estimateRegistration` to pick `requiredAmount` guarantees the subsequent
   * `registerNightUtxosForDustGeneration` will pass its fee-coverage guard.
   *
   * @param nightUtxos - UTxOs to project generation for; same set passed to `registerNightUtxosForDustGeneration`.
   *   Already-registered UTxOs are ignored. Must be non-empty.
   * @param requiredAmount - Threshold to wait for, as a Dust amount. Resolves immediately if `<= 0n`.
   * @param clock - Source of current time, read on every tick. Required, and a {@link Clock.Clock} rather than a
   *   snapshot `Date` like the other methods' `currentTime`: the projection only advances because the time is re-read
   *   each tick, and callers must inject their own clock so simulator-driven tests respect simulator time.
   * @param opts.timeoutMs - Deadline, in ms from subscription, for `requiredAmount` to be reached; rejects if it is
   *   not. Default `300_000`.
   * @returns A promise that resolves once the projected dust reaches `requiredAmount`.
   * @throws Error if `nightUtxos` is empty.
   * @throws TimeoutError if `requiredAmount` is not reached within `opts.timeoutMs`.
   */
  waitForGeneratedDust(
    nightUtxos: ReadonlyArray<UtxoWithMeta>,
    requiredAmount: bigint,
    clock: Clock.Clock,
    opts?: { timeoutMs?: number },
  ): Promise<void>;

  revertTransaction(transaction: AnyTransaction): Promise<void>;

  getAddress(): Promise<DustAddress>;

  stop(): Promise<void>;
};

export type CustomizedDustWallet<
  TStartAux = DustSecretKey,
  TTransaction = FinalizedTransaction,
  TSyncUpdate = WalletSyncUpdate,
  TSerialized = string,
> = DustWalletAPI<TStartAux, TSerialized> &
  WalletLike.WalletLike<[Variant.VersionedVariant<V1Variant<TSerialized, TSyncUpdate, TTransaction, TStartAux>>]>;

export type DefaultDustConfiguration = DefaultV1Configuration;

export interface CustomizedDustWalletClass<
  TStartAux = DustSecretKey,
  TTransaction = FinalizedTransaction,
  TSyncUpdate = WalletSyncUpdate,
  TSerialized = string,
  TConfig extends BaseV1Configuration = DefaultDustConfiguration,
> extends WalletLike.BaseWalletClass<
  [Variant.VersionedVariant<V1Variant<TSerialized, TSyncUpdate, TTransaction, TStartAux>>]
> {
  configuration: TConfig;
  startWithSeed(
    seed: Uint8Array,
    dustParameters: DustParameters,
  ): CustomizedDustWallet<TStartAux, TTransaction, TSyncUpdate, TSerialized>;
  startWithSecretKey(
    secretKey: DustSecretKey,
    dustParameters: DustParameters,
  ): CustomizedDustWallet<TStartAux, TTransaction, TSyncUpdate, TSerialized>;
  restore(serializedState: TSerialized): CustomizedDustWallet<TStartAux, TTransaction, TSyncUpdate, TSerialized>;
}

export type DustWallet = CustomizedDustWallet<DustSecretKey, FinalizedTransaction, WalletSyncUpdate, string>;

export type DustWalletClass = CustomizedDustWalletClass<DustSecretKey, FinalizedTransaction, WalletSyncUpdate, string>;

export function DustWallet(configuration: DefaultDustConfiguration): DustWalletClass {
  return CustomDustWallet(configuration, new V1Builder().withDefaults());
}

export function CustomDustWallet<
  TConfig extends BaseV1Configuration = DefaultDustConfiguration,
  TStartAux = DustSecretKey,
  TTransaction = FinalizedTransaction,
  TSyncUpdate = WalletSyncUpdate,
  TSerialized = string,
>(
  configuration: TConfig,
  builder: VariantBuilder.VariantBuilder<V1Variant<TSerialized, TSyncUpdate, TTransaction, TStartAux>, TConfig>,
): CustomizedDustWalletClass<TStartAux, TTransaction, TSyncUpdate, TSerialized, TConfig> {
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

  return class CustomDustWalletImplementation
    extends BaseWallet
    implements CustomizedDustWallet<TStartAux, TTransaction, TSyncUpdate, TSerialized>
  {
    static startWithSeed(seed: Uint8Array, dustParameters: DustParameters): CustomDustWalletImplementation {
      const dustSecretKey = DustSecretKey.fromSeed(seed);
      return CustomDustWalletImplementation.startFirst(
        CustomDustWalletImplementation,
        CoreWallet.initEmpty(dustParameters, dustSecretKey, CustomDustWalletImplementation.configuration.networkId),
      );
    }

    static startWithSecretKey(
      secretKey: DustSecretKey,
      dustParameters: DustParameters,
    ): CustomDustWalletImplementation {
      return CustomDustWalletImplementation.startFirst(
        CustomDustWalletImplementation,
        CoreWallet.initEmpty(dustParameters, secretKey, CustomDustWalletImplementation.configuration.networkId),
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
      runtime: Runtime.Runtime<
        [Variant.VersionedVariant<V1Variant<TSerialized, TSyncUpdate, TTransaction, TStartAux>>]
      >,
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

    start(secretKey: TStartAux): Promise<void> {
      return this.runtime.dispatch({ [V1Tag]: (v1) => v1.startSyncInBackground(secretKey) }).pipe(Effect.runPromise);
    }

    stepSync(secretKey: TStartAux): Promise<void> {
      return this.runtime.dispatch({ [V1Tag]: (v1) => v1.sync(secretKey) }).pipe(Effect.runPromise);
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

    async splitNightUtxosForDustRegistration(
      currentTime: Date,
      nightUtxos: ReadonlyArray<UtxoWithMeta>,
      isRegistration: boolean,
    ): Promise<NightUtxoSplitForDustRegistration> {
      return this.runtime
        .dispatch({
          [V1Tag]: (v1) => v1.splitNightUtxosForDustRegistration(currentTime, nightUtxos, isRegistration),
        })
        .pipe(Effect.runPromise);
    }

    async attachDustRegistration(
      transaction: UnprovenTransaction,
      currentTime: Date,
      nightVerifyingKey: SignatureVerifyingKey,
      dustReceiverAddress: DustAddress | undefined,
      feePayment: bigint,
    ): Promise<UnprovenTransaction> {
      return this.runtime
        .dispatch({
          [V1Tag]: (v1) =>
            v1.attachDustRegistration(transaction, currentTime, nightVerifyingKey, dustReceiverAddress, feePayment),
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

    addDustRegistrationSignature(transaction: UnprovenTransaction, signature: Signature): Promise<UnprovenTransaction> {
      return this.runtime
        .dispatch({
          [V1Tag]: (v1) => v1.addDustRegistrationSignature(transaction, signature),
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

    async waitForGeneratedDust(
      nightUtxos: ReadonlyArray<UtxoWithMeta>,
      requiredAmount: bigint,
      clock: Clock.Clock,
      opts?: { timeoutMs?: number },
    ): Promise<void> {
      if (nightUtxos.length === 0) {
        throw Error('At least one Night UTXO is required.');
      }
      if (requiredAmount <= 0n) {
        return;
      }
      const timeoutMs = opts?.timeoutMs ?? 300_000;
      // Combine the dust state stream with a 1 s tick — the dust state only emits when sync
      // updates apply, but the generation projection depends on a current-time reading, which
      // advances continuously. Without a periodic tick the filter would never re-run between
      // state emissions on a quiet wallet, and the wait would hang.
      await rx.firstValueFrom(
        rx.combineLatest([this.state, rx.timer(0, 1000)]).pipe(
          rx.filter(([dustState]) => {
            // The registration's allow_fee_payment is capped at the single highest-generation
            // unregistered Night UTxO (splitNightUtxos puts only 1 UTxO in the guaranteed slot),
            // so the wait must track that same quantity — summing across UTxOs would resolve
            // optimistically and the registration would still fail the fee check.
            const maxGeneratedNow = dustState
              .estimateDustGeneration(nightUtxos, clock.now())
              .filter((u) => !u.utxo.registeredForDustGeneration)
              .reduce((max, u) => (u.dust.generatedNow > max ? u.dust.generatedNow : max), 0n);
            return maxGeneratedNow >= requiredAmount;
          }),
          rx.timeout({ first: timeoutMs }),
        ),
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
