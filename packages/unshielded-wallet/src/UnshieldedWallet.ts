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
  type AnyTx,
  type NetworkId,
  type ProtocolState,
  ProtocolVersion,
  type ProtocolVersionMismatchError,
  type UnboundTx,
  type UnprovenTx,
  WalletTransaction,
} from '@midnightntwrk/wallet-sdk-abstractions';
import { EitherOps } from '@midnightntwrk/wallet-sdk-utilities';
import {
  type BaseV2Configuration,
  type DefaultV2Configuration,
  V2Tag,
  type V2Variant,
  CoreWallet,
  type UnboundTransaction,
} from './v2/index.js';
import { type CoreWallet as PreForkCoreWallet } from './v1/CoreWallet.js';
import type * as ledger from '@midnightntwrk/ledger-v9';
import { Effect, Either, Ref, type Scope } from 'effect';
import * as rx from 'rxjs';
import { type SerializationCapability } from './v2/Serialization.js';
import { type UnshieldedHistoryStorage } from './v2/TransactionHistory.js';
import { type IndexerClientConnection } from './v2/Sync.js';
import { type CoinsAndBalancesCapability } from './v2/CoinsAndBalances.js';
import { type KeysCapability } from './v2/Keys.js';
import { type TokenTransfer } from './v2/Transacting.js';
import { type WalletSyncUpdate } from './v2/SyncSchema.js';
import { type RunningV2Variant } from './v2/RunningV2Variant.js';
import { type SignSegment } from './v2/Signing.js';
import { type UtxoWithMeta } from './v2/UnshieldedState.js';
import { type Variant, type VariantBuilder, type WalletLike } from '@midnightntwrk/wallet-sdk-runtime/abstractions';
import { type Runtime, WalletBuilder } from '@midnightntwrk/wallet-sdk-runtime';
import { type PublicKey } from './KeyStore.js';
import { type SyncProgress } from './v2/SyncProgress.js';
import { type UnshieldedAddress } from '@midnightntwrk/wallet-sdk-address-format';
import { type ChainVersionProbe } from '@midnightntwrk/wallet-sdk-capabilities/chainVersion';

/** The core state of whichever unshielded variant produced an emission. */
export type UnshieldedCoreState = PreForkCoreWallet | CoreWallet;

/**
 * Everything a state emission projects, already bound to the variant that produced it.
 *
 * @remarks
 *   Binding is the point. The capabilities that understand a state and the state itself must be chosen together, in the
 *   branch where the producing variant is known; the two variants' capability types are structurally identical, so a
 *   capability of one would type-check against a state of the other and be wrong at runtime. Once bound there is
 *   nothing left to mis-pair, and everything below is version-agnostic plain data — balances are `bigint` under string
 *   token types, a UTXO is a plain record of value, owner, type, intent hash and output number, and the address is the
 *   SDK's own type. The one genuinely version-bound reading a variant offers, the verifying key, is deliberately not
 *   projected here: it is a bare hex string on one side and a `{tag, value}` record on the other.
 */
type UnshieldedProjections<TSerialized> = Readonly<{
  balances: () => Record<ledger.RawTokenType, bigint>;
  totalCoins: () => readonly UtxoWithMeta[];
  availableCoins: () => readonly UtxoWithMeta[];
  pendingCoins: () => readonly UtxoWithMeta[];
  address: () => UnshieldedAddress;
  serialize: () => TSerialized;
}>;

/**
 * What a variant has to offer for its own state to be projected — exactly that, and nothing more.
 *
 * @remarks
 *   Narrowed to the projected methods rather than naming the three capability types whole, because one of their members
 *   is the version break itself: `KeysCapability.getPublicKey` answers with a bare hex string on the pre-fork ledger
 *   version and a `{tag, value}` record on the post-fork one, so a type demanding it could only ever be satisfied by
 *   one of the two variants. Asking for what is projected keeps a wallet spanning the boundary buildable and keeps the
 *   unprojectable reading out of reach, in one stroke.
 */
type UnshieldedStateCapabilities<TState, TSerialized> = Readonly<{
  serialization: Pick<SerializationCapability<TState, TSerialized>, 'serialize'>;
  coinsAndBalances: Pick<
    CoinsAndBalancesCapability<TState>,
    'getAvailableBalances' | 'getTotalCoins' | 'getAvailableCoins' | 'getPendingCoins'
  >;
  keys: Pick<KeysCapability<TState>, 'getAddress'>;
}>;

