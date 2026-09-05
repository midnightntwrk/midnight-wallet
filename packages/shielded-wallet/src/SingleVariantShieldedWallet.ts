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

/**
 * A shielded wallet composed from a single variant, which answers for the whole protocol timeline.
 *
 * @remarks
 *   The composition for a wallet that is not expected to meet a protocol boundary — a test harness, a simulator-driven
 *   wallet, an application pinned to one protocol version. Its one variant is registered from the minimum supported
 *   version, so it stamps every transaction at that floor and accepts one of any version; the price is that it cannot
 *   cross a protocol boundary. The wallet that can is `ShieldedWallet`, in `ShieldedWallet.ts`.
 */
import * as ledger from '@midnightntwrk/ledger-v9';
import {
  type AnyTx,
  ProtocolVersion,
  type ProtocolVersionMismatchError,
  type UnprovenTx,
  WalletSeed,
  WalletTransaction,
} from '@midnightntwrk/wallet-sdk-abstractions';
import { type ShieldedAddress } from '@midnightntwrk/wallet-sdk-address-format';
import { type Runtime, WalletBuilder } from '@midnightntwrk/wallet-sdk-runtime';
import {
  StartMaterial,
  type Variant,
  type VariantBuilder,
  type WalletLike,
} from '@midnightntwrk/wallet-sdk-runtime/abstractions';
import { EitherOps, HList, Poly } from '@midnightntwrk/wallet-sdk-utilities';
import { Effect, Either, Option, Ref, type Scope } from 'effect';
import * as rx from 'rxjs';
import { variantForSnapshot } from './Restore.js';
import {
  type DefaultShieldedConfiguration,
  type ShieldedBalancingResult,
  type ShieldedWalletAPI,
  ShieldedWalletState,
} from './ShieldedWalletAPI.js';
import {
  type BaseV2Configuration,
  type DefaultV2Configuration,
  type RunningV2Variant,
  V2Tag,
  type V2Variant,
  CoreWallet,
} from './v2/index.js';
import { type WalletSyncUpdate } from './v2/Sync.js';
import { type TokenTransfer } from './v2/Transacting.js';
import { type WalletError } from './v2/WalletError.js';

export type CustomizedShieldedWallet<
  TStartAux extends ledger.ZswapSecretKeys = ledger.ZswapSecretKeys,
  TTransaction = ledger.FinalizedTransaction,
  TSyncUpdate = WalletSyncUpdate,
  TSerialized = string,
> = ShieldedWalletAPI<TStartAux, TTransaction, TSerialized> &
  WalletLike.WalletLike<[Variant.VersionedVariant<V2Variant<TSerialized, TSyncUpdate, TTransaction, TStartAux>>]>;

export interface CustomizedShieldedWalletClass<
  TStartAux extends ledger.ZswapSecretKeys = ledger.ZswapSecretKeys,
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

/**
 * Builds a shielded wallet class over a single variant.
 *
 * @remarks
 *   One variant, and therefore one ledger version: this is the composition for a wallet that is not expected to meet a
 *   protocol boundary — a test harness, a simulator-driven wallet, an application pinned to one protocol version. The
 *   wallet this package ships is `ShieldedWallet`, which registers a variant either side of the boundary.
 * @param configuration What the variant is built from.
 * @param builder The variant builder.
 * @returns The wallet class.
 */
