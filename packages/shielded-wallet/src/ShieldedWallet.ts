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
  type NetworkId,
  type ProtocolState,
  ProtocolVersion,
  type SyncProgress,
  WalletSeed,
} from '@midnightntwrk/wallet-sdk-abstractions';
import {
  type BaseV2Configuration,
  type DefaultV2Configuration,
  type RunningV2Variant,
  V2Builder,
  V2Tag,
  type V2Variant,
  CoreWallet,
} from './v2/index.js';
import * as ledger from '@midnightntwrk/ledger-v9';
import { type Duration, Effect, Either, Option, Ref, type Scope } from 'effect';
import * as rx from 'rxjs';
import { type BalancingResult } from './v2/Transacting.js';
import { type SerializationCapability } from './v2/Serialization.js';
import { type AvailableCoin, type CoinsAndBalancesCapability, type PendingCoin } from './v2/CoinsAndBalances.js';
import { type KeysCapability } from './v2/Keys.js';
import {
  type ShieldedAddress,
  type ShieldedCoinPublicKey,
  type ShieldedEncryptionPublicKey,
} from '@midnightntwrk/wallet-sdk-address-format';
import { type TokenTransfer } from './v2/Transacting.js';
import { type BatchUpdatesConfig, type IndexerClientConnection, type WalletSyncUpdate } from './v2/Sync.js';
import { type ShieldedHistoryStorage, type TransactionHistoryService } from './v2/TransactionHistory.js';
import {
  StartMaterial,
  type Variant,
  type VariantBuilder,
  type WalletLike,
} from '@midnightntwrk/wallet-sdk-runtime/abstractions';
import { type Runtime, WalletBuilder } from '@midnightntwrk/wallet-sdk-runtime';
import { EitherOps, HList, Poly } from '@midnightntwrk/wallet-sdk-utilities';
import { variantForSnapshot } from './Restore.js';

export type ShieldedWalletCapabilities<TSerialized = string> = {
  serialization: SerializationCapability<CoreWallet, null, TSerialized>;
  coinsAndBalances: CoinsAndBalancesCapability<CoreWallet>;
  keys: KeysCapability<CoreWallet>;
};

export type ShieldedWalletServices = {
  transactionHistory: TransactionHistoryService;
};

export type UnboundTransaction = ledger.Transaction<ledger.SignatureEnabled, ledger.Proof, ledger.PreBinding>;

export class ShieldedWalletState<TSerialized = string, _TTransaction = ledger.FinalizedTransaction> {
  static readonly mapState =
    <TSerialized = string>(variant: ShieldedWalletCapabilities<TSerialized> & ShieldedWalletServices) =>
    (state: ProtocolState.ProtocolState<CoreWallet>): ShieldedWalletState<TSerialized> => {
      const { serialization, coinsAndBalances, keys } = variant;
      const { transactionHistory } = variant;
      return new ShieldedWalletState(state, { serialization, coinsAndBalances, keys }, { transactionHistory });
    };

  readonly protocolVersion: ProtocolVersion.ProtocolVersion;
  readonly state: CoreWallet;
  readonly capabilities: ShieldedWalletCapabilities<TSerialized>;
  readonly services: ShieldedWalletServices;

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

  get progress(): SyncProgress.SyncProgress {
    return this.state.progress;
  }

