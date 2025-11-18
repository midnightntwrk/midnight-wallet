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
import { Effect, Exit, Scope, Types } from 'effect';
import * as rx from 'rxjs';
import { ProtocolState, ProtocolVersion } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { Variant, VariantBuilder, WalletLike, WalletRuntimeError } from './abstractions/index.js';
import { StateOf } from './abstractions/Variant.js';
import { ObservableOps, HList, Poly } from '@midnight-ntwrk/wallet-sdk-utilities';
import * as Runtime from './Runtime.js';

/**
 * Builds a wallet-like implementation from a collection of wallet-like variants, each specific
 * to a given version of the Midnight protocol.
 *
 * @typeParam TBuilders The sequence of variant builders that will manage the wallet state
 */
export class WalletBuilder<TBuilders extends VariantBuilder.AnyVersionedVariantBuilder[]> {
  private constructor(buildState: WalletBuilder.BuildState<TBuilders>) {
    this.#buildState = buildState;
  }

  static init(): WalletBuilder<[]> {
    return new WalletBuilder<[]>({
      variants: [],
    });
  }

  readonly #buildState: WalletBuilder.BuildState<TBuilders>;

  /**
   * Ensures that the built wallet uses a given variant.
   *
   * @param sinceVersion The Midnight protocol version that the variant should operate from.
   * @param variantBuilder A {@link VariantBuilder} that builds the variant.
   * @returns A new {@link WalletBuilder} that uses the variant that will be built from `variantBuilder`.
   */
  withVariant<TBuilder extends VariantBuilder.AnyVariantBuilder>(
    sinceVersion: ProtocolVersion.ProtocolVersion,
    variantBuilder: TBuilder,
  ): WalletBuilder<HList.Append<TBuilders, VariantBuilder.VersionedVariantBuilder<TBuilder>>> {
    const { sinceVersion: previousVersion } = this.#buildState.variants.at(-1) ?? {
      sinceVersion: ProtocolVersion.ProtocolVersion(-1n),
    };

    if (sinceVersion <= previousVersion) {
      throw new Error('ProtocolMismatch: sinceVersion is prior to previously registered version');
    }

    const newBuilder: VariantBuilder.VersionedVariantBuilder<TBuilder> = { sinceVersion, variantBuilder };

    return new WalletBuilder<HList.Append<TBuilders, VariantBuilder.VersionedVariantBuilder<TBuilder>>>({
      variants: HList.append(this.#buildState.variants, newBuilder),
    });
  }

  /**
   * Builds a wallet like implementation.
   */
  build(
    ...[maybeConfiguration]: WalletBuilder.BuildArguments<TBuilders>
  ): WalletLike.BaseWalletClass<
    VariantBuilder.VersionedVariantsOf<TBuilders>,
    WalletBuilder.FullConfiguration<TBuilders>
  > {
    type Variants = VariantBuilder.VersionedVariantsOf<TBuilders>;

    if (this.#buildState.variants.length == 0) {
      throw new WalletRuntimeError({ message: 'Empty variants list' });
    }

    const variants: Variants = this.#buildState.variants.map(
      ({ sinceVersion, variantBuilder }): Variant.VersionedVariant<Variant.AnyVariant> => ({
        sinceVersion,
        variant: variantBuilder.build(maybeConfiguration ?? {}),
      }),
    ) as Variants;

    type WalletRuntime = Runtime.Runtime<Variants>;
    type WalletState = Variant.StateOf<HList.Each<Variants>>;

    return class BaseWallet implements WalletLike.WalletLike<Variants> {
      static readonly configuration: WalletBuilder.FullConfiguration<TBuilders> = (maybeConfiguration ??
        {}) as WalletBuilder.FullConfiguration<TBuilders>;

      static allVariants(): Variants {
        return variants;
      }

      static allVariantsRecord(): Variant.VariantRecord<Variants> {
        return Variant.makeVersionedRecord(BaseWallet.allVariants());
      }

      static startEmpty<T extends WalletLike.AnyWalletClass<Variants>>(WalletClass: T): WalletLike.WalletOf<T> {
        return Effect.gen(this, function* () {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          const initialState: Variant.StateOf<HList.Head<Variants>> = yield* (
            HList.head(BaseWallet.allVariants()) as Variant.AnyVersionedVariant
          ).variant.migrateState(null);

          return BaseWallet.startFirst(WalletClass, initialState);
        }).pipe(Effect.runSync);
      }

      static startFirst<T extends WalletLike.AnyWalletClass<Variants>>(
        WalletClass: T,
        state: StateOf<HList.Head<Variants>>,
      ): WalletLike.WalletOf<T> {
        return Effect.gen(this, function* () {
          const scope = yield* Scope.make();

          const runtime = yield* Runtime.initHead({ variants, state }).pipe(Effect.provideService(Scope.Scope, scope));

          return new WalletClass(runtime, scope) as WalletLike.WalletOf<T>;
        }).pipe(Effect.runSync);
      }

      static start<T extends WalletLike.AnyWalletClass<Variants>, Tag extends string | symbol>(
        WalletClass: T,
        tag: Tag,
        state: Variant.StateOf<HList.Find<Variants, { variant: Poly.WithTag<Tag> }>>,
      ): WalletLike.WalletOf<T> {
        return Effect.gen(this, function* () {
          const scope = yield* Scope.make();

          const runtime = yield* Runtime.init({ variants, tag, state }).pipe(Effect.provideService(Scope.Scope, scope));

          return new WalletClass(runtime, scope) as WalletLike.WalletOf<T>;
        }).pipe(Effect.runSync);
      }

      readonly runtime: WalletRuntime;
      readonly runtimeScope: Scope.CloseableScope;
      readonly rawState: rx.Observable<ProtocolState.ProtocolState<WalletState>>;

      get syncComplete(): boolean {
        const { sourceGap, applyGap } = Effect.runSync(this.runtime.progress);
        return sourceGap === 0n && applyGap === 0n;
      }

      constructor(runtime: Runtime.Runtime<Variants>, runtimeScope: Scope.CloseableScope) {
        this.runtime = runtime;
        this.runtimeScope = runtimeScope;
        this.rawState = ObservableOps.fromStream(runtime.stateChanges).pipe(
          rx.shareReplay({ refCount: true, bufferSize: 1 }),
        );
      }

      stop(): Promise<void> {
        return Scope.close(this.runtimeScope, Exit.void).pipe(Effect.runPromise);
      }
    };
  }
}

export declare namespace WalletBuilder {
  /**
   * The internal build state of {@link WalletBuilder}.
   *
   * @remarks
   * Represents the collection of configured variants and their configuration.
   */
  type BuildState<TBuilders extends VariantBuilder.AnyVersionedVariantBuilder[]> = {
    readonly variants: TBuilders;
  };

  /**
   * Allows properly expressing no need for configuration if an empty one needs to be provided
   */
  export type BuildArguments<TBuilders extends VariantBuilder.AnyVersionedVariantBuilder[]> =
    VoidIfEmpty<FullConfiguration<TBuilders>> extends undefined ? [] : [FullConfiguration<TBuilders>];

  export type FullConfiguration<TBuilders extends VariantBuilder.AnyVersionedVariantBuilder[]> =
    Types.UnionToIntersection<Configurations<TBuilders>>;

  type VoidIfEmpty<TObject> = keyof TObject extends never ? undefined : TObject;

  type Configurations<TBuilders extends VariantBuilder.AnyVersionedVariantBuilder[]> = VariantBuilder.ConfigurationOf<
    HList.Each<TBuilders>
  >;
}
