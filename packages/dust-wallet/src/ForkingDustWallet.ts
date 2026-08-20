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
 * A dust wallet that registers a variant either side of a protocol boundary and follows the chain across it.
 *
 * @remarks
 *   One wallet, two ledger versions. Before the boundary the pre-fork variant reads the chain with the ledger version
 *   that produced it; from the boundary the post-fork variant does, having been handed identity and a place in the
 *   timeline and nothing else — the dust itself is re-discovered from the indexer's replay, which is what
 *   `test/forkSimulation.test.ts` proves. Which variant is running is the runtime's business, not the application's:
 *   the wallet's public API speaks the post-fork ledger version throughout, and where the two sides genuinely differ —
 *   the key material each variant's synchronization needs — the wallet resolves it per variant from what it retained.
 */
import * as v8 from '@midnight-ntwrk/ledger-v8';
import * as ledger from '@midnightntwrk/ledger-v9';
import {
  type AnyTx,
  ProtocolVersion,
  type ProtocolVersionMismatchError,
  type UnprovenTx,
  WalletSeed,
  WalletTransaction,
} from '@midnightntwrk/wallet-sdk-abstractions';
import { type DustAddress } from '@midnightntwrk/wallet-sdk-address-format';
import * as PreForkSignatures from '@midnightntwrk/wallet-sdk-capabilities/signatures';
import { type Runtime, WalletBuilder } from '@midnightntwrk/wallet-sdk-runtime';
import {
  StartMaterial,
  type Variant,
  type VariantBuilder,
  type WalletLike,
} from '@midnightntwrk/wallet-sdk-runtime/abstractions';
import { type Clock, EitherOps, HList } from '@midnightntwrk/wallet-sdk-utilities';
import { Effect, Either, Option, Ref, type Scope } from 'effect';
import * as rx from 'rxjs';
import { variantForSnapshot } from './Restore.js';
import { type DefaultDustConfiguration, type DustWalletAPI, DustWalletState } from './DustWallet.js';
import { type BlockData as PricedBlockData } from '@midnightntwrk/wallet-sdk-capabilities/validation';
import { CoreWallet as PreForkCoreWallet, V1Builder, V1Tag, type V1Variant } from './v1/index.js';
import { type WalletSyncUpdate as PreForkSyncUpdate } from './v1/Sync.js';
import { CoreWallet, Migration, V2Builder, V2Tag, type V2Variant } from './v2/index.js';
import { type WalletSyncUpdate as PostForkSyncUpdate } from './v2/SyncSchema.js';
import { type NightUtxoSplitForDustRegistration } from './v2/Transacting.js';
import { type UtxoWithMeta } from './v2/types/Dust.js';
import { type NetworkId } from './v2/types/index.js';
import { type AnyTransaction as PreForkAnyTransaction } from './v1/types/ledger.js';
import { type AnyTransaction } from './v2/types/ledger.js';
import { type WalletError } from './v2/WalletError.js';

/**
 * What a transacting call can fail with.
 *
 * @remarks
 *   Three failures beyond the variant's own: the wallet may hold no key material the current variant can use, a
 *   transaction handed in may have been built on the other side of the boundary, and a signature or verifying key may
 *   name a signature scheme the pre-fork ledger version does not have.
 */
type TransactingError =
  | WalletError
  | StartMaterial.MissingStartAuxError
  | ProtocolVersionMismatchError
  | PreForkSignatures.UnsupportedSignatureKindError;

/** The pre-fork variant a forking dust wallet registers: the one that reads the chain before the boundary. */
export type PreForkDustVariant<TSyncUpdate> = V1Variant<string, TSyncUpdate, v8.FinalizedTransaction, v8.DustSecretKey>;

/** The post-fork variant a forking dust wallet registers: the one the pre-fork wallet is migrated into. */
export type PostForkDustVariant<TSyncUpdate> = V2Variant<
  string,
  TSyncUpdate,
  ledger.FinalizedTransaction,
  ledger.DustSecretKey,
  Migration.PreviousLedgerWallet
>;

/** The two variants a forking dust wallet runs, in registration order. */
export type ForkingDustVariants<TPreForkSyncUpdate, TPostForkSyncUpdate> = [
  Variant.VersionedVariant<PreForkDustVariant<TPreForkSyncUpdate>>,
  Variant.VersionedVariant<PostForkDustVariant<TPostForkSyncUpdate>>,
];

/**
 * A variant builder registered together with the configuration it alone is built from.
 *
 * @remarks
 *   Per-variant rather than shared, and for dust the hazard is concrete rather than theoretical: both variants declare an
 *   optional `dustParameters`, each of its own ledger's `DustParameters`. The two classes are structurally identical,
 *   so a wallet-wide intersection accepts either and then hands whichever was supplied to _both_ variants — one of
 *   which would be building a `DustLocalState` out of the other module's WASM object. Splitting the configuration is
 *   what makes that unrepresentable.
 */