  constructor(
    state: ProtocolState.ProtocolState<CoreWallet>,
    capabilities: ShieldedWalletCapabilities<TSerialized>,
    services: ShieldedWalletServices,
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
  WalletLike.WalletLike<[Variant.VersionedVariant<V2Variant<TSerialized, TSyncUpdate, TTransaction, TStartAux>>]>;

/**
 * The configuration a default {@link ShieldedWallet} is built from.
 *
 * @remarks
 *   Declared by this package rather than aliased to a variant's configuration. A wallet that spans a protocol boundary is
 *   built from more than one variant, so no single variant's configuration can be the wallet's public contract: the
 *   package states what it asks an application for, and maps it onto whichever variants it registers.
 *
 *   The field types are still the ones the variants declare, because they are version-agnostic — `configuration.test.ts`
 *   asserts that this type remains interchangeable with what _both_ variants are built from, so a divergence surfaces
 *   as a compile error here instead of as a wallet that cannot be built for one of its variants.
 */
export type DefaultShieldedConfiguration = {
  networkId: NetworkId.NetworkId;
  indexerClientConnection: IndexerClientConnection;
  batchUpdates?: BatchUpdatesConfig;
  txHistoryStorage: ShieldedHistoryStorage;
  transactionDetailsRetryWindow?: Duration.DurationInput;
};

export interface CustomizedShieldedWalletClass<
  TStartAux = ledger.ZswapSecretKeys,
  TTransaction = ledger.FinalizedTransaction,
  TSyncUpdate = WalletSyncUpdate,
  TSerialized = string,
  TConfig extends BaseV2Configuration = DefaultShieldedConfiguration,
> extends WalletLike.BaseWalletClass<
  [Variant.VersionedVariant<V2Variant<TSerialized, TSyncUpdate, TTransaction, TStartAux>>]
> {
  configuration: TConfig;
  startWithSeed(seed: Uint8Array): CustomizedShieldedWallet<TStartAux, TTransaction, TSyncUpdate, TSerialized>;
  startWithSecretKeys(
    secretKeys: ledger.ZswapSecretKeys,
  ): CustomizedShieldedWallet<TStartAux, TTransaction, TSyncUpdate, TSerialized>;
  restore(serializedState: TSerialized): CustomizedShieldedWallet<TStartAux, TTransaction, TSyncUpdate, TSerialized>;
}

export function ShieldedWallet(configuration: DefaultShieldedConfiguration): ShieldedWalletClass {
  return CustomShieldedWallet(configuration, new V2Builder().withDefaults());
}

export function CustomShieldedWallet<
  TConfig extends BaseV2Configuration = DefaultV2Configuration,
  TStartAux = ledger.ZswapSecretKeys,
  TTransaction = ledger.FinalizedTransaction,
  TSyncUpdate = WalletSyncUpdate,
  TSerialized = string,
>(
  configuration: TConfig,
  builder: VariantBuilder.VariantBuilder<V2Variant<TSerialized, TSyncUpdate, TTransaction, TStartAux>, TConfig>,
): CustomizedShieldedWalletClass<TStartAux, TTransaction, TSyncUpdate, TSerialized, TConfig> {
  const buildArgs = [configuration] as WalletBuilder.BuildArguments<
    [
      VariantBuilder.VersionedVariantBuilder<
        VariantBuilder.VariantBuilder<V2Variant<TSerialized, TSyncUpdate, TTransaction, TStartAux>, TConfig>
      >,
    ]
  >;
  const BaseWallet = WalletBuilder.init()
    .withVariant(ProtocolVersion.MinSupportedVersion, builder)
    .build(...buildArgs) as WalletLike.BaseWalletClass<
    [Variant.VersionedVariant<V2Variant<TSerialized, TSyncUpdate, TTransaction, TStartAux>>],
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

    /**
     * Builds a wallet from a seed, and remembers the seed.
     *
     * @remarks
     *   The seed is the only key material that crosses a protocol boundary, so a wallet built this way can start
     *   synchronization on any variant it is ever migrated to — each derives its own from the seed. A wallet built from
     *   key objects instead can only start the variants it was given objects for.
     */
    static startWithSeed(seed: Uint8Array): CustomShieldedWalletImplementation {
      const walletSeed = WalletSeed.WalletSeed(seed);
      const secretKeys: ledger.ZswapSecretKeys = ledger.ZswapSecretKeys.fromSeed(walletSeed);
      const wallet = CustomShieldedWalletImplementation.startWithSecretKeys(secretKeys);
      wallet.#retainSeed(walletSeed);
      return wallet;
    }

    /**
     * Restores a wallet from a snapshot, into whichever registered variant wrote it.
     *
     * @remarks
     *   The snapshot declares the protocol version it was written at, so the variant that can read it is a lookup rather
     *   than an assumption. A snapshot written before snapshots declared a version, or a serialization format this
     *   wallet does not recognise as an envelope at all, restores into the head variant — which is what every restore
     *   did before there was more than one variant to choose between.
     * @param serializedState The serialized wallet state.
     * @returns A wallet started from that state, on the variant that owns its protocol version.
     * @throws UnsupportedSnapshotVersionError if the snapshot declares a version no registered variant reads.
     */
    static restore(serializedState: TSerialized): CustomShieldedWalletImplementation {
      const headVariant = HList.head(CustomShieldedWalletImplementation.allVariants());
      const routed =
        // Routing reads a serialized envelope, which only a wallet keeping the default string serialization has. A
        // custom format is left with the behaviour it has always had.
        typeof serializedState === 'string'
          ? variantForSnapshot(
              serializedState,
              (version) => CustomShieldedWalletImplementation.variantFor(version),
              headVariant,
            )
          : Either.right(headVariant);

      const variant = routed.pipe(Either.getOrThrow);
      const deserialized = variant.variant.deserializeState(serializedState).pipe(Either.getOrThrow);

      return CustomShieldedWalletImplementation.startAtVariant(
        CustomShieldedWalletImplementation,
        variant,
        deserialized,
      );
    }

    readonly state: rx.Observable<ShieldedWalletState<TSerialized>>;

    /**
     * What the application started this wallet with, kept so synchronization can be started again.
     *
     * @remarks
     *   A migration starts a fresh variant whose sync has never run, and sync needs key material. That material cannot
     *   come from the state — it is deliberately absent from anything serialized — and does not exist when the wallet
     *   is first constructed, so it is held here, in memory, for the lifetime of the wallet. Cleared by {@link stop} so
     *   a stopped wallet cannot be silently resurrected by a late activation.
     *
     *   A retained seed answers for every variant. Retained key objects answer only for the variants they were supplied
     *   for, and accumulate per variant tag as `start` is called, which is the same product a caller holding key
     *   objects for both protocol versions would hand over at once.
     */
    readonly #retainedStartMaterial = Ref.unsafeMake<Option.Option<StartMaterial.StartMaterial<TStartAux>>>(
      Option.none(),
    );

    /** Remembers a seed, which supersedes any key objects retained for individual variants. */
    #retainSeed(seed: WalletSeed.WalletSeed): void {
      Ref.set(this.#retainedStartMaterial, Option.some(StartMaterial.fromSeed<TStartAux>(seed))).pipe(Effect.runSync);
    }

    /**
     * Starts synchronization on a variant that has just become current, with key material it can use.
     *
     * @remarks
     *   The derivation is the activating variant's own, so a wallet retaining a seed hands each variant key material
     *   built by its own ledger version. A wallet retaining key objects for other variants only cannot answer, and says
     *   so rather than handing over keys the variant would silently misuse.
     */
    #resumeSyncOn(
      variantTag: typeof V2Tag,
      running: { startSyncInBackground: (aux: TStartAux) => Effect.Effect<void> },
    ): Effect.Effect<void, StartMaterial.MissingStartAuxError> {
      return Ref.get(this.#retainedStartMaterial).pipe(
        Effect.flatMap(
          Option.match({
            // Stopped, or never started: there is nothing to resume and nothing to resume it with.
            onNone: () => Effect.void,
            onSome: (retained: StartMaterial.StartMaterial<TStartAux>) =>
              EitherOps.toEffect(
                StartMaterial.requireAuxFor(retained, variantTag, (seed) =>
                  CustomShieldedWalletImplementation.allVariantsRecord()[variantTag].variant.startAux.fromSeed(seed),
                ),
              ).pipe(Effect.flatMap((aux) => running.startSyncInBackground(aux))),
          }),
        ),
      );
    }

