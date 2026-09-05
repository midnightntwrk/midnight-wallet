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
 * A dust wallet composed from a single variant, which answers for the whole protocol timeline.
 *
 * @remarks
 *   The building block for a composition the package's default does not ship: a variant builder of the caller's own — a
 *   simulator sync in tests, or the projections-based fast sync, which exists on ledger-v9 only and would defeat its
 *   own purpose behind a V1 variant. Its one variant is registered from the minimum supported version, so it stamps
 *   every transaction at that floor and accepts one of any version; the price is that it cannot cross a protocol
 *   boundary. The wallet that can is `DustWallet`, in `DustWallet.ts`.
 */
import {
  type DustParameters,
  DustSecretKey,
  type FinalizedTransaction,
  LedgerParameters,
  type Signature,
  type SignatureVerifyingKey,
  type UnprovenTransaction,
} from '@midnightntwrk/ledger-v9';
import {
  type AnyTx,
  ProtocolVersion,
  type ProtocolVersionMismatchError,
  type UnprovenTx,
  WalletTransaction,
} from '@midnightntwrk/wallet-sdk-abstractions';
import { type DustAddress } from '@midnightntwrk/wallet-sdk-address-format';
import { type BlockData as PricedBlockData } from '@midnightntwrk/wallet-sdk-capabilities/validation';
import { type Runtime, WalletBuilder } from '@midnightntwrk/wallet-sdk-runtime';
import {
  StartMaterial,
  type Variant,
  type VariantBuilder,
  type WalletLike,
} from '@midnightntwrk/wallet-sdk-runtime/abstractions';
import { type Clock, EitherOps } from '@midnightntwrk/wallet-sdk-utilities';
import { Effect, Either, Option, Ref, type Scope } from 'effect';
import * as rx from 'rxjs';
import {
  claimableFeePayment,
  type DefaultDustConfiguration,
  type DustWalletAPI,
  DustWalletState,
} from './DustWalletAPI.js';
import { CoreWallet } from './v2/CoreWallet.js';
import { type RunningV2Variant, V2Tag } from './v2/RunningV2Variant.js';
import { type WalletSyncUpdate } from './v2/SyncSchema.js';
import { type NightUtxoSplitForDustRegistration } from './v2/Transacting.js';
import { type UtxoWithMeta } from './v2/types/Dust.js';
import { type AnyTransaction } from './v2/types/ledger.js';
import { type BaseV2Configuration, type V2Variant } from './v2/V2Builder.js';

export type CustomizedDustWallet<
  TStartAux = DustSecretKey,
  TTransaction = FinalizedTransaction,
  TSyncUpdate = WalletSyncUpdate,
  TSerialized = string,
> = DustWalletAPI<TStartAux, TSerialized> &
  WalletLike.WalletLike<[Variant.VersionedVariant<V2Variant<TSerialized, TSyncUpdate, TTransaction, TStartAux>>]>;

export interface CustomizedDustWalletClass<
  TStartAux = DustSecretKey,
  TTransaction = FinalizedTransaction,
  TSyncUpdate = WalletSyncUpdate,
  TSerialized = string,
  TConfig extends BaseV2Configuration = DefaultDustConfiguration,
> extends WalletLike.BaseWalletClass<
  [Variant.VersionedVariant<V2Variant<TSerialized, TSyncUpdate, TTransaction, TStartAux>>]
> {
  configuration: TConfig;
  startWithSeed(
    seed: Uint8Array,
    dustParameters?: DustParameters,
  ): CustomizedDustWallet<TStartAux, TTransaction, TSyncUpdate, TSerialized>;
  startWithSecretKey(
    secretKey: DustSecretKey,
    dustParameters?: DustParameters,
  ): CustomizedDustWallet<TStartAux, TTransaction, TSyncUpdate, TSerialized>;
  restore(serializedState: TSerialized): CustomizedDustWallet<TStartAux, TTransaction, TSyncUpdate, TSerialized>;
}

export function CustomDustWallet<
  TConfig extends BaseV2Configuration = DefaultDustConfiguration,
  TStartAux extends DustSecretKey = DustSecretKey,
  TTransaction = FinalizedTransaction,
  TSyncUpdate = WalletSyncUpdate,
  TSerialized = string,
