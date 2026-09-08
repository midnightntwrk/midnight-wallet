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
 *   One wallet, two ledger versions. Before the boundary the V1 variant reads the chain with the ledger version that
 *   produced it; from the boundary the V2 variant does, having been handed identity and a place in the timeline and
 *   nothing else — the dust itself is re-discovered from the indexer's replay, which is what
 *   `test/forkSimulation.test.ts` proves. Which variant is running is the runtime's business, not the application's:
 *   the wallet's public API speaks ledger-v9 throughout, and where the two sides genuinely differ — the key material
 *   each variant's synchronization needs — the wallet resolves it per variant from what it retained.
 *
 *   `DustWallet(configuration)` at the bottom is how this package ships it. `CustomForkingDustWallet` is the same wallet
 *   over builders the caller chooses, and `SingleVariantDustWallet.ts` is the composition that gives up the crossing to
 *   run one variant only.
 */
import * as ledgerV8 from '@midnight-ntwrk/ledger-v8';
import * as ledgerV9 from '@midnightntwrk/ledger-v9';
import {
  type AnyTx,
  ProtocolVersion,
  type ProtocolVersionMismatchError,
  type UnprovenTx,
  WalletSeed,
  WalletTransaction,
} from '@midnightntwrk/wallet-sdk-abstractions';
import { type DustAddress } from '@midnightntwrk/wallet-sdk-address-format';
import {
  type ChainVersionProbe,
  makeIndexerChainVersionProbe,
} from '@midnightntwrk/wallet-sdk-capabilities/chainVersion';
import * as Signatures from '@midnightntwrk/wallet-sdk-capabilities/signatures';
import { type Runtime, WalletBuilder } from '@midnightntwrk/wallet-sdk-runtime';
import {
  StartMaterial,
  Variant,
  type VariantBuilder,
  type WalletLike,
  type WalletRuntimeError,
} from '@midnightntwrk/wallet-sdk-runtime/abstractions';
import { type Clock, EitherOps, HList } from '@midnightntwrk/wallet-sdk-utilities';
import { Duration, Effect, Either, Option, Ref, type Scope, pipe } from 'effect';
import * as rx from 'rxjs';
import { type UnsupportedSnapshotVersionError, variantForSnapshot } from './Restore.js';
import {
  claimableFeePayment,
  type DefaultDustConfiguration,
  type DustWalletAPI,
  DustWalletState,
} from './DustWalletAPI.js';
import { type BlockData as PricedBlockData } from '@midnightntwrk/wallet-sdk-capabilities/validation';
import { CoreWallet as V1CoreWallet, V1Builder, V1Tag, type V1Variant } from './v1/index.js';
import { type WalletSyncUpdate as V1SyncUpdate } from './v1/Sync.js';
import { CoreWallet, Migration, V2Builder, V2Tag, type V2Variant } from './v2/index.js';
import { type WalletSyncUpdate as V2SyncUpdate } from './v2/SyncSchema.js';
import { type NightUtxoSplitForDustRegistration } from './v2/Transacting.js';
import { type UtxoWithMeta } from './v2/types/Dust.js';
import { type NetworkId } from './v2/types/index.js';
import { type AnyTransaction as V1AnyTransaction } from './v1/types/ledger.js';
import { type AnyTransaction } from './v2/types/ledger.js';
import { type WalletError as V1WalletError } from './v1/WalletError.js';
import { type WalletError } from './v2/WalletError.js';

/**
 * What restoring a Dust wallet from a snapshot can fail with.
 *
 * @remarks
 *   Two failures, and they mean different things. The snapshot may declare a protocol version no registered variant
 *   reads, which is a fact about this build of the SDK rather than about the snapshot; or the variant that owns it may
 *   be unable to make sense of the bytes, which is a fact about the snapshot. Either is an ordinary thing to meet when
 *   restoring something a user supplied, which is why `tryRestore` reports them rather than throwing.
 */
export type DustRestoreError = UnsupportedSnapshotVersionError | V1WalletError | WalletError;

/**
 * What a transacting call can fail with.
 *
 * @remarks
 *   Three failures beyond the variant's own: the wallet may hold no key material the current variant can use, a
 *   transaction handed in may have been built on the other side of the boundary, and a signature or verifying key may
 *   name a signature scheme ledger-v8 does not have.
 */
type TransactingError =
  | WalletError
  | StartMaterial.MissingStartAuxError
  | ProtocolVersionMismatchError
  | Signatures.UnsupportedSignatureKindError;

/** The V1 variant a forking dust wallet registers: the one that reads the chain before the boundary. */
export type V1DustVariant<TSyncUpdate> = V1Variant<
  string,
  TSyncUpdate,
  ledgerV8.FinalizedTransaction,
  ledgerV8.DustSecretKey
>;

/** The V2 variant a forking dust wallet registers: the one the V1 wallet is migrated into. */
export type V2DustVariant<TSyncUpdate> = V2Variant<
  string,
  TSyncUpdate,
  ledgerV9.FinalizedTransaction,
  ledgerV9.DustSecretKey,
  Migration.PreviousLedgerWallet
>;

/** The two variants a forking dust wallet runs, in registration order. */
export type ForkingDustVariants<TV1SyncUpdate, TV2SyncUpdate> = [
  Variant.VersionedVariant<V1DustVariant<TV1SyncUpdate>>,
  Variant.VersionedVariant<V2DustVariant<TV2SyncUpdate>>,
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
  /** Where each ledger version begins on this chain — see {@link ProtocolVersion.ForkSchedule}. */
  forks: ProtocolVersion.ForkSchedule;
  /**
   * How the wallet asks the chain which protocol version it is on, before it chooses a variant to start at.
   *
   * @remarks
   *   Optional, and best-effort where present: a wallet with no probe — or one whose probe does not answer in time —
   *   starts on the V1 variant and learns the version from the first event it sees, which is what a wallet with no
   *   history has always done. What a probe buys is the two things that guess costs: a hand-over per start on a chain
   *   entirely past the boundary, and, on a chain that has shown this wallet no events at all, an epoch that never gets
   *   corrected.
   *
   *   Nothing about it can make a start fail. A rejection, a timeout, a version no registered variant covers: each leaves
   *   the wallet exactly where a wallet that never asked would be.
   */
  chainVersionProbe?: ChainVersionProbe;
};