export function CustomShieldedWallet<
  TConfig extends BaseV2Configuration = DefaultV2Configuration,
  TStartAux extends ledger.ZswapSecretKeys = ledger.ZswapSecretKeys,
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
        rx.map((emission) =>
          // One variant, so the pairing is trivial here; the forking wallet narrows on `variantTag` first.
          ShieldedWalletState.fromVariant<CoreWallet, TSerialized>(
            CustomShieldedWalletImplementation.allVariantsRecord()[V2Tag].variant,
            emission,
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

    /**
     * The key material this wallet's one variant uses, from what it was started with.
     *
     * @remarks
     *   Typed as the variant's own start-aux, which for a single-variant wallet is whatever the application handed to
     *   `start` — there is no other variant to derive for, so a retained seed is only ever used through the variant's
     *   own derivation.
     */
    #requireAux(): Effect.Effect<TStartAux, StartMaterial.MissingStartAuxError> {
      return Effect.gen(this, function* () {
        const current = yield* this.runtime.currentVariant;
        const variantTag = Poly.getTag(current);
        const retained = yield* Ref.get(this.#retainedStartMaterial);
        return yield* Option.match(retained, {
          onNone: () =>
            Effect.fail(
              new StartMaterial.MissingStartAuxError({
                message:
                  `This wallet holds no key material: it has not been started, or it has been stopped. Start it ` +
                  `before asking it to build a transaction.`,
                variantTag,
              }),
            ),
          onSome: (material: StartMaterial.StartMaterial<TStartAux>) =>
            EitherOps.toEffect(
              StartMaterial.requireAuxFor(material, variantTag, (seed) =>
                CustomShieldedWalletImplementation.allVariantsRecord()[V2Tag].variant.startAux.fromSeed(seed),
              ),
            ),
        });
      });
    }

    /** The whole of the protocol timeline: one variant answers for every version this wallet will ever see. */
    static readonly #epoch = ProtocolVersion.epochOf(
      ProtocolVersion.MinSupportedVersion,
      ProtocolVersion.MinSupportedVersion,
    );

    balanceTransaction(tx: AnyTx): Promise<ShieldedBalancingResult> {
      return this.runtime
        .dispatch<
          ShieldedBalancingResult,
          WalletError | StartMaterial.MissingStartAuxError | ProtocolVersionMismatchError
        >({
          [V2Tag]: (v2) =>
            Effect.all([
              this.#requireAux(),
              EitherOps.toEffect(
                WalletTransaction.unwrapWithin<
                  ledger.Transaction<ledger.Signaturish, ledger.Proofish, ledger.Bindingish>
                >(tx, CustomShieldedWalletImplementation.#epoch),
              ),
            ]).pipe(
              Effect.flatMap(([keys, unwrapped]) => v2.balanceTransaction(keys, unwrapped)),
              Effect.map((result) =>
                result === undefined
                  ? undefined
                  : WalletTransaction.adopt('Unproven', result, ProtocolVersion.MinSupportedVersion),
              ),
            ),
        })
        .pipe(Effect.runPromise);
    }

    transferTransaction(outputs: readonly TokenTransfer[]): Promise<UnprovenTx> {
      return this.runtime
        .dispatch<UnprovenTx, WalletError | StartMaterial.MissingStartAuxError>({
          [V2Tag]: (v2) =>
            this.#requireAux().pipe(
              Effect.flatMap((keys) => v2.transferTransaction(keys, outputs)),
              Effect.map((tx) => WalletTransaction.adopt('Unproven', tx, ProtocolVersion.MinSupportedVersion)),
            ),
        })
        .pipe(Effect.runPromise);
    }

    initSwap(
      desiredInputs: Record<ledger.RawTokenType, bigint>,
      desiredOutputs: readonly TokenTransfer[],
    ): Promise<UnprovenTx> {
      return this.runtime
        .dispatch<UnprovenTx, WalletError | StartMaterial.MissingStartAuxError>({
          [V2Tag]: (v2) =>
            this.#requireAux().pipe(
              Effect.flatMap((keys) => v2.initSwap(keys, desiredInputs, desiredOutputs)),
              Effect.map((tx) => WalletTransaction.adopt('Unproven', tx, ProtocolVersion.MinSupportedVersion)),
            ),
        })
        .pipe(Effect.runPromise);
    }

    revertTransaction(transaction: AnyTx): Promise<void> {
      return this.runtime
        .dispatch<void, WalletError>({
          [V2Tag]: (v2) =>
            Either.match(
              WalletTransaction.unwrapWithin<
                ledger.Transaction<ledger.Signaturish, ledger.Proofish, ledger.Bindingish>
              >(transaction, CustomShieldedWalletImplementation.#epoch),
              { onLeft: () => Effect.void, onRight: (unwrapped) => v2.revertTransaction(unwrapped) },
            ),
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