>(
  configuration: TConfig,
  builder: VariantBuilder.VariantBuilder<V2Variant<TSerialized, TSyncUpdate, TTransaction, TStartAux>, TConfig>,
): CustomizedDustWalletClass<TStartAux, TTransaction, TSyncUpdate, TSerialized, TConfig> {
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

  /** The whole of the protocol timeline: one variant answers for every version this wallet will ever see. */
  const wholeTimeline = ProtocolVersion.epochOf(
    ProtocolVersion.MinSupportedVersion,
    ProtocolVersion.MinSupportedVersion,
  );

  /** Seals a transaction this wallet built, at the version its one variant answers from. */
  const seal = (transaction: UnprovenTransaction): UnprovenTx =>
    WalletTransaction.adopt('Unproven', transaction, ProtocolVersion.MinSupportedVersion);

  /** Reads a transaction a caller handed in, which a single-variant wallet accepts at any version. */
  const carried = <T>(handle: AnyTx): Effect.Effect<T, ProtocolVersionMismatchError> =>
    EitherOps.toEffect(WalletTransaction.unwrapWithin<T>(handle, wholeTimeline));

  return class CustomDustWalletImplementation
    extends BaseWallet
    implements CustomizedDustWallet<TStartAux, TTransaction, TSyncUpdate, TSerialized>
  {
    static startWithSeed(
      seed: Uint8Array,
      // The ledger's own initial parameters when a caller names none: three rates that do not depend on this wallet,
      // and asking for them made an application import a ledger version to start one.
      dustParameters: DustParameters = LedgerParameters.initialParameters().dust,
    ): CustomDustWalletImplementation {
      const dustSecretKey = DustSecretKey.fromSeed(seed);
      return CustomDustWalletImplementation.startFirst(
        CustomDustWalletImplementation,
        CoreWallet.initEmpty(dustParameters, dustSecretKey, CustomDustWalletImplementation.configuration.networkId),
      );
    }

    static startWithSecretKey(
      secretKey: DustSecretKey,
      dustParameters: DustParameters = LedgerParameters.initialParameters().dust,
    ): CustomDustWalletImplementation {
      return CustomDustWalletImplementation.startFirst(
        CustomDustWalletImplementation,
        CoreWallet.initEmpty(dustParameters, secretKey, CustomDustWalletImplementation.configuration.networkId),
      );
    }

    static restore(serializedState: TSerialized): CustomDustWalletImplementation {
      const deserialized: CoreWallet = CustomDustWalletImplementation.allVariantsRecord()
        [V2Tag].variant.deserializeState(serializedState)
        .pipe(Either.getOrThrow);
      return CustomDustWalletImplementation.startFirst(CustomDustWalletImplementation, deserialized);
    }

    readonly state: rx.Observable<DustWalletState<TSerialized>>;

    /**
     * The start-aux the wallet was last started with.
     *
     * @remarks
     *   Sync needs the dust secret key, and a migration starts a fresh variant whose sync has never been started. The key
     *   cannot come from the state — it is deliberately absent from anything serialized — and it does not exist yet
     *   when the wallet is first constructed, so it is held here, in memory, for the lifetime of the wallet. Cleared by
     *   {@link stop} so a stopped wallet cannot be silently resurrected by a late activation.
     */
    readonly #retainedAux = Ref.unsafeMake<Option.Option<TStartAux>>(Option.none());

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
          DustWalletState.fromVariant<CoreWallet, TSerialized>(
            CustomDustWalletImplementation.allVariantsRecord()[V2Tag].variant,
            emission,
          ),
        ),
        rx.shareReplay({ refCount: true, bufferSize: 1 }),
      );
    }

    start(secretKey: TStartAux): Promise<void> {
      return Effect.gen(this, function* () {
        yield* Ref.set(this.#retainedAux, Option.some(secretKey));

        // Registered before the first dispatch, and only once: `onVariantActivation` resolves only after its
        // subscription is live, so an activation racing this call is queued rather than missed.
        const alreadyRegistered = yield* Ref.getAndSet(this.#watcherRegistered, true);
        if (!alreadyRegistered) {
          yield* this.runtime.onVariantActivation({
            [V2Tag]: (v2: RunningV2Variant<TSerialized, TSyncUpdate, TTransaction, TStartAux>) =>
              Ref.get(this.#retainedAux).pipe(
                Effect.flatMap(
                  Option.match({
                    // Stopped, or never started: there is nothing to resume and no key to resume it with.
                    onNone: () => Effect.void,
                    onSome: (retained: TStartAux) => v2.startSyncInBackground(retained),
                  }),
                ),
              ),
          });
        }

        yield* this.runtime.dispatch({ [V2Tag]: (v2) => v2.startSyncInBackground(secretKey) });
      }).pipe(Effect.runPromise);
    }

    override async stop(): Promise<void> {
      // Released before the runtime is torn down: the key outlives neither the wallet nor an in-flight activation.
      Ref.set(this.#retainedAux, Option.none()).pipe(Effect.runSync);
      await super.stop();
    }

    stepSync(secretKey: TStartAux): Promise<void> {
      return this.runtime.dispatch({ [V2Tag]: (v2) => v2.sync(secretKey) }).pipe(Effect.runPromise);
    }

    /**
     * The key material this wallet's one variant uses, from what it was started with.
     *
     * @remarks
     *   Fee payment selects dust the wallet owns, so it needs the same secret synchronization does.
     */
    #requireAux(): Effect.Effect<TStartAux, StartMaterial.MissingStartAuxError> {
      return Ref.get(this.#retainedAux).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.fail(
                new StartMaterial.MissingStartAuxError({
                  message:
                    `This wallet holds no key material: it has not been started, or it has been stopped. Start it ` +
                    `before asking it to pay a fee.`,
                  variantTag: V2Tag,
                }),
              ),
            onSome: (aux: TStartAux) => Effect.succeed(aux),
          }),
        ),
      );
    }

    async createDustGenerationTransaction(
      currentTime: Date | undefined,
      ttl: Date,
      nightUtxos: Array<UtxoWithMeta>,
      nightVerifyingKey: SignatureVerifyingKey,
      dustReceiverAddress: DustAddress | undefined,
    ): Promise<UnprovenTx> {
      return this.runtime
        .dispatch({
          [V2Tag]: (v2) =>
            v2
              .createDustGenerationTransaction(currentTime, ttl, nightUtxos, nightVerifyingKey, dustReceiverAddress)
              .pipe(Effect.map(seal)),
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
          [V2Tag]: (v2) => v2.splitNightUtxosForDustRegistration(currentTime, nightUtxos, isRegistration),
        })
        .pipe(Effect.runPromise);
    }

    async attachDustRegistration(
      transaction: UnprovenTx,
      currentTime: Date,
      nightVerifyingKey: SignatureVerifyingKey,
      dustReceiverAddress: DustAddress | undefined,
      feePayment: bigint,
    ): Promise<UnprovenTx> {
      return this.runtime
        .dispatch({
          [V2Tag]: (v2) =>
            carried<UnprovenTransaction>(transaction).pipe(
              Effect.flatMap((tx) =>
                v2.attachDustRegistration(tx, currentTime, nightVerifyingKey, dustReceiverAddress, feePayment),
              ),
              Effect.map(seal),
            ),
        })
        .pipe(Effect.runPromise);
    }

    addDustGenerationSignature(transaction: UnprovenTx, signature: Signature): Promise<UnprovenTx> {
      return this.runtime
        .dispatch({
          [V2Tag]: (v2) =>
            carried<UnprovenTransaction>(transaction).pipe(
              Effect.flatMap((tx) => v2.addDustGenerationSignature(tx, signature)),
              Effect.map(seal),
            ),
        })
        .pipe(Effect.runPromise);
    }

    addDustRegistrationSignature(transaction: UnprovenTx, signature: Signature): Promise<UnprovenTx> {
      return this.runtime
        .dispatch({
          [V2Tag]: (v2) =>
            carried<UnprovenTransaction>(transaction).pipe(
              Effect.flatMap((tx) => v2.addDustRegistrationSignature(tx, signature)),
              Effect.map(seal),
            ),
        })
        .pipe(Effect.runPromise);
    }

    calculateFee(transactions: ReadonlyArray<AnyTx>): Promise<bigint> {
      return this.runtime
        .dispatch({
          [V2Tag]: (v2) =>
            Effect.forEach(transactions, carried<AnyTransaction>).pipe(Effect.flatMap((txs) => v2.calculateFee(txs))),
        })
        .pipe(Effect.runPromise);
    }

    estimateFee(transactions: ReadonlyArray<AnyTx>, ttl?: Date, currentTime?: Date): Promise<bigint> {
      const effectiveTtl = ttl ?? new Date(Date.now() + 60 * 60 * 1000);
      return this.runtime
        .dispatch({
          [V2Tag]: (v2) =>
            Effect.all([this.#requireAux(), Effect.forEach(transactions, carried<AnyTransaction>)]).pipe(
              Effect.flatMap(([key, txs]) => v2.estimateFee(key, txs, effectiveTtl, currentTime)),
            ),
        })
        .pipe(Effect.runPromise);
    }

    balanceTransactions(
      transactions: ReadonlyArray<AnyTx>,
      ttl: Date,
      currentTime?: Date,
    ): Promise<{ transaction: UnprovenTx; blockData: PricedBlockData }> {
      return this.runtime
        .dispatch({
          [V2Tag]: (v2) =>
            Effect.all([this.#requireAux(), Effect.forEach(transactions, carried<AnyTransaction>)]).pipe(
              Effect.flatMap(([key, txs]) => v2.balanceTransactions(key, txs, ttl, currentTime)),
              Effect.map(({ transaction, blockData }) => ({ transaction: seal(transaction), blockData })),
            ),
        })
        .pipe(Effect.runPromise);
    }

    revertTransaction(transaction: AnyTx): Promise<void> {
      return this.runtime
        .dispatch({
          [V2Tag]: (v2) =>
            Either.match(WalletTransaction.unwrapWithin<AnyTransaction>(transaction, wholeTimeline), {
              onLeft: () => Effect.void,
              onRight: (tx) => v2.revertTransaction(tx),
            }),
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
          rx.filter(([dustState]) => claimableFeePayment(dustState, nightUtxos, clock.now()) >= requiredAmount),
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