/**
 * One ledger version's dust secret key per side of a protocol boundary.
 *
 * @remarks
 *   Both sides are required. A caller holding key objects rather than a seed has to hold both, because the two belong to
 *   different ledger runtimes and neither can be derived from the other; a product with one side optional would let a
 *   wallet be built that cannot read half the chain, which is the shape this replaced.
 */
export type DustKeysByEpoch = Readonly<{
  /** The ledger-v8's dust secret key. */
  v8: ledgerV8.DustSecretKey;
  /** The ledger-v9's dust secret key. */
  v9: ledgerV9.DustSecretKey;
}>;

/**
 * A running dust wallet that spans a protocol boundary.
 *
 * @remarks
 *   Its two extra starts are the instance counterparts of the class-level ones, and they are here rather than on
 *   {@link DustWalletAPI} because only a wallet with a variant either side of a boundary has anything to do with them: a
 *   single-variant wallet speaks one ledger version, and the key `start` takes is always the right one.
 */
export type ForkingDustWallet<TV1SyncUpdate, TV2SyncUpdate> = DustWalletAPI<ledgerV9.DustSecretKey, string> &
  WalletLike.WalletLike<ForkingDustVariants<TV1SyncUpdate, TV2SyncUpdate>> & {
    /**
     * Starts this wallet from a seed, which answers for the variant either side of the boundary.
     *
     * @remarks
     *   The instance counterpart of {@link ForkingDustWalletClass.startWithSeed}, and what a wallet restored from a
     *   snapshot written below the boundary is started with. A snapshot carries no key material by design, and the
     *   variant it restores onto is the ledger-v8 one, whose synchronization the ledger-v9 key
     *   {@link DustWalletAPI.start} takes cannot serve. The class-level start answers for both sides too — but it builds
     *   a _fresh_ wallet, which is the opposite of what a caller who has just restored one wants.
     *
     *   No dust parameters are asked for, because a restored wallet needs none: they parameterise an _empty_ state, which
     *   is what a fresh build has to construct and a restored one already brought back from its snapshot.
     *
     *   The seed itself is not kept: both ledger versions' dust keys are derived from it here and retained instead, which
     *   is the same capability with a shorter-lived secret.
     * @example
     *   ```typescript
     *   const wallet = DustWallet(configuration).restore(snapshot);
     *   await wallet.startWithSeed(seed);
     *   ```;
     *
     * @param seed The seed to derive both ledger versions' dust keys from.
     * @returns Nothing; resolves once synchronization has been started on whichever variant is current.
     */
    startWithSeed(seed: Uint8Array): Promise<void>;
    /**
     * Starts this wallet from dust keys of both ledger versions.
     *
     * @remarks
     *   The instance counterpart of {@link ForkingDustWalletClass.startWithKeys}, for a caller that will not part with a
     *   seed. Both sides are required for the same reason they are there: a `DustSecretKey` belongs to one ledger
     *   version's runtime, so a wallet given one side alone could not read the other side of the chain.
     * @example
     *   ```typescript
     *   const wallet = DustWallet(configuration).restore(snapshot);
     *   await wallet.startWithKeys({ v8: v8Key, v9: v9Key });
     *   ```;
     *
     * @param keys One ledger version's dust secret key per side of the boundary.
     * @returns Nothing; resolves once synchronization has been started on whichever variant is current.
     */
    startWithKeys(keys: DustKeysByEpoch): Promise<void>;
  };

/** The class a forking dust wallet is started from. */
export interface ForkingDustWalletClass<
  TV1SyncUpdate,
  TV2SyncUpdate,
  TConfiguration extends ForkingDustConfiguration = ForkingDustConfiguration,
> extends WalletLike.BaseWalletClass<ForkingDustVariants<TV1SyncUpdate, TV2SyncUpdate>, TConfiguration> {
  /**
   * Builds a wallet from a seed, and remembers the seed.
   *
   * @remarks
   *   The only start that can follow the chain the whole way. The seed is the one piece of key material that crosses a
   *   protocol boundary — each variant derives its own `DustSecretKey` from it, and the two derive the same dust public
   *   key — so a wallet built this way can synchronize on either side of the fork.
   *
   *   Asynchronous because choosing where to begin can mean asking the chain: with a
   *   {@link ForkingDustConfiguration.chainVersionProbe} configured, the wallet starts at the variant that owns the
   *   version the chain reports, which on a chain already past the boundary is the ledger-v9 one from the first moment.
   *   Without one, or when the question goes unanswered, it begins on the V1 variant and is handed over when the chain
   *   reports a version the V2 variant owns — on a chain that has already forked, the first batch it sees.
   * @param seed The seed to derive both ledger versions' dust keys from.
   * @param dustParameters The ledger-v9's dust parameters, which an empty ledger-v9 state is valued against.
   * @returns A wallet started at the variant the chain is on, or on the V1 variant when the chain was not asked or did
   *   not say.
   */
  startWithSeed(
    seed: Uint8Array,
    dustParameters?: DustGenerationRates,
  ): Promise<ForkingDustWallet<TV1SyncUpdate, TV2SyncUpdate>>;
  /**
   * Builds a wallet from dust keys of both ledger versions.
   *
   * @remarks
   *   The escape hatch for a caller that will not hand over a seed. Both sides are required, and that is the whole point:
   *   a `DustSecretKey` belongs to one ledger version's runtime — there is nothing to convert, and the dust public keys
   *   being identical either side does not help, because reading dust needs the secret — so a wallet given one side
   *   alone could not read the other side of the chain. It costs the caller an import of both ledger packages and the
   *   same derivation done twice; a seed costs neither.
   * @param keys One ledger version's dust secret key per side of the boundary.
   * @param dustParameters The ledger-v9's dust parameters.
   * @returns A wallet started at the variant the chain is on, or on the V1 variant — where a wallet with no history
   *   belongs — when the chain was not asked or did not say.
   */
  startWithKeys(
    keys: DustKeysByEpoch,
    dustParameters?: DustGenerationRates,
  ): Promise<ForkingDustWallet<TV1SyncUpdate, TV2SyncUpdate>>;
  /**
   * Restores a wallet from a snapshot, into whichever registered variant wrote it.
   *
   * @param serializedState The serialized wallet state.
   * @returns A wallet started from that state, on the variant that owns its protocol version.
   * @throws UnsupportedSnapshotVersionError if the snapshot declares a version no registered variant reads.
   */
  restore(serializedState: string): ForkingDustWallet<TV1SyncUpdate, TV2SyncUpdate>;
  /**
   * Restores a wallet from a snapshot, reporting what it could not read rather than throwing.
   *
   * @remarks
   *   Additive alongside {@link restore}, which is unchanged and still the right shape for a snapshot the application has
   *   just written itself. This is the shape for one it has not: a snapshot a user supplied, or one written by a build
   *   of the SDK that is no longer the one running, where "I cannot read this" is an ordinary answer rather than a bug.
   *   The two cannot disagree — `restore` is this, with the reason thrown.
   * @param serializedState The serialized wallet state.
   * @returns A wallet started from that state, or the reason the snapshot could not be read. See
   *   {@link DustRestoreError}.
   */
  tryRestore(serializedState: string): Either.Either<ForkingDustWallet<TV1SyncUpdate, TV2SyncUpdate>, DustRestoreError>;
}

