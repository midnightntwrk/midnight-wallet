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
 * An unshielded wallet composed from a single variant, which answers for the whole protocol timeline.
 *
 * @remarks
 *   The composition for a wallet that is not expected to meet a protocol boundary — a test harness, a simulator-driven
 *   wallet, an application pinned to one protocol version. Its one variant is registered from the minimum supported
 *   version, so it stamps every transaction at that floor and accepts one of any version; the price is that it cannot
 *   cross a protocol boundary. The wallet that can is `UnshieldedWallet`, in `UnshieldedWallet.ts`.
 */
import type * as ledger from '@midnightntwrk/ledger-v9';
import {
  type AnyTx,
  ProtocolVersion,
  type ProtocolVersionMismatchError,
  type UnboundTx,
  type UnprovenTx,
  WalletTransaction,
} from '@midnightntwrk/wallet-sdk-abstractions';
import { type UnshieldedAddress } from '@midnightntwrk/wallet-sdk-address-format';
import { type Runtime, WalletBuilder } from '@midnightntwrk/wallet-sdk-runtime';
import { type Variant, type VariantBuilder, type WalletLike } from '@midnightntwrk/wallet-sdk-runtime/abstractions';
import { EitherOps } from '@midnightntwrk/wallet-sdk-utilities';
import { Effect, Either, Ref, type Scope } from 'effect';
import * as rx from 'rxjs';
import { type PublicKey } from './KeyStore.js';
import { type UnshieldedWalletAPI, UnshieldedWalletState } from './UnshieldedWalletAPI.js';
import {
  type BaseV2Configuration,
  type DefaultV2Configuration,
  V2Tag,
  type V2Variant,
  CoreWallet,
  type UnboundTransaction,
} from './v2/index.js';
import { type RunningV2Variant } from './v2/RunningV2Variant.js';
import { type SignSegment } from './v2/Signing.js';
import { type WalletSyncUpdate } from './v2/SyncSchema.js';
import { type TokenTransfer } from './v2/Transacting.js';
import { type UtxoWithMeta } from './v2/UnshieldedState.js';

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