export type SelfConfiguredDustVariant<TVariant extends Variant.AnyVariant, TConfiguration extends object> = Readonly<{
  builder: VariantBuilder.VariantBuilder<TVariant, TConfiguration>;
  configuration: TConfiguration;
}>;

/** What a forking dust wallet needs to know about itself, whatever its variants are built from. */
export type ForkingDustConfiguration = {
  networkId: NetworkId;
  /** The protocol version at which the chain hands over from the pre-fork ledger version to the post-fork one. */
  forkVersion: ProtocolVersion.ProtocolVersion;
};

/** A running dust wallet that spans a protocol boundary. */
export type ForkingDustWallet<TPreForkSyncUpdate, TPostForkSyncUpdate> = DustWalletAPI<ledger.DustSecretKey, string> &
  WalletLike.WalletLike<ForkingDustVariants<TPreForkSyncUpdate, TPostForkSyncUpdate>>;

/** The class a forking dust wallet is started from. */
export interface ForkingDustWalletClass<
  TPreForkSyncUpdate,
  TPostForkSyncUpdate,
  TConfiguration extends ForkingDustConfiguration = ForkingDustConfiguration,
> extends WalletLike.BaseWalletClass<ForkingDustVariants<TPreForkSyncUpdate, TPostForkSyncUpdate>, TConfiguration> {
  /**
   * Builds a wallet from a seed, and remembers the seed.
   *
   * @remarks
   *   The only start that can follow the chain the whole way. The seed is the one piece of key material that crosses a
   *   protocol boundary — each variant derives its own `DustSecretKey` from it, and the two derive the same dust public
   *   key — so a wallet built this way can synchronize on either side of the fork. It begins on the pre-fork variant
   *   and is handed over when the chain reports a version the post-fork variant owns, which on a chain that has already
   *   forked happens on the first batch it sees.
   * @param seed The seed to derive both ledger versions' dust keys from.
   * @param dustParameters The post-fork ledger version's dust parameters, which an empty post-fork state is valued
   *   against.
   * @returns A wallet started on the pre-fork variant.
   */
  startWithSeed(
    seed: Uint8Array,
    dustParameters: ledger.DustParameters,
  ): ForkingDustWallet<TPreForkSyncUpdate, TPostForkSyncUpdate>;
  /**
   * Builds a wallet from a post-fork dust key, starting it on the post-fork variant.
   *
   * @remarks
   *   A `DustSecretKey` belongs to one ledger version's runtime, so it answers for one variant and no other: there is
   *   nothing to convert, and the dust public keys being identical either side does not help — reading dust needs the
   *   secret. A wallet built this way therefore starts on the variant its key belongs to and stays there. It cannot
   *   read a chain that is still pre-fork, which is the honest consequence of holding only a post-fork key; start from
   *   a seed to do that.
   * @param secretKey The post-fork ledger version's dust secret key.
   * @param dustParameters The post-fork ledger version's dust parameters.
   * @returns A wallet started on the post-fork variant.
   */
  startWithSecretKey(
    secretKey: ledger.DustSecretKey,
    dustParameters: ledger.DustParameters,
  ): ForkingDustWallet<TPreForkSyncUpdate, TPostForkSyncUpdate>;
  /**
   * Restores a wallet from a snapshot, into whichever registered variant wrote it.
   *
   * @param serializedState The serialized wallet state.
   * @returns A wallet started from that state, on the variant that owns its protocol version.
   * @throws UnsupportedSnapshotVersionError if the snapshot declares a version no registered variant reads.
   */
  restore(serializedState: string): ForkingDustWallet<TPreForkSyncUpdate, TPostForkSyncUpdate>;
}

/**
 * The same dust parameters, rebuilt by the pre-fork ledger version.
 *
 * @remarks
 *   Dust's own departure from shielded, and the one place this wallet has to translate anything. `DustLocalState` is
 *   parameterised, so an empty pre-fork state cannot be built without a pre-fork `DustParameters` — and the application
 *   hands over a post-fork one, because that is the ledger version this wallet's public API speaks. What crosses is
 *   therefore the three numbers, not the object: they are plain `bigint`s, and the pre-fork class takes exactly them.
 * @param parameters The post-fork ledger version's dust parameters.
 * @returns The same generation and decay rates, as a pre-fork `DustParameters`.
 */
export const asPreForkDustParameters = (parameters: ledger.DustParameters): v8.DustParameters =>
  new v8.DustParameters(parameters.nightDustRatio, parameters.generationDecayRate, parameters.dustGracePeriodSeconds);