export class UnshieldedWalletState<TSerialized = string> {
  /**
   * Wraps a state emission with the capabilities of the variant that produced it.
   *
   * @remarks
   *   Call this inside a branch that has narrowed on the emission's `variantTag`, so `variant` and `state` are known to
   *   belong together. It is generic over the state type precisely so that pairing is checked.
   */
  static readonly fromVariant = <TState extends UnshieldedCoreState, TSerialized = string>(
    variant: UnshieldedStateCapabilities<TState, TSerialized>,
    state: ProtocolState.ProtocolState<TState>,
  ): UnshieldedWalletState<TSerialized> =>
    new UnshieldedWalletState<TSerialized>(state.version, state.state, {
      balances: () => variant.coinsAndBalances.getAvailableBalances(state.state),
      totalCoins: () => variant.coinsAndBalances.getTotalCoins(state.state),
      availableCoins: () => variant.coinsAndBalances.getAvailableCoins(state.state),
      pendingCoins: () => variant.coinsAndBalances.getPendingCoins(state.state),
      address: () => variant.keys.getAddress(state.state),
      serialize: () => variant.serialization.serialize(state.state),
    });

  readonly protocolVersion: ProtocolVersion.ProtocolVersion;
  readonly state: UnshieldedCoreState;
  readonly #projections: UnshieldedProjections<TSerialized>;

  get balances(): Record<ledger.RawTokenType, bigint> {
    return this.#projections.balances();
  }

  get totalCoins(): readonly UtxoWithMeta[] {
    return this.#projections.totalCoins();
  }

  get availableCoins(): readonly UtxoWithMeta[] {
    return this.#projections.availableCoins();
  }

  get pendingCoins(): readonly UtxoWithMeta[] {
    return this.#projections.pendingCoins();
  }

  get address(): UnshieldedAddress {
    return this.#projections.address();
  }

  get progress(): SyncProgress {
    return this.state.progress;
  }

  constructor(
    protocolVersion: ProtocolVersion.ProtocolVersion,
    state: UnshieldedCoreState,
    projections: UnshieldedProjections<TSerialized>,
  ) {
    this.protocolVersion = protocolVersion;
    this.state = state;
    this.#projections = projections;
  }

  serialize(): TSerialized {
    return this.#projections.serialize();
  }
}

/**
 * The configuration a default {@link UnshieldedWallet} is built from.
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
export type DefaultUnshieldedConfiguration = {
  networkId: NetworkId.NetworkId;
  indexerClientConnection: IndexerClientConnection;
  txHistoryStorage: UnshieldedHistoryStorage;
  /**
   * The protocol version at which this chain hands over from the pre-fork ledger to the post-fork one.
   *
   * @remarks
   *   Required, and deliberately without a default: the wallet registers one variant either side of it, so a wrong value
   *   does not degrade — it decides which ledger version reads the chain. Below this version the pre-fork variant is
   *   active; from it, the post-fork one. The SDK cannot guess it, because it is a property of the chain the
   *   application points at, not of the SDK.
   *
   *   A node reporting a 2.x runtime version reports protocol version `2000000`, which is therefore the value for a
   *   ledger-v9-native chain — the shielded package publishes it as `V9_NATIVE_FORK_VERSION`. The final mainnet fork
   *   constant is not yet fixed; a `ProtocolVersion.Forks.*` default will ship once it is, and this field keeps working
   *   unchanged.
   */
  forkVersion: ProtocolVersion.ProtocolVersion;
  /**
   * How the wallet asks the chain which protocol version it is on, before it chooses a variant to start at.
   *
   * @remarks
   *   Optional, and defaulted rather than absent: left unset, the wallet asks the indexer named by
   *   {@link indexerClientConnection}, which it is about to synchronize from anyway. Supply one to ask something else —
   *   a cache, a node RPC, a value the application already holds. The answer is best-effort wherever it comes from: a
   *   chain that cannot be reached leaves the wallet starting exactly where it started before there was a probe.
   */
  chainVersionProbe?: ChainVersionProbe;
};