    /**
     * Whether the activation watcher has been registered.
     *
     * @remarks
     *   Registration is per wallet, not per `start`: watchers accumulate, so registering on every call would restart sync
     *   once per historical `start` on the next activation. Flipped with `getAndSet` so concurrent `start` calls cannot
     *   both observe it unset.
     */
    readonly #watcherRegistered = Ref.unsafeMake(false);

    constructor(
      runtime: Runtime.Runtime<
        [Variant.VersionedVariant<V2Variant<TSerialized, TSyncUpdate, TTransaction, TStartAux>>]
      >,
      scope: Scope.CloseableScope,
    ) {
      super(runtime, scope);
      this.state = this.rawState.pipe(
        rx.map(
          ShieldedWalletState.mapState<TSerialized>(
            CustomShieldedWalletImplementation.allVariantsRecord()[V2Tag].variant,
          ),
        ),
        rx.shareReplay({ refCount: true, bufferSize: 1 }),
      );
    }

    start(secretKeys: TStartAux): Promise<void> {
      return Effect.gen(this, function* () {
        const current = yield* this.runtime.currentVariant;
        yield* Ref.update(this.#retainedStartMaterial, (retained) =>
          Option.some(
            Option.match(retained, {
              onNone: () => StartMaterial.forVariant<TStartAux>(Poly.getTag(current), secretKeys),
              // A retained seed already answers for every variant, including ones this wallet has not met, so key
              // objects for one of them add nothing. Otherwise the objects accumulate per variant tag.
              onSome: (existing: StartMaterial.StartMaterial<TStartAux>) =>
                existing._tag === 'FromSeed'
                  ? existing
                  : StartMaterial.forVariants<TStartAux>([...existing.byTag, [Poly.getTag(current), secretKeys]]),
            }),
          ),
        );

        // Registered before the first dispatch, and only once: `onVariantActivation` resolves only after its
        // subscription is live, so an activation racing this call is queued rather than missed.
        const alreadyRegistered = yield* Ref.getAndSet(this.#watcherRegistered, true);
        if (!alreadyRegistered) {
          yield* this.runtime.onVariantActivation({
            [V2Tag]: (v2: RunningV2Variant<TSerialized, TSyncUpdate, TTransaction, TStartAux>) =>
              this.#resumeSyncOn(V2Tag, v2),
          });
        }

        yield* this.runtime.dispatch({ [V2Tag]: (v2) => v2.startSyncInBackground(secretKeys) });
      }).pipe(Effect.runPromise);
    }

    async stop(): Promise<void> {
      // Released before the runtime is torn down: the key material outlives neither the wallet nor an in-flight
      // activation.
      Ref.set(this.#retainedStartMaterial, Option.none()).pipe(Effect.runSync);
      await super.stop();
    }

    balanceTransaction(
      secretKeys: ledger.ZswapSecretKeys,
      tx: ledger.Transaction<ledger.Signaturish, ledger.Proofish, ledger.Bindingish>,
    ): Promise<BalancingResult> {
      return this.runtime
        .dispatch({
          [V2Tag]: (v2) => v2.balanceTransaction(secretKeys, tx),
        })
        .pipe(Effect.runPromise);
    }

    transferTransaction(
      secretKeys: ledger.ZswapSecretKeys,
      outputs: readonly TokenTransfer[],
    ): Promise<ledger.UnprovenTransaction> {
      return this.runtime
        .dispatch({
          [V2Tag]: (v2) => v2.transferTransaction(secretKeys, outputs),
        })
        .pipe(Effect.runPromise);
    }

    initSwap(
      secretKeys: ledger.ZswapSecretKeys,
      desiredInputs: Record<ledger.RawTokenType, bigint>,
      desiredOutputs: readonly TokenTransfer[],
    ): Promise<ledger.UnprovenTransaction> {
      return this.runtime
        .dispatch({ [V2Tag]: (v2) => v2.initSwap(secretKeys, desiredInputs, desiredOutputs) })
        .pipe(Effect.runPromise);
    }

    revertTransaction(
      transaction: ledger.Transaction<ledger.Signaturish, ledger.Proofish, ledger.Bindingish>,
    ): Promise<void> {
      return this.runtime
        .dispatch({
          [V2Tag]: (v2) => v2.revertTransaction(transaction),
        })
        .pipe(Effect.runPromise);
    }

    waitForSyncedState(allowedGap: bigint = 0n): Promise<ShieldedWalletState<TSerialized>> {
      return rx.firstValueFrom(
        this.state.pipe(rx.filter((state) => state.state.progress.isCompleteWithin(allowedGap))),
      );
    }

    /**
     * Serializes the most recent state It's preferable to use [[ShieldedWalletState.serialize]] instead, to know
     * exactly, which state is serialized
     */
    serializeState(): Promise<TSerialized> {
      return rx.firstValueFrom(this.state).then((state) => state.serialize());
    }

    getAddress(): Promise<ShieldedAddress> {
      return rx.firstValueFrom(this.state).then((state) => state.address);
    }
  };
}