/**
 * The same dust parameters, rebuilt by the ledger-v8.
 *
 * @remarks
 *   Dust's own departure from shielded, and the one place this wallet has to translate anything. `DustLocalState` is
 *   parameterised, so an empty ledger-v8 state cannot be built without a ledger-v8 `DustParameters` — and the
 *   application hands over a ledger-v9 one, because that is the ledger version this wallet's public API speaks. What
 *   crosses is therefore the three numbers, not the object: they are plain `bigint`s, and the ledger-v8 class takes
 *   exactly them.
 * @param parameters The ledger-v9's dust parameters.
 * @returns The same generation and decay rates, as a ledger-v8 `DustParameters`.
 */
/**
 * The rates dust is generated and decays at, as plain data.
 *
 * @remarks
 *   Structurally what both ledger versions' `DustParameters` are — three scalars and nothing else — which is why the
 *   ledger classes remain assignable to this and a caller who already holds one can go on passing it. What it removes
 *   is the reason to obtain one: three numbers do not need a ledger version to express, and asking for a
 *   `LedgerParameters.initialParameters().dust` made an application import a ledger to start a wallet.
 */
export type DustGenerationRates = Readonly<{
  /** How much dust one Night generates, at the cap. */
  nightDustRatio: bigint;
  /** How fast dust decays once its Night is spent. */
  generationDecayRate: bigint;
  /** How long dust survives after its Night is spent. */
  dustGracePeriodSeconds: bigint;
}>;

export const asV8DustParameters = (parameters: DustGenerationRates): ledgerV8.DustParameters =>
  new ledgerV8.DustParameters(
    parameters.nightDustRatio,
    parameters.generationDecayRate,
    parameters.dustGracePeriodSeconds,
  );

/**
 * The same dust rates, as ledger-v9's parameters object.
 *
 * @remarks
 *   The mirror of {@link asV8DustParameters}, and needed for the same reason: an empty state of either variant is
 *   parameterised, and the rates a caller names are plain numbers rather than either ledger's object. Ordinarily the
 *   ledger-v9 side's empty state is the migration's business; a wallet that starts on V2 because the chain said so has
 *   no migration to get one from, and builds its own here.
 * @param parameters The rates to express.
 * @returns The same generation and decay rates, as a ledger-v9 `DustParameters`.
 */
export const asV9DustParameters = (parameters: DustGenerationRates): ledgerV9.DustParameters =>
  new ledgerV9.DustParameters(
    parameters.nightDustRatio,
    parameters.generationDecayRate,
    parameters.dustGracePeriodSeconds,
  );

/**
 * Builds a dust wallet class over a variant either side of a protocol boundary.
 *
 * @remarks
 *   The boundary is `configuration.forks.v9` and nothing else: the V1 variant is registered from the minimum supported
 *   version and the ledger-v9 one from the fork version, so the version at which the runtime hands over and the version
 *   at which each variant stops applying are the same number, taken from one place.
 *
 *   Each variant is built from its own configuration, which for dust is load-bearing rather than tidy — see
 *   {@link SelfConfiguredDustVariant}.
 * @example
 *   ```typescript
 *   const Wallet = CustomForkingDustWallet(
 *     { forks },
 *     { builder: new V1Builder().withDefaults(), configuration: v1Configuration },
 *     { builder: new V2Builder().withDefaults().withMigration(...), configuration: v2Configuration },
 *   );
 *   const wallet = Wallet.startWithSeed(seed, dustParameters);
 *   ```;
 *
 * @param configuration What the wallet layer needs: where the boundary lies.
 * @param v1 The variant that reads the chain below the boundary, with the configuration it is built from.
 * @param v2 The variant that reads it from the boundary, with the configuration it is built from.
 * @returns The wallet class.
 */
export function CustomForkingDustWallet<
  TV1SyncUpdate,
  TV2SyncUpdate,
  TV1Config extends object,
  TV2Config extends object,
  TConfiguration extends ForkingDustConfiguration = ForkingDustConfiguration,