/**
 * Builds a dust wallet class over a variant either side of a protocol boundary.
 *
 * @remarks
 *   The boundary is `configuration.forkVersion` and nothing else: the pre-fork variant is registered from the minimum
 *   supported version and the post-fork one from the fork version, so the version at which the runtime hands over and
 *   the version at which each variant stops applying are the same number, taken from one place.
 *
 *   Each variant is built from its own configuration, which for dust is load-bearing rather than tidy — see
 *   {@link SelfConfiguredDustVariant}.
 * @example
 *   ```typescript
 *   const Wallet = CustomForkingDustWallet(
 *     { forkVersion },
 *     { builder: new V1Builder().withDefaults(), configuration: preForkConfiguration },
 *     { builder: new V2Builder().withDefaults().withMigration(...), configuration: postForkConfiguration },
 *   );
 *   const wallet = Wallet.startWithSeed(seed, dustParameters);
 *   ```;
 *
 * @param configuration What the wallet layer needs: where the boundary lies.
 * @param preFork The variant that reads the chain below the boundary, with the configuration it is built from.
 * @param postFork The variant that reads it from the boundary, with the configuration it is built from.
 * @returns The wallet class.
 */
export function CustomForkingDustWallet<
  TPreForkSyncUpdate,
  TPostForkSyncUpdate,
  TPreForkConfig extends object,
  TPostForkConfig extends object,
  TConfiguration extends ForkingDustConfiguration = ForkingDustConfiguration,
