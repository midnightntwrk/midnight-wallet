import { Effect, Exit, Scope, Types } from 'effect';
import * as rx from 'rxjs';
import { Fluent, HList, Poly, ProtocolState, ProtocolVersion } from '@midnight-ntwrk/abstractions';
import { Variant, VariantBuilder, WalletLike, WalletRuntimeError } from './abstractions';
import { StateOf } from './abstractions/Variant';
import { ObservableOps } from './effect/index';
import * as Runtime from './Runtime';

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
   * Ensures that the built wallet uses the default variants.
   *
   * @returns A new {@link WalletBuilder} that uses the current default variants.
   */
  withDefaultVariants(): Fluent.ExcludeMethod<
    WalletBuilder<TBuilders>,
    WalletBuilderMethods.WithDefaultVariantsMethod
  > {
    return this;
  }

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
  ): Fluent.ExcludeMethod<
    WalletBuilder<HList.Append<TBuilders, VariantBuilder.VersionedVariantBuilder<TBuilder>>>,
    WalletBuilderMethods.WithDefaultVariantsMethod
  > {
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
    ...[maybeConfiguration]: BuildArguments<TBuilders>
  ): WalletLike.BaseWalletClass<VariantBuilder.VersionedVariantsOf<TBuilders>, FullConfiguration<TBuilders>> {
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
      static readonly configuration: FullConfiguration<TBuilders> = (maybeConfiguration ??
        {}) as FullConfiguration<TBuilders>;

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

/** @internal */
declare namespace WalletBuilder {
  /**
   * The internal build state of {@link WalletBuilder}.
   *
   * @remarks
   * Represents the collection of configured variants and their configuration.
   */
  type BuildState<TBuilders extends VariantBuilder.AnyVersionedVariantBuilder[]> = {
    readonly variants: TBuilders;
  };
}

/** @internal */
declare namespace WalletBuilderMethods {
  type WithDefaultVariantsMethod = 'withDefaultVariants';
  type WithVariantMethod = 'withVariant';
  type AllVariantMethods = WithDefaultVariantsMethod | WithVariantMethod;
  type AllMethods = AllVariantMethods;
}

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