>(
  configuration: TConfiguration,
  v1: SelfConfiguredDustVariant<V1DustVariant<TV1SyncUpdate>, TV1Config>,
  v2: SelfConfiguredDustVariant<V2DustVariant<TV2SyncUpdate>, TV2Config>,
): ForkingDustWalletClass<TV1SyncUpdate, TV2SyncUpdate, TConfiguration> {
  type Variants = ForkingDustVariants<TV1SyncUpdate, TV2SyncUpdate>;

  // Registered through the shape the builder states rather than through the one this function was handed. The two are
  // the same builder; what is dropped is the configuration *type*, which the parameter types have already paired with
  // its builder — and which, left generic, keeps `build`'s "nothing further is owed" argument list unresolvable.
  const v1Builder: VariantBuilder.VariantBuilder<V1DustVariant<TV1SyncUpdate>, object> = v1.builder;
  const v2Builder: VariantBuilder.VariantBuilder<V2DustVariant<TV2SyncUpdate>, object> = v2.builder;

  const BaseWallet: WalletLike.BaseWalletClass<Variants> = WalletBuilder.init()
    .withVariant(ProtocolVersion.MinSupportedVersion, v1Builder, v1.configuration)
    .withVariant(configuration.forks.v9, v2Builder, v2.configuration)
    .build();

  const variants = BaseWallet.allVariantsRecord();

  /** What the rates are when a caller names none: the ledger's own initial parameters. */
  const defaultRates: DustGenerationRates = ledgerV9.LedgerParameters.initialParameters().dust;

  /**
   * The key material this wallet holds, one entry per side of the protocol boundary.
   *
   * @remarks
   *   The two ledger versions' `DustSecretKey` belong to different runtimes and each declares a private constructor, so
   *   neither can be made from the other and the type system agrees. "The key this wallet holds" is therefore two
   *   questions, and the type says so: each side is present or it is not, independently.
   *
   *   A seed is not among them. A seed can produce either side, so a wallet given one derives both at once and keeps the
   *   results — the same capability with a shorter-lived secret, since from that moment the seed is not this wallet's
   *   to hold.
   */
  type RetainedKeys = Readonly<{
    v8: Option.Option<ledgerV8.DustSecretKey>;
    v9: Option.Option<ledgerV9.DustSecretKey>;
  }>;

  /** Nothing retained: never started, or stopped. */
  const noKeys: RetainedKeys = { v8: Option.none(), v9: Option.none() };

  /** Both sides, derived from one seed. */
  const keysFromSeed = (seed: WalletSeed.WalletSeed): RetainedKeys => ({
    v8: Option.some(variants[V1Tag].variant.startAux.fromSeed(seed)),
    v9: Option.some(variants[V2Tag].variant.startAux.fromSeed(seed)),
  });

  /**
   * What a variant can be started with, or why it cannot be.
   *
   * @remarks
   *   Two different failures, deliberately distinguished: a wallet that was never started (or has been stopped) holds
   *   nothing at all, while one started with the other side's key object holds something it must not use here.
   */
  const auxFor = <TAux>(
    retained: RetainedKeys,
    side: Option.Option<TAux>,
    variantTag: symbol,
  ): Either.Either<TAux, StartMaterial.MissingStartAuxError> =>
    Either.fromOption(
      side,
      () =>
        new StartMaterial.MissingStartAuxError({
          message:
            Option.isNone(retained.v8) && Option.isNone(retained.v9)
              ? `This wallet holds no key material: it has not been started, or it has been stopped. Start it before ` +
                `asking it to synchronize or to pay a fee.`
              : `This wallet holds key material of the other protocol version only, which the variant ` +
                `${String(variantTag)} cannot use: a Dust secret key belongs to one ledger version's runtime. Start ` +
                `this wallet with material that answers for either side — startWithSeed(seed), or ` +
                `startWithKeys({ v8, v9 }).`,
          variantTag,
        }),
    );

  const v8Aux = (retained: RetainedKeys): Either.Either<ledgerV8.DustSecretKey, StartMaterial.MissingStartAuxError> =>
    auxFor(retained, retained.v8, V1Tag);

  const v9Aux = (retained: RetainedKeys): Either.Either<ledgerV9.DustSecretKey, StartMaterial.MissingStartAuxError> =>
    auxFor(retained, retained.v9, V2Tag);

  /**
   * The protocol versions each variant owns, and the version a transaction it builds is stamped with.
   *
   * @remarks
   *   The stamp is the floor of the variant's epoch: every decision it is later read for asks which side of the boundary
   *   the bytes belong to, and the floor answers that the same way as any other version in the same epoch.
   */
  const v8Epoch = ProtocolVersion.epochOf(ProtocolVersion.MinSupportedVersion, configuration.forks.v9);
  const v9Epoch = ProtocolVersion.epochOf(configuration.forks.v9, configuration.forks.v9);
  const [v8Stamp] = v8Epoch;
  const [v9Stamp] = v9Epoch;

  /** Reads a transaction built before the boundary, refusing one built after it. */
  const v8Tx = <T>(handle: AnyTx): Effect.Effect<T, ProtocolVersionMismatchError> =>
    EitherOps.toEffect(WalletTransaction.unwrapWithin<T>(handle, v8Epoch));

  /** Reads a transaction built from the boundary, refusing one built before it. */
  const v9Tx = <T>(handle: AnyTx): Effect.Effect<T, ProtocolVersionMismatchError> =>
    EitherOps.toEffect(WalletTransaction.unwrapWithin<T>(handle, v9Epoch));

  /**
   * How long a start waits for the chain to say which version it is on.
   *
   * @remarks
   *   Short, because what is being bought is small: the alternative to an answer is the hand-over this wallet has always
   *   done, which costs one migration and no correctness on a chain that produces events. It is a ceiling rather than a
   *   typical cost — an unreachable indexer refuses a connection long before this — and it exists so that a probe which
   *   neither answers nor fails cannot hold a start open indefinitely.
   */
  const probeTimeout = Duration.seconds(5);

  /** Where a start begins, when the chain answered for it. */
  type ProbedStart = Readonly<{
    version: ProtocolVersion.ProtocolVersion;
    variant: HList.Each<Variants>;
  }>;

  /**
   * The variant the chain's current version belongs to, or nothing.
   *
   * @remarks
   *   Nothing covers every way the question can fail to produce an answer, and they are deliberately not distinguished:
   *   no probe configured, a probe that rejected, a probe that outlived the wallet's patience, or a version no
   *   registered variant claims. Each means the same thing to a caller — start where a wallet with no history starts —
   *   and none of them is a reason to fail.
   */
  const probedStart: Effect.Effect<Option.Option<ProbedStart>> =
    configuration.chainVersionProbe === undefined
      ? Effect.succeedNone
      : pipe(
          Effect.tryPromise(configuration.chainVersionProbe),
          Effect.timeout(probeTimeout),
          Effect.map((version) =>
            Option.map(BaseWallet.variantFor(version), (variant): ProbedStart => ({ version, variant })),
          ),
          Effect.orElseSucceed(() => Option.none<ProbedStart>()),
        );

  /**
   * A fresh state of the variant a probed start begins at, recording the version the chain reported.
   *
   * @remarks
   *   Built exactly as the head-variant boot path builds its own — an empty state of that variant, valued against that
   *   ledger version's rebuild of the rates the caller named — and then annotated with the observed version, which is
   *   what keeps a variant from starting outside its own activation range and signalling backwards on sight.
   */
  const freshStateAt = (
    variant: HList.Each<Variants>,
    keys: DustKeysByEpoch,
    rates: DustGenerationRates,
    version: ProtocolVersion.ProtocolVersion,
  ): V1CoreWallet | CoreWallet =>
    Variant.getVersionedVariantTag(variant) === V2Tag
      ? CoreWallet.withProtocolVersion(
          CoreWallet.initEmpty(asV9DustParameters(rates), keys.v9, configuration.networkId),
          version,
        )
      : V1CoreWallet.withProtocolVersion(
          V1CoreWallet.initEmpty(asV8DustParameters(rates), keys.v8, configuration.networkId),
          version,
        );

  return class ForkingDustWalletImplementation
    extends BaseWallet
    implements ForkingDustWallet<TV1SyncUpdate, TV2SyncUpdate>
  {
    static readonly configuration: TConfiguration = configuration;

    /**
     * Starts at the variant the chain says it is on, or at the head variant when it does not say.
     *
     * @remarks
     *   The second branch is the whole of this wallet's previous behaviour, unchanged and reached whenever the chain was
     *   not asked or did not answer: the V1 variant, an empty state valued against the ledger-v8 rebuild of the rates
     *   the caller named, and a hand-over on the first batch that reports a version it does not own.
     * @param keys One ledger version's dust key per side of the boundary, since either side may be the one that runs.
     * @param rates The rates the caller named, which whichever empty state is built is valued against.
     * @returns The started wallet.
     */
    static #startProbed(keys: DustKeysByEpoch, rates: DustGenerationRates): Promise<ForkingDustWalletImplementation> {
      return pipe(
        probedStart,
        Effect.map(
          Option.match({
            onNone: () =>
              ForkingDustWalletImplementation.startFirst(
                ForkingDustWalletImplementation,
                // Valued against the same rates the caller named, rebuilt by the ledger version that owns this state —
                // see {@link asV8DustParameters}.
                V1CoreWallet.initEmpty(asV8DustParameters(rates), keys.v8, configuration.networkId),
              ),
            onSome: ({ version, variant }) =>
              ForkingDustWalletImplementation.startAtVariant(
                ForkingDustWalletImplementation,
                variant,
                freshStateAt(variant, keys, rates, version),
              ),
          }),
        ),
        Effect.runPromise,
      );
    }

    static async startWithSeed(
      seed: Uint8Array,
      dustParameters: DustGenerationRates = defaultRates,
    ): Promise<ForkingDustWalletImplementation> {
      const derived = keysFromSeed(WalletSeed.WalletSeed(seed));
      const wallet = await ForkingDustWalletImplementation.#startProbed(
        { v8: Option.getOrThrow(derived.v8), v9: Option.getOrThrow(derived.v9) },
        dustParameters,
      );
      // Both sides derived here and now, and the seed reference dropped with this frame: from this point the wallet
      // holds key objects only, which is strictly less than it held before and does the same work.
      wallet.#retainKeys(derived);
      return wallet;
    }

    static async startWithKeys(
      keys: DustKeysByEpoch,
      dustParameters: DustGenerationRates = defaultRates,
    ): Promise<ForkingDustWalletImplementation> {
      const wallet = await ForkingDustWalletImplementation.#startProbed(keys, dustParameters);
      wallet.#retainKeys({ v8: Option.some(keys.v8), v9: Option.some(keys.v9) });
      return wallet;
    }

    static tryRestore(serializedState: string): Either.Either<ForkingDustWalletImplementation, DustRestoreError> {
      const headVariant = HList.head(ForkingDustWalletImplementation.allVariants());
      return variantForSnapshot(
        serializedState,
        (version) => ForkingDustWalletImplementation.variantFor(version),
        headVariant,
      ).pipe(
        // Stated with its result type because the resolved variant is either of the two, so its deserializer is
        // either of theirs: what comes back is a state of whichever one wrote the snapshot, which is what
        // `startAtVariant` takes.
        Either.flatMap((variant): Either.Either<ForkingDustWalletImplementation, DustRestoreError> => {
          // Annotated rather than inferred because the resolved variant is either of the two, so its deserializer is
          // either of theirs: what comes back is a state of whichever one wrote the snapshot, which is what
          // `startAtVariant` takes.
          const deserialized: Either.Either<V1CoreWallet | CoreWallet, DustRestoreError> =
            variant.variant.deserializeState(serializedState);
          return Either.map(deserialized, (state) =>
            ForkingDustWalletImplementation.startAtVariant(ForkingDustWalletImplementation, variant, state),
          );
        }),
      );
    }

    static restore(serializedState: string): ForkingDustWalletImplementation {
      return Either.getOrThrow(ForkingDustWalletImplementation.tryRestore(serializedState));
    }

    readonly state: rx.Observable<DustWalletState<string>>;

    /**
     * What the application started this wallet with, kept so synchronization can be started again.
     *
     * @remarks
     *   A migration starts a fresh variant whose sync has never run, and sync needs key material that is deliberately
     *   absent from anything the wallet serializes. A retained seed answers for both variants; a retained key object
     *   answers only for the ledger-v9 one, which is the ledger version this wallet's public API speaks. Cleared by
     *   {@link stop} so a stopped wallet cannot be resurrected by a late activation.
     */
    readonly #retainedKeys = Ref.unsafeMake<RetainedKeys>(noKeys);

    /** Remembers key material for both sides of the boundary. */
    #retainKeys(keys: RetainedKeys): void {
      Ref.set(this.#retainedKeys, keys).pipe(Effect.runSync);
    }

    /**
     * Starts synchronization on a variant that has just become current, with key material it can use.
     *
     * @param running The variant to start.
     * @param auxFor That variant's own resolution of what it can be started with.
     */
    #resumeSyncOn<TStartAux>(
      running: { startSyncInBackground: (aux: TStartAux) => Effect.Effect<void> },
      keysFor: (retained: RetainedKeys) => Either.Either<TStartAux, StartMaterial.MissingStartAuxError>,
    ): Effect.Effect<void, StartMaterial.MissingStartAuxError> {
      return Ref.get(this.#retainedKeys).pipe(
        Effect.flatMap((retained) =>
          // Stopped, or never started: there is nothing to resume and nothing to resume it with.
          Option.isNone(retained.v8) && Option.isNone(retained.v9)
            ? Effect.void
            : EitherOps.toEffect(keysFor(retained)).pipe(Effect.flatMap((aux) => running.startSyncInBackground(aux))),
        ),
      );
    }

    /** One synchronization step on a variant, with key material it can use. */
    #stepSyncOn<TStartAux, TError>(
      running: { sync: (aux: TStartAux) => Effect.Effect<void, TError> },
      keysFor: (retained: RetainedKeys) => Either.Either<TStartAux, StartMaterial.MissingStartAuxError>,
    ): Effect.Effect<void, TError | StartMaterial.MissingStartAuxError> {
      return Ref.get(this.#retainedKeys).pipe(
        Effect.flatMap((retained) =>
          Option.isNone(retained.v8) && Option.isNone(retained.v9)
            ? Effect.void
            : EitherOps.toEffect(keysFor(retained)).pipe(Effect.flatMap((aux) => running.sync(aux))),
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
     * Everything a start does once the wallet holds its key material: watch for the next variant, synchronize on this
     * one.
     *
     * @remarks
     *   The same work whichever start was called — what the three differ in is only what they retained a moment earlier —
     *   so it is stated once. The watcher is registered before the first dispatch and only once per wallet:
     *   `onVariantActivation` resolves only after its subscription is live, so an activation racing a start is queued
     *   rather than missed, and watchers accumulate, so registering per call would restart synchronization once per
     *   historical start.
     *
     *   Both branches of the dispatch resolve their key from what was retained rather than from what the caller passed,
     *   because the variant that is current is not the caller's to know: a wallet restored below the boundary is on the
     *   ledger-v8 one whatever the application holds.
     */
    #startSynchronizing(): Effect.Effect<void, StartMaterial.MissingStartAuxError | WalletRuntimeError> {
      return Effect.gen(this, function* () {
        const alreadyRegistered = yield* Ref.getAndSet(this.#watcherRegistered, true);
        if (!alreadyRegistered) {
          yield* this.runtime.onVariantActivation({
            [V1Tag]: (v1) => this.#resumeSyncOn(v1, v8Aux),
            [V2Tag]: (v2) => this.#resumeSyncOn(v2, v9Aux),
          });
        }

        yield* this.runtime.dispatch({
          [V1Tag]: (v1) => this.#resumeSyncOn(v1, v8Aux),
          [V2Tag]: (v2) => this.#resumeSyncOn(v2, v9Aux),
        });
      });
    }

    /**
     * Starts background synchronization on whichever variant is current, and keeps the key for the next one.
     *
     * @remarks
     *   The key is ledger-v9's, so it is retained against that variant alone and answers for it alone. A wallet still on
     *   the V1 variant is started from whatever it holds for _that_ side — which a wallet built from a seed, or from
     *   both versions' keys, can always answer and one holding only this cannot.
     *
     *   That is the position of a wallet restored from a snapshot written below the boundary: a snapshot carries no key
     *   material, so this key leaves it with nothing the running variant can use, and it says so rather than pretending
     *   to have started. {@link ForkingDustWallet.startWithSeed} and {@link ForkingDustWallet.startWithKeys} are the same
     *   wallet started with material that answers for either side.
     * @param secretKey The ledger-v9's dust secret key.
     */
    start(secretKey: ledgerV9.DustSecretKey): Promise<void> {
      return Effect.gen(this, function* () {
        // The ledger-v9 side only: this key belongs to that ledger version's runtime. Whatever the wallet already
        // holds for the ledger-v8 side is left as it is, so a wallet built from a seed keeps the ability to read a
        // chain that has not forked yet.
        yield* Ref.update(this.#retainedKeys, (retained) => ({ ...retained, v9: Option.some(secretKey) }));
        yield* this.#startSynchronizing();
      }).pipe(Effect.runPromise);
    }

    startWithSeed(seed: Uint8Array): Promise<void> {
      return Effect.gen(this, function* () {
        // Replaced rather than merged: a seed answers for every variant, so whatever partial material the wallet held
        // has nothing left to contribute.
        yield* Ref.set(this.#retainedKeys, keysFromSeed(WalletSeed.WalletSeed(seed)));
        yield* this.#startSynchronizing();
      }).pipe(Effect.runPromise);
    }

    startWithKeys(keys: DustKeysByEpoch): Promise<void> {
      return Effect.gen(this, function* () {
        yield* Ref.set(this.#retainedKeys, { v8: Option.some(keys.v8), v9: Option.some(keys.v9) });
        yield* this.#startSynchronizing();
      }).pipe(Effect.runPromise);
    }

    async stop(): Promise<void> {
      // Released before the runtime is torn down: the key material outlives neither the wallet nor an in-flight
      // activation.
      Ref.set(this.#retainedKeys, noKeys).pipe(Effect.runSync);
      await super.stop();
    }

    /**
     * Runs one synchronization step on whichever variant is current.
     *
     * @remarks
     *   Available on both sides of the boundary: the V1 variant is stepped with a key derived from what the wallet
     *   retained, exactly as background synchronization is.
     * @param secretKey The ledger-v9's dust secret key.
     */
    stepSync(secretKey: ledgerV9.DustSecretKey): Promise<void> {
      return this.runtime
        .dispatch<void, WalletError | StartMaterial.MissingStartAuxError>({
          [V1Tag]: (v1) => this.#stepSyncOn(v1, v8Aux),
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
      keysFor: (retained: RetainedKeys) => Either.Either<TAux, StartMaterial.MissingStartAuxError>,
    ): Effect.Effect<TAux, StartMaterial.MissingStartAuxError> {
      return Ref.get(this.#retainedKeys).pipe(Effect.flatMap((retained) => EitherOps.toEffect(keysFor(retained))));
    }

    createDustGenerationTransaction(
      currentTime: Date | undefined,
      ttl: Date,
      nightUtxos: Array<UtxoWithMeta>,
      nightVerifyingKey: ledgerV9.SignatureVerifyingKey,
      dustReceiverAddress: DustAddress | undefined,
    ): Promise<UnprovenTx> {
      return this.runtime
        .dispatch<UnprovenTx, TransactingError>({
          [V1Tag]: (v1) =>
            EitherOps.toEffect(Signatures.lowerSignatureVerifyingKey(nightVerifyingKey)).pipe(
              Effect.flatMap((key) =>
                v1.createDustGenerationTransaction(currentTime, ttl, nightUtxos, key, dustReceiverAddress),
              ),
              Effect.map((tx) => WalletTransaction.adopt('Unproven', tx, v8Stamp)),
            ),
          [V2Tag]: (v2) =>
            v2
              .createDustGenerationTransaction(currentTime, ttl, nightUtxos, nightVerifyingKey, dustReceiverAddress)
              .pipe(Effect.map((tx) => WalletTransaction.adopt('Unproven', tx, v9Stamp))),
        })
        .pipe(Effect.runPromise);
    }

    /**
     * Splits Night UTxOs into the ones a registration puts in its guaranteed and fallible sections.
     *
     * @remarks
     *   Available on both sides of the boundary, and deliberately not part of the seam above: it takes and returns plain
     *   data — UTxOs, dust generation readings, a fee amount — and touches no transaction at all, so there is nothing
     *   here that needs proving and nothing the V1 variant cannot answer.
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
      nightVerifyingKey: ledgerV9.SignatureVerifyingKey,
      dustReceiverAddress: DustAddress | undefined,
      feePayment: bigint,
    ): Promise<UnprovenTx> {
      return this.runtime
        .dispatch<UnprovenTx, TransactingError>({
          [V1Tag]: (v1) =>
            Effect.all([
              v8Tx<ledgerV8.UnprovenTransaction>(transaction),
              EitherOps.toEffect(Signatures.lowerSignatureVerifyingKey(nightVerifyingKey)),
            ]).pipe(
              Effect.flatMap(([tx, key]) =>
                v1.attachDustRegistration(tx, currentTime, key, dustReceiverAddress, feePayment),
              ),
              Effect.map((tx) => WalletTransaction.adopt('Unproven', tx, v8Stamp)),
            ),
          [V2Tag]: (v2) =>
            v9Tx<ledgerV9.UnprovenTransaction>(transaction).pipe(
              Effect.flatMap((tx) =>
                v2.attachDustRegistration(tx, currentTime, nightVerifyingKey, dustReceiverAddress, feePayment),
              ),
              Effect.map((tx) => WalletTransaction.adopt('Unproven', tx, v9Stamp)),
            ),
        })
        .pipe(Effect.runPromise);
    }

    addDustGenerationSignature(transaction: UnprovenTx, signature: ledgerV9.Signature): Promise<UnprovenTx> {
      return this.runtime
        .dispatch<UnprovenTx, TransactingError>({
          [V1Tag]: (v1) =>
            Effect.all([
              v8Tx<ledgerV8.UnprovenTransaction>(transaction),
              EitherOps.toEffect(Signatures.lowerSignature(signature)),
            ]).pipe(
              Effect.flatMap(([tx, lowered]) => v1.addDustGenerationSignature(tx, lowered)),
              Effect.map((tx) => WalletTransaction.adopt('Unproven', tx, v8Stamp)),
            ),
          [V2Tag]: (v2) =>
            v9Tx<ledgerV9.UnprovenTransaction>(transaction).pipe(
              Effect.flatMap((tx) => v2.addDustGenerationSignature(tx, signature)),
              Effect.map((tx) => WalletTransaction.adopt('Unproven', tx, v9Stamp)),
            ),
        })
        .pipe(Effect.runPromise);
    }

    addDustRegistrationSignature(transaction: UnprovenTx, signature: ledgerV9.Signature): Promise<UnprovenTx> {
      return this.runtime
        .dispatch<UnprovenTx, TransactingError>({
          [V1Tag]: (v1) =>
            Effect.all([
              v8Tx<ledgerV8.UnprovenTransaction>(transaction),
              EitherOps.toEffect(Signatures.lowerSignature(signature)),
            ]).pipe(
              Effect.flatMap(([tx, lowered]) => v1.addDustRegistrationSignature(tx, lowered)),
              Effect.map((tx) => WalletTransaction.adopt('Unproven', tx, v8Stamp)),
            ),
          [V2Tag]: (v2) =>
            v9Tx<ledgerV9.UnprovenTransaction>(transaction).pipe(
              Effect.flatMap((tx) => v2.addDustRegistrationSignature(tx, signature)),
              Effect.map((tx) => WalletTransaction.adopt('Unproven', tx, v9Stamp)),
            ),
        })
        .pipe(Effect.runPromise);
    }

    calculateFee(transactions: ReadonlyArray<AnyTx>): Promise<bigint> {
      return this.runtime
        .dispatch<bigint, TransactingError>({
          [V1Tag]: (v1) =>
            Effect.forEach(transactions, v8Tx<V1AnyTransaction>).pipe(Effect.flatMap((txs) => v1.calculateFee(txs))),
          [V2Tag]: (v2) =>
            Effect.forEach(transactions, v9Tx<AnyTransaction>).pipe(Effect.flatMap((txs) => v2.calculateFee(txs))),
        })
        .pipe(Effect.runPromise);
    }

    estimateFee(transactions: ReadonlyArray<AnyTx>, ttl?: Date, currentTime?: Date): Promise<bigint> {
      const effectiveTtl = ttl ?? new Date(Date.now() + 60 * 60 * 1000);
      return this.runtime
        .dispatch<bigint, TransactingError>({
          [V1Tag]: (v1) =>
            Effect.all([this.#requireAux(v8Aux), Effect.forEach(transactions, v8Tx<V1AnyTransaction>)]).pipe(
              Effect.flatMap(([key, txs]) => v1.estimateFee(key, txs, effectiveTtl, currentTime)),
            ),
          [V2Tag]: (v2) =>
            Effect.all([this.#requireAux(v9Aux), Effect.forEach(transactions, v9Tx<AnyTransaction>)]).pipe(
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
        .dispatch<{ transaction: UnprovenTx; blockData: PricedBlockData }, TransactingError>({
          [V1Tag]: (v1) =>
            Effect.all([this.#requireAux(v8Aux), Effect.forEach(transactions, v8Tx<V1AnyTransaction>)]).pipe(
              Effect.flatMap(([key, txs]) => v1.balanceTransactions(key, txs, ttl, currentTime)),
              Effect.map(({ transaction, blockData }) => ({
                transaction: WalletTransaction.adopt('Unproven', transaction, v8Stamp),
                blockData,
              })),
            ),
          [V2Tag]: (v2) =>
            Effect.all([this.#requireAux(v9Aux), Effect.forEach(transactions, v9Tx<AnyTransaction>)]).pipe(
              Effect.flatMap(([key, txs]) => v2.balanceTransactions(key, txs, ttl, currentTime)),
              Effect.map(({ transaction, blockData }) => ({
                transaction: WalletTransaction.adopt('Unproven', transaction, v9Stamp),
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
            Either.match(WalletTransaction.unwrapWithin<V1AnyTransaction>(transaction, v8Epoch), {
              onLeft: () => Effect.void,
              onRight: (tx) => v1.revertTransaction(tx),
            }),
          [V2Tag]: (v2) =>
            Either.match(WalletTransaction.unwrapWithin<AnyTransaction>(transaction, v9Epoch), {
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
          rx.filter(([dustState]) => claimableFeePayment(dustState, nightUtxos, clock.now()) >= requiredAmount),
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
export type DustWallet = ForkingDustWallet<V1SyncUpdate, V2SyncUpdate>;

/** The class {@link DustWallet} builds. */
export type DustWalletClass = ForkingDustWalletClass<V1SyncUpdate, V2SyncUpdate, DefaultDustConfiguration>;

/**
 * Builds the dust wallet this package ships: the default variant either side of `configuration.forks.v9`.
 *
 * @remarks
 *   Both variants read the chain through the indexer's dust event subscription and record transaction history in the same
 *   storage. Each is built from the same application configuration, because what they ask for happens to coincide —
 *   with one exception the type system cannot police: `dustParameters` names a ledger type, and the two ledgers'
 *   `DustParameters` are structurally identical, so it is passed only to the variant it belongs to.
 *
 *   **The V1 variant syncs by event replay only.** The projections fast-sync path is a ledger-v9 capability: it needs
 *   four `DustLocalState` APIs that no published ledger-v8 has. That is a permanent property of the V1 variant, not a
 *   gap to be closed.
 *
 *   **Fee-paying operations work on either side of the boundary**: the active variant answers with its own ledger's
 *   objects, and every result travels as a handle stamped with the epoch that built it.
 *
 *   **The chain is asked where it is before a variant is chosen.** The indexer this wallet already syncs from answers
 *   which protocol version the chain is on, so a start on a chain past the boundary begins on V2 rather than handing
 *   over immediately. An application that would rather ask something else — a cache, a value it already holds —
 *   supplies its own `chainVersionProbe`; one whose chain cannot be reached loses nothing, because the answer is
 *   best-effort and its absence is the behaviour this wallet had before.
 * @param configuration What the wallet and both its variants are built from, including where the boundary lies.
 * @returns The wallet class.
 */
export function DustWallet(configuration: DefaultDustConfiguration): DustWalletClass {
  const dustParameters = configuration.dustParameters ?? ledgerV9.LedgerParameters.initialParameters().dust;
  const withProbe: DefaultDustConfiguration = {
    ...configuration,
    chainVersionProbe: configuration.chainVersionProbe ?? makeIndexerChainVersionProbe(configuration),
  };

  return CustomForkingDustWallet(
    withProbe,
    {
      builder: new V1Builder().withDefaults(),
      // The one field that cannot be shared: `dustParameters` is a WASM object of whichever ledger module produced it,
      // so the V1 variant is handed the ledger-v8 rebuild of the same rates rather than the object itself.
      configuration: { ...configuration, dustParameters: asV8DustParameters(dustParameters) },
    },
    {
      builder: new V2Builder()
        .withDefaults()
        .withMigration(() => Migration.makeCrossLedgerMigration({ dustParameters })),
      configuration,
    },
  );
}