export type UnshieldedWalletAPI<TSerialized = string> = {
  readonly state: rx.Observable<UnshieldedWalletState<TSerialized>>;

  start(): Promise<void>;

  balanceFinalizedTransaction(tx: AnyTx): Promise<UnprovenTx | undefined>;

  balanceUnboundTransaction(tx: AnyTx): Promise<UnboundTx | undefined>;

  balanceUnprovenTransaction(tx: AnyTx): Promise<UnprovenTx | undefined>;

  transferTransaction(outputs: readonly TokenTransfer[], ttl: Date): Promise<UnprovenTx>;

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
  ): Promise<UnprovenTx>;

  initSwap(
    desiredInputs: Record<ledger.RawTokenType, bigint>,
    desiredOutputs: readonly TokenTransfer[],
    ttl: Date,
  ): Promise<UnprovenTx>;

  signUnprovenTransaction(transaction: AnyTx, signSegment: SignSegment): Promise<UnprovenTx>;

  signUnboundTransaction(transaction: AnyTx, signSegment: SignSegment): Promise<UnboundTx>;

  serializeState(): Promise<TSerialized>;

  waitForSyncedState(allowedGap?: bigint): Promise<UnshieldedWalletState<TSerialized>>;

  revertTransaction(transaction: AnyTx): Promise<void>;

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

  /** The whole of the protocol timeline: one variant answers for every version this wallet will ever see. */
  const wholeTimeline = ProtocolVersion.epochOf(
    ProtocolVersion.MinSupportedVersion,
    ProtocolVersion.MinSupportedVersion,
  );

  /** Reads a transaction a caller handed in, which a single-variant wallet accepts at any version. */
  const carried = <T>(handle: AnyTx): Effect.Effect<T, ProtocolVersionMismatchError> =>
    EitherOps.toEffect(WalletTransaction.unwrapWithin<T>(handle, wholeTimeline));

  /** Seals a transaction this wallet built, at the version its one variant answers from. */
  const seal = (transaction: ledger.UnprovenTransaction): UnprovenTx =>
    WalletTransaction.adopt('Unproven', transaction, ProtocolVersion.MinSupportedVersion);

  const sealUnproven = (result: ledger.UnprovenTransaction | undefined): UnprovenTx | undefined =>
    result === undefined ? undefined : seal(result);

  const sealUnbound = (result: UnboundTransaction | undefined): UnboundTx | undefined =>
    result === undefined ? undefined : WalletTransaction.adopt('Unbound', result, ProtocolVersion.MinSupportedVersion);

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
        rx.map((emission) =>
          // One variant, so the pairing is trivial here; the forking wallet narrows on `variantTag` first.
          UnshieldedWalletState.fromVariant<CoreWallet, TSerialized>(
            CustomUnshieldedWalletImplementation.allVariantsRecord()[V2Tag].variant,
            emission,
          ),
        ),
        rx.shareReplay({ refCount: true, bufferSize: 1 }),
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

    /**
     * Whether the wallet is currently started.
     *
     * @remarks
     *   The unshielded counterpart of the retained start-aux the shielded and dust wallets hold. This wallet is
     *   watch-only — sync needs nothing secret, and signing is supplied per call by the caller — so there is no key to
     *   keep and the restart needs no argument. All the watcher has to know is whether a stopped wallet should be left
     *   stopped, which is what this records; `stop` clears it so a stopped wallet cannot be resurrected by a late
     *   activation.
     */
    readonly #started = Ref.unsafeMake(false);

    start(): Promise<void> {
      return Effect.gen(this, function* () {
        yield* Ref.set(this.#started, true);

        // Registered before the first dispatch, and only once: `onVariantActivation` resolves only after its
        // subscription is live, so an activation racing this call is queued rather than missed.
        const alreadyRegistered = yield* Ref.getAndSet(this.#watcherRegistered, true);
        if (!alreadyRegistered) {
          yield* this.runtime.onVariantActivation({
            [V2Tag]: (v2: RunningV2Variant<TSerialized, TSyncUpdate>) =>
              Ref.get(this.#started).pipe(
                // Stopped, or never started: there is nothing to resume.
                Effect.flatMap((started) => (started ? v2.startSyncInBackground() : Effect.void)),
              ),
          });
        }

        yield* this.runtime.dispatch({ [V2Tag]: (v2) => v2.startSyncInBackground() });
      }).pipe(Effect.runPromise);
    }

    override async stop(): Promise<void> {
      Ref.set(this.#started, false).pipe(Effect.runSync);
      await super.stop();
    }

    balanceFinalizedTransaction(tx: AnyTx): Promise<UnprovenTx | undefined> {
      return this.runtime
        .dispatch({
          [V2Tag]: (v2) =>
            carried<ledger.FinalizedTransaction>(tx).pipe(
              Effect.flatMap((unwrapped) => v2.balanceFinalizedTransaction(unwrapped)),
              Effect.map(sealUnproven),
            ),
        })
        .pipe(Effect.runPromise);
    }

    balanceUnboundTransaction(tx: AnyTx): Promise<UnboundTx | undefined> {
      return this.runtime
        .dispatch({
          [V2Tag]: (v2) =>
            carried<UnboundTransaction>(tx).pipe(
              Effect.flatMap((unwrapped) => v2.balanceUnboundTransaction(unwrapped)),
              Effect.map(sealUnbound),
            ),
        })
        .pipe(Effect.runPromise);
    }

    balanceUnprovenTransaction(tx: AnyTx): Promise<UnprovenTx | undefined> {
      return this.runtime
        .dispatch({
          [V2Tag]: (v2) =>
            carried<ledger.UnprovenTransaction>(tx).pipe(
              Effect.flatMap((unwrapped) => v2.balanceUnprovenTransaction(unwrapped)),
              Effect.map(sealUnproven),
            ),
        })
        .pipe(Effect.runPromise);
    }

    transferTransaction(outputs: readonly TokenTransfer[], ttl: Date): Promise<UnprovenTx> {
      return this.runtime
        .dispatch({
          [V2Tag]: (v2) => v2.transferTransaction(outputs, ttl).pipe(Effect.map(seal)),
        })
        .pipe(Effect.runPromise);
    }

    rotateUtxos(
      guaranteedUtxos: readonly UtxoWithMeta[],
      fallibleUtxos: readonly UtxoWithMeta[],
      nightVerifyingKey: ledger.SignatureVerifyingKey,
      ttl: Date,
    ): Promise<UnprovenTx> {
      return this.runtime
        .dispatch({
          [V2Tag]: (v2) =>
            v2.rotateUtxos(guaranteedUtxos, fallibleUtxos, nightVerifyingKey, ttl).pipe(Effect.map(seal)),
        })
        .pipe(Effect.runPromise);
    }

    initSwap(
      desiredInputs: Record<ledger.RawTokenType, bigint>,
      desiredOutputs: readonly TokenTransfer[],
      ttl: Date,
    ): Promise<UnprovenTx> {
      return this.runtime
        .dispatch({ [V2Tag]: (v2) => v2.initSwap(desiredInputs, desiredOutputs, ttl).pipe(Effect.map(seal)) })
        .pipe(Effect.runPromise);
    }

    signUnprovenTransaction(transaction: AnyTx, signSegment: SignSegment): Promise<UnprovenTx> {
      return this.runtime
        .dispatch({
          [V2Tag]: (v2) =>
            carried<ledger.UnprovenTransaction>(transaction).pipe(
              Effect.flatMap((unwrapped) => v2.signUnprovenTransaction(unwrapped, signSegment)),
              Effect.map(seal),
            ),
        })
        .pipe(Effect.runPromise);
    }

    signUnboundTransaction(transaction: AnyTx, signSegment: SignSegment): Promise<UnboundTx> {
      return this.runtime
        .dispatch({
          [V2Tag]: (v2) =>
            carried<UnboundTransaction>(transaction).pipe(
              Effect.flatMap((unwrapped) => v2.signUnboundTransaction(unwrapped, signSegment)),
              Effect.map((tx) => WalletTransaction.adopt('Unbound', tx, ProtocolVersion.MinSupportedVersion)),
            ),
        })
        .pipe(Effect.runPromise);
    }

    revertTransaction(transaction: AnyTx): Promise<void> {
      return this.runtime
        .dispatch({
          [V2Tag]: (v2) =>
            Either.match(
              WalletTransaction.unwrapWithin<
                ledger.Transaction<ledger.SignatureEnabled, ledger.Proofish, ledger.Bindingish>
              >(transaction, wholeTimeline),
              { onLeft: () => Effect.void, onRight: (unwrapped) => v2.revertTransaction(unwrapped) },
            ),
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