>(
  configuration: TConfiguration,
  preFork: SelfConfiguredDustVariant<PreForkDustVariant<TPreForkSyncUpdate>, TPreForkConfig>,
  postFork: SelfConfiguredDustVariant<PostForkDustVariant<TPostForkSyncUpdate>, TPostForkConfig>,
): ForkingDustWalletClass<TPreForkSyncUpdate, TPostForkSyncUpdate, TConfiguration> {
  type Variants = ForkingDustVariants<TPreForkSyncUpdate, TPostForkSyncUpdate>;
  type RetainedStartMaterial = StartMaterial.StartMaterial<ledger.DustSecretKey>;

  // Registered through the shape the builder states rather than through the one this function was handed. The two are
  // the same builder; what is dropped is the configuration *type*, which the parameter types have already paired with
  // its builder — and which, left generic, keeps `build`'s "nothing further is owed" argument list unresolvable.
  const preForkBuilder: VariantBuilder.VariantBuilder<PreForkDustVariant<TPreForkSyncUpdate>, object> = preFork.builder;
  const postForkBuilder: VariantBuilder.VariantBuilder<
    PostForkDustVariant<TPostForkSyncUpdate>,
    object
  > = postFork.builder;

  const BaseWallet: WalletLike.BaseWalletClass<Variants> = WalletBuilder.init()
    .withVariant(ProtocolVersion.MinSupportedVersion, preForkBuilder, preFork.configuration)
    .withVariant(configuration.forkVersion, postForkBuilder, postFork.configuration)
    .build();

  const variants = BaseWallet.allVariantsRecord();

  /**
   * The pre-fork variant's key material, which only a retained seed can produce.
   *
   * @remarks
   *   The wallet's public API speaks the post-fork ledger version's `DustSecretKey`, and the pre-fork variant cannot use
   *   one: they belong to different ledger runtimes and each declares a private constructor, so the type system agrees.
   *   A wallet holding a key object therefore has nothing this variant can start with, and says so instead of handing
   *   over a key it would silently misuse.
   */
  const preForkAux = (
    retained: RetainedStartMaterial,
  ): Either.Either<v8.DustSecretKey, StartMaterial.MissingStartAuxError> =>
    StartMaterial.requireDerivedAuxFor(retained, V1Tag, (seed) => variants[V1Tag].variant.startAux.fromSeed(seed));

  /** The post-fork variant's key material: what the application handed over, or the retained seed's derivation. */
  const postForkAux = (
    retained: RetainedStartMaterial,
  ): Either.Either<ledger.DustSecretKey, StartMaterial.MissingStartAuxError> =>
    StartMaterial.requireAuxFor(retained, V2Tag, (seed) => variants[V2Tag].variant.startAux.fromSeed(seed));

  /**
   * The protocol versions each variant owns, and the version a transaction it builds is stamped with.
   *
   * @remarks
   *   The stamp is the floor of the variant's epoch: every decision it is later read for asks which side of the boundary
   *   the bytes belong to, and the floor answers that the same way as any other version in the same epoch.
   */
  const preForkEpoch = ProtocolVersion.epochOf(ProtocolVersion.MinSupportedVersion, configuration.forkVersion);
  const postForkEpoch = ProtocolVersion.epochOf(configuration.forkVersion, configuration.forkVersion);
  const [preForkStamp] = preForkEpoch;
  const [postForkStamp] = postForkEpoch;

  /** Reads a transaction built before the boundary, refusing one built after it. */
  const preForkTx = <T>(handle: AnyTx): Effect.Effect<T, ProtocolVersionMismatchError> =>
    EitherOps.toEffect(WalletTransaction.unwrapWithin<T>(handle, preForkEpoch));

  /** Reads a transaction built from the boundary, refusing one built before it. */
  const postForkTx = <T>(handle: AnyTx): Effect.Effect<T, ProtocolVersionMismatchError> =>
    EitherOps.toEffect(WalletTransaction.unwrapWithin<T>(handle, postForkEpoch));

  return class ForkingDustWalletImplementation
    extends BaseWallet
    implements ForkingDustWallet<TPreForkSyncUpdate, TPostForkSyncUpdate>
  {
    static readonly configuration: TConfiguration = configuration;

    static startWithSeed(seed: Uint8Array, dustParameters: ledger.DustParameters): ForkingDustWalletImplementation {
      const walletSeed = WalletSeed.WalletSeed(seed);
      const wallet = ForkingDustWalletImplementation.startFirst(
        ForkingDustWalletImplementation,
        // Valued against the same rates the caller named, rebuilt by the ledger version that owns this state — see
        // {@link asPreForkDustParameters}. The post-fork side's own empty state is the migration's business.
        PreForkCoreWallet.initEmpty(
          asPreForkDustParameters(dustParameters),
          variants[V1Tag].variant.startAux.fromSeed(walletSeed),
          configuration.networkId,
        ),
      );
      wallet.#retainSeed(walletSeed);
      return wallet;
    }

    static startWithSecretKey(
      secretKey: ledger.DustSecretKey,
      dustParameters: ledger.DustParameters,
    ): ForkingDustWalletImplementation {
      return ForkingDustWalletImplementation.startAtVariant(
        ForkingDustWalletImplementation,
        variants[V2Tag],
        // Stamped with the boundary version rather than left at the minimum: a variant that starts from a state
        // outside its own activation range reports that on sight, which is how a stranded snapshot heals — and here
        // there is no variant above this one to hand over to. The state does belong to this variant, so it says so.
        CoreWallet.withProtocolVersion(
          CoreWallet.initEmpty(dustParameters, secretKey, configuration.networkId),
          configuration.forkVersion,
        ),
      );
    }

    static restore(serializedState: string): ForkingDustWalletImplementation {
      const headVariant = HList.head(ForkingDustWalletImplementation.allVariants());
      const variant = variantForSnapshot(
        serializedState,
        (version) => ForkingDustWalletImplementation.variantFor(version),
        headVariant,
      ).pipe(Either.getOrThrow);
      // Stated with its result type because the resolved variant is either of the two, so its deserializer is either
      // of theirs: what comes back is a state of whichever one wrote the snapshot, which is what `startAtVariant`
      // takes.
      const deserialized = Either.getOrThrow<PreForkCoreWallet | CoreWallet, unknown>(
        variant.variant.deserializeState(serializedState),
      );

      return ForkingDustWalletImplementation.startAtVariant(ForkingDustWalletImplementation, variant, deserialized);
    }

    readonly state: rx.Observable<DustWalletState<string>>;

    /**
     * What the application started this wallet with, kept so synchronization can be started again.
     *
     * @remarks
     *   A migration starts a fresh variant whose sync has never run, and sync needs key material that is deliberately
     *   absent from anything the wallet serializes. A retained seed answers for both variants; a retained key object
     *   answers only for the post-fork one, which is the ledger version this wallet's public API speaks. Cleared by
     *   {@link stop} so a stopped wallet cannot be resurrected by a late activation.
     */
    readonly #retainedStartMaterial = Ref.unsafeMake<Option.Option<RetainedStartMaterial>>(Option.none());

    /** Remembers a seed, which supersedes any key object retained for an individual variant. */
    #retainSeed(seed: WalletSeed.WalletSeed): void {
      Ref.set(this.#retainedStartMaterial, Option.some(StartMaterial.fromSeed<ledger.DustSecretKey>(seed))).pipe(
        Effect.runSync,
      );
    }

    /**
     * Starts synchronization on a variant that has just become current, with key material it can use.
     *
     * @param running The variant to start.
     * @param auxFor That variant's own resolution of what it can be started with.
     */
    #resumeSyncOn<TStartAux>(
      running: { startSyncInBackground: (aux: TStartAux) => Effect.Effect<void> },
      auxFor: (retained: RetainedStartMaterial) => Either.Either<TStartAux, StartMaterial.MissingStartAuxError>,
    ): Effect.Effect<void, StartMaterial.MissingStartAuxError> {
      return Ref.get(this.#retainedStartMaterial).pipe(
        Effect.flatMap(
          Option.match({
            // Stopped, or never started: there is nothing to resume and nothing to resume it with.
            onNone: () => Effect.void,
            onSome: (retained: RetainedStartMaterial) =>
              EitherOps.toEffect(auxFor(retained)).pipe(Effect.flatMap((aux) => running.startSyncInBackground(aux))),
          }),
        ),
      );
    }

    /** One synchronization step on a variant, with key material it can use. */
    #stepSyncOn<TStartAux, TError>(
      running: { sync: (aux: TStartAux) => Effect.Effect<void, TError> },
      auxFor: (retained: RetainedStartMaterial) => Either.Either<TStartAux, StartMaterial.MissingStartAuxError>,
    ): Effect.Effect<void, TError | StartMaterial.MissingStartAuxError> {
      return Ref.get(this.#retainedStartMaterial).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.void,
            onSome: (retained: RetainedStartMaterial) =>
              EitherOps.toEffect(auxFor(retained)).pipe(Effect.flatMap((aux) => running.sync(aux))),
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

    constructor(runtime: Runtime.Runtime<Variants>, scope: Scope.CloseableScope) {
      super(runtime, scope);
      this.state = this.rawState.pipe(
        rx.map((emission) =>
          // The capabilities that understand a state and the state itself are chosen together, in the branch where
          // the producing variant is known. The two variants' capability types are structurally identical, so a
          // capability of one would type-check against a state of the other and be wrong at runtime.
          emission.variantTag === V2Tag
            ? DustWalletState.fromVariant(variants[V2Tag].variant, emission)
            : DustWalletState.fromVariant(variants[V1Tag].variant, emission),
        ),
        rx.shareReplay({ refCount: true, bufferSize: 1 }),
      );
    }

    /**
     * Starts background synchronization on whichever variant is current, and keeps the key for the next one.
     *
     * @remarks
     *   The key is the post-fork ledger version's, so it is retained against that variant alone. A wallet still on the
     *   pre-fork variant is started from what it retained instead — which a wallet built from a seed can always answer,
     *   and a wallet built from a key object cannot.
     * @param secretKey The post-fork ledger version's dust secret key.
     */
    start(secretKey: ledger.DustSecretKey): Promise<void> {
      return Effect.gen(this, function* () {
        yield* Ref.update(this.#retainedStartMaterial, (retained) =>
          Option.some(
            Option.match(retained, {
              onNone: () => StartMaterial.forVariant<ledger.DustSecretKey>(V2Tag, secretKey),
              // A retained seed already answers for every variant, including ones this wallet has not met, so a key
              // object for one of them adds nothing. Otherwise the objects accumulate per variant tag.
              onSome: (existing: RetainedStartMaterial) =>
                existing._tag === 'FromSeed'
                  ? existing
                  : StartMaterial.forVariants<ledger.DustSecretKey>([...existing.byTag, [V2Tag, secretKey]]),
            }),
          ),
        );

        // Registered before the first dispatch, and only once: `onVariantActivation` resolves only after its
        // subscription is live, so an activation racing this call is queued rather than missed.
        const alreadyRegistered = yield* Ref.getAndSet(this.#watcherRegistered, true);
        if (!alreadyRegistered) {
          yield* this.runtime.onVariantActivation({
            [V1Tag]: (v1) => this.#resumeSyncOn(v1, preForkAux),
            [V2Tag]: (v2) => this.#resumeSyncOn(v2, postForkAux),
          });
        }

        yield* this.runtime.dispatch({
          [V1Tag]: (v1) => this.#resumeSyncOn(v1, preForkAux),
          [V2Tag]: (v2) => v2.startSyncInBackground(secretKey),
        });
      }).pipe(Effect.runPromise);
    }

    async stop(): Promise<void> {
      // Released before the runtime is torn down: the key material outlives neither the wallet nor an in-flight
      // activation.
      Ref.set(this.#retainedStartMaterial, Option.none()).pipe(Effect.runSync);
      await super.stop();
    }

    /**
     * Runs one synchronization step on whichever variant is current.
     *
     * @remarks
     *   Available on both sides of the boundary: the pre-fork variant is stepped with a key derived from what the wallet
     *   retained, exactly as background synchronization is.
     * @param secretKey The post-fork ledger version's dust secret key.
     */
    stepSync(secretKey: ledger.DustSecretKey): Promise<void> {
      return this.runtime
        .dispatch<void, WalletError | StartMaterial.MissingStartAuxError>({
          [V1Tag]: (v1) => this.#stepSyncOn(v1, preForkAux),
          [V2Tag]: (v2) => v2.sync(secretKey),
        })
        .pipe(Effect.runPromise);
    }

    /**
     * The key material the variant that is current can use, from what this wallet retained.
     *
     * @remarks
     *   Fee payment selects dust the wallet owns, so it needs the same secret synchronization does. A wallet that was
     *   never started, or one holding a key object of the other ledger version, has none the current variant can use
     *   and says so by name.
     */
    #requireAux<TAux>(
      auxFor: (retained: RetainedStartMaterial) => Either.Either<TAux, StartMaterial.MissingStartAuxError>,
      variantTag: symbol,
    ): Effect.Effect<TAux, StartMaterial.MissingStartAuxError> {
      return Ref.get(this.#retainedStartMaterial).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.fail(
                new StartMaterial.MissingStartAuxError({
                  message:
                    `This wallet holds no key material: it has not been started, or it has been stopped. Start it ` +
                    `before asking it to pay a fee.`,
                  variantTag,
                }),
              ),
            onSome: (retained: RetainedStartMaterial) => EitherOps.toEffect(auxFor(retained)),
          }),
        ),
      );
    }

    createDustGenerationTransaction(
      currentTime: Date | undefined,
      ttl: Date,
      nightUtxos: Array<UtxoWithMeta>,
      nightVerifyingKey: ledger.SignatureVerifyingKey,
      dustReceiverAddress: DustAddress | undefined,
    ): Promise<UnprovenTx> {
      return this.runtime
        .dispatch<UnprovenTx, TransactingError>({
          [V1Tag]: (v1) =>
            EitherOps.toEffect(PreForkSignatures.lowerSignatureVerifyingKey(nightVerifyingKey)).pipe(
              Effect.flatMap((key) =>
                v1.createDustGenerationTransaction(currentTime, ttl, nightUtxos, key, dustReceiverAddress),
              ),
              Effect.map((tx) => WalletTransaction.adopt('Unproven', tx, preForkStamp)),
            ),
          [V2Tag]: (v2) =>
            v2
              .createDustGenerationTransaction(currentTime, ttl, nightUtxos, nightVerifyingKey, dustReceiverAddress)
              .pipe(Effect.map((tx) => WalletTransaction.adopt('Unproven', tx, postForkStamp))),
        })
        .pipe(Effect.runPromise);
    }

    /**
     * Splits Night UTxOs into the ones a registration puts in its guaranteed and fallible sections.
     *
     * @remarks
     *   Available on both sides of the boundary, and deliberately not part of the seam above: it takes and returns plain
     *   data — UTxOs, dust generation readings, a fee amount — and touches no transaction at all, so there is nothing
     *   here that needs proving and nothing the pre-fork variant cannot answer.
     */
    splitNightUtxosForDustRegistration(
      currentTime: Date,
      nightUtxos: ReadonlyArray<UtxoWithMeta>,
      isRegistration: boolean,
    ): Promise<NightUtxoSplitForDustRegistration> {
      return this.runtime
        .dispatch<NightUtxoSplitForDustRegistration, WalletError>({
          [V1Tag]: (v1) => v1.splitNightUtxosForDustRegistration(currentTime, nightUtxos, isRegistration),
          [V2Tag]: (v2) => v2.splitNightUtxosForDustRegistration(currentTime, nightUtxos, isRegistration),
        })
        .pipe(Effect.runPromise);
    }

    attachDustRegistration(
      transaction: UnprovenTx,
      currentTime: Date,
      nightVerifyingKey: ledger.SignatureVerifyingKey,
      dustReceiverAddress: DustAddress | undefined,
      feePayment: bigint,
    ): Promise<UnprovenTx> {
      return this.runtime
        .dispatch<UnprovenTx, TransactingError>({
          [V1Tag]: (v1) =>
            Effect.all([
              preForkTx<v8.UnprovenTransaction>(transaction),
              EitherOps.toEffect(PreForkSignatures.lowerSignatureVerifyingKey(nightVerifyingKey)),
            ]).pipe(
              Effect.flatMap(([tx, key]) =>
                v1.attachDustRegistration(tx, currentTime, key, dustReceiverAddress, feePayment),
              ),
              Effect.map((tx) => WalletTransaction.adopt('Unproven', tx, preForkStamp)),
            ),
          [V2Tag]: (v2) =>
            postForkTx<ledger.UnprovenTransaction>(transaction).pipe(
              Effect.flatMap((tx) =>
                v2.attachDustRegistration(tx, currentTime, nightVerifyingKey, dustReceiverAddress, feePayment),
              ),
              Effect.map((tx) => WalletTransaction.adopt('Unproven', tx, postForkStamp)),
            ),
        })
        .pipe(Effect.runPromise);
    }

    addDustGenerationSignature(transaction: UnprovenTx, signature: ledger.Signature): Promise<UnprovenTx> {
      return this.runtime
        .dispatch<UnprovenTx, TransactingError>({
          [V1Tag]: (v1) =>
            Effect.all([
              preForkTx<v8.UnprovenTransaction>(transaction),
              EitherOps.toEffect(PreForkSignatures.lowerSignature(signature)),
            ]).pipe(
              Effect.flatMap(([tx, lowered]) => v1.addDustGenerationSignature(tx, lowered)),
              Effect.map((tx) => WalletTransaction.adopt('Unproven', tx, preForkStamp)),
            ),
          [V2Tag]: (v2) =>
            postForkTx<ledger.UnprovenTransaction>(transaction).pipe(
              Effect.flatMap((tx) => v2.addDustGenerationSignature(tx, signature)),
              Effect.map((tx) => WalletTransaction.adopt('Unproven', tx, postForkStamp)),
            ),
        })
        .pipe(Effect.runPromise);
    }

    addDustRegistrationSignature(transaction: UnprovenTx, signature: ledger.Signature): Promise<UnprovenTx> {
      return this.runtime
        .dispatch<UnprovenTx, TransactingError>({
          [V1Tag]: (v1) =>
            Effect.all([
              preForkTx<v8.UnprovenTransaction>(transaction),
              EitherOps.toEffect(PreForkSignatures.lowerSignature(signature)),
            ]).pipe(
              Effect.flatMap(([tx, lowered]) => v1.addDustRegistrationSignature(tx, lowered)),
              Effect.map((tx) => WalletTransaction.adopt('Unproven', tx, preForkStamp)),
            ),
          [V2Tag]: (v2) =>
            postForkTx<ledger.UnprovenTransaction>(transaction).pipe(
              Effect.flatMap((tx) => v2.addDustRegistrationSignature(tx, signature)),
              Effect.map((tx) => WalletTransaction.adopt('Unproven', tx, postForkStamp)),
            ),
        })
        .pipe(Effect.runPromise);
    }

    calculateFee(transactions: ReadonlyArray<AnyTx>): Promise<bigint> {
      return this.runtime
        .dispatch<bigint, TransactingError>({
          [V1Tag]: (v1) =>
            Effect.forEach(transactions, preForkTx<PreForkAnyTransaction>).pipe(
              Effect.flatMap((txs) => v1.calculateFee(txs)),
            ),
          [V2Tag]: (v2) =>
            Effect.forEach(transactions, postForkTx<AnyTransaction>).pipe(
              Effect.flatMap((txs) => v2.calculateFee(txs)),
            ),
        })
        .pipe(Effect.runPromise);
    }

    estimateFee(transactions: ReadonlyArray<AnyTx>, ttl?: Date, currentTime?: Date): Promise<bigint> {
      const effectiveTtl = ttl ?? new Date(Date.now() + 60 * 60 * 1000);
      return this.runtime
        .dispatch<bigint, TransactingError>({
          [V1Tag]: (v1) =>
            Effect.all([
              this.#requireAux(preForkAux, V1Tag),
              Effect.forEach(transactions, preForkTx<PreForkAnyTransaction>),
            ]).pipe(Effect.flatMap(([key, txs]) => v1.estimateFee(key, txs, effectiveTtl, currentTime))),
          [V2Tag]: (v2) =>
            Effect.all([
              this.#requireAux(postForkAux, V2Tag),
              Effect.forEach(transactions, postForkTx<AnyTransaction>),
            ]).pipe(Effect.flatMap(([key, txs]) => v2.estimateFee(key, txs, effectiveTtl, currentTime))),
        })
        .pipe(Effect.runPromise);
    }

    balanceTransactions(
      transactions: ReadonlyArray<AnyTx>,
      ttl: Date,
      currentTime?: Date,
    ): Promise<{ transaction: UnprovenTx; blockData: PricedBlockData }> {
      return this.runtime
        .dispatch<{ transaction: UnprovenTx; blockData: PricedBlockData }, TransactingError>({
          [V1Tag]: (v1) =>
            Effect.all([
              this.#requireAux(preForkAux, V1Tag),
              Effect.forEach(transactions, preForkTx<PreForkAnyTransaction>),
            ]).pipe(
              Effect.flatMap(([key, txs]) => v1.balanceTransactions(key, txs, ttl, currentTime)),
              Effect.map(({ transaction, blockData }) => ({
                transaction: WalletTransaction.adopt('Unproven', transaction, preForkStamp),
                blockData,
              })),
            ),
          [V2Tag]: (v2) =>
            Effect.all([
              this.#requireAux(postForkAux, V2Tag),
              Effect.forEach(transactions, postForkTx<AnyTransaction>),
            ]).pipe(
              Effect.flatMap(([key, txs]) => v2.balanceTransactions(key, txs, ttl, currentTime)),
              Effect.map(({ transaction, blockData }) => ({
                transaction: WalletTransaction.adopt('Unproven', transaction, postForkStamp),
                blockData,
              })),
            ),
        })
        .pipe(Effect.runPromise);
    }

    /**
     * Un-records a transaction this wallet paid the fee for, releasing the dust it had booked.
     *
     * @remarks
     *   A transaction built on the other side of the boundary cannot have had its fee paid by the current variant, so
     *   there is no dust of it to release and this resolves having done nothing. That is the one place a version
     *   mismatch is not an error: the facade reverts all three wallets together when a submission fails, and a refusal
     *   here would strand that whole path over a transaction this wallet was never holding anything for.
     * @param transaction The transaction to un-record.
     */
    revertTransaction(transaction: AnyTx): Promise<void> {
      return this.runtime
        .dispatch<void, TransactingError>({
          [V1Tag]: (v1) =>
            Either.match(WalletTransaction.unwrapWithin<PreForkAnyTransaction>(transaction, preForkEpoch), {
              onLeft: () => Effect.void,
              onRight: (tx) => v1.revertTransaction(tx),
            }),
          [V2Tag]: (v2) =>
            Either.match(WalletTransaction.unwrapWithin<AnyTransaction>(transaction, postForkEpoch), {
              onLeft: () => Effect.void,
              onRight: (tx) => v2.revertTransaction(tx),
            }),
        })
        .pipe(Effect.runPromise);
    }

    waitForSyncedState(allowedGap: bigint = 0n): Promise<DustWalletState<string>> {
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
      // Combine the dust state stream with a 1 s tick — the dust state only emits when sync updates apply, but the
      // generation projection depends on a current-time reading, which advances continuously.
      await rx.firstValueFrom(
        rx.combineLatest([this.state, rx.timer(0, 1000)]).pipe(
          rx.filter(([dustState]) => {
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

    serializeState(): Promise<string> {
      return rx.firstValueFrom(this.state).then((state) => state.serialize());
    }

    getAddress(): Promise<DustAddress> {
      return rx.firstValueFrom(this.state).then((state) => state.address);
    }
  };
}

/** A dust wallet built the way this package ships it: one variant either side of the protocol boundary. */
export type DustWallet = ForkingDustWallet<PreForkSyncUpdate, PostForkSyncUpdate>;

/** The class {@link DustWallet} builds. */
export type DustWalletClass = ForkingDustWalletClass<PreForkSyncUpdate, PostForkSyncUpdate, DefaultDustConfiguration>;

/**
 * Builds the dust wallet this package ships: the default variant either side of `configuration.forkVersion`.
 *
 * @remarks
 *   Both variants read the chain through the indexer's dust event subscription and record transaction history in the same
 *   storage. Each is built from the same application configuration, because what they ask for happens to coincide —
 *   with one exception the type system cannot police: `dustParameters` names a ledger type, and the two ledgers'
 *   `DustParameters` are structurally identical, so it is passed only to the variant it belongs to.
 *
 *   **The pre-fork variant syncs by event replay only.** The projections fast-sync path is a post-fork capability: it
 *   needs four `DustLocalState` APIs that no published pre-fork ledger has. That is a permanent property of the
 *   pre-fork variant, not a gap to be closed.
 *
 *   **Fee-paying operations work on either side of the boundary**: the active variant answers with its own ledger's
 *   objects, and every result travels as a handle stamped with the epoch that built it.
 * @param configuration What the wallet and both its variants are built from, including where the boundary lies.
 * @returns The wallet class.
 */
export function DustWallet(configuration: DefaultDustConfiguration): DustWalletClass {
  const dustParameters = configuration.dustParameters ?? ledger.LedgerParameters.initialParameters().dust;

  return CustomForkingDustWallet(
    configuration,
    {
      builder: new V1Builder().withDefaults(),
      // The one field that cannot be shared: `dustParameters` is a WASM object of whichever ledger module produced it,
      // so the pre-fork variant is handed the pre-fork rebuild of the same rates rather than the object itself.
      configuration: { ...configuration, dustParameters: asPreForkDustParameters(dustParameters) },
    },
    {
      builder: new V2Builder()
        .withDefaults()
        .withMigration(() => Migration.makeCrossLedgerMigration({ dustParameters })),
      configuration,
    },
  );
}
