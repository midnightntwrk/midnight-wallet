import { Effect, Types } from 'effect';
import {
  Variant,
  Builder,
  Fluent,
  VariantBuilder,
  AnyVariantBuilder,
  WalletLike,
  WalletSeed,
  WalletState,
  ProtocolVersion,
  AnyVersionedVariantBuilderArray,
} from '@midnight-ntwrk/wallet-ts/abstractions';
import { Runtime, Observable } from '@midnight-ntwrk/wallet-ts/effect';

/**
 * Builds a wallet-like implementation from a collection of wallet-like variants, each specific
 * to a given version of the Midnight protocol.
 *
 * @typeParam TVariants The collection of variants.
 * @typeParam TConfiguration The configuration type required by `TVariants`.
 */
export class WalletBuilder<
  TVariants extends Variant.AnyVariantArray = [],
  TConfiguration extends Variant.AnyVariantConfiguration = never,
> implements Builder<AnyVariantWalletLike<TVariants>>
{
  #buildState: WalletBuilder.BuildState<TConfiguration>;

  /**
   * Initializes a new {@link WalletBuilder} instance.
   */
  constructor() {
    this.#buildState = {
      configuration: {} as TConfiguration,
      variants: [],
    };
  }

  /**
   * Ensures that the built wallet uses the default variants.
   *
   * @returns A new {@link WalletBuilder} that uses the current default variants.
   */
  withDefaultVariants(): Fluent.ExcludeMethod<
    WalletBuilder<TVariants, TConfiguration>,
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
  withVariant<
    TVariantBuilder extends VariantBuilder<unknown, TPreviousState, TVariantConfiguration>,
    TVariantConfiguration extends Variant.AnyVariantConfiguration = AnyVariantBuilder.Configuration<TVariantBuilder>,
    TPreviousState = Variant.AnyVariant.State<Variant.AnyVariantArray.Latest<TVariants>>,
  >(
    sinceVersion: ProtocolVersion.ProtocolVersion,
    variantBuilder: TVariantBuilder,
  ): Fluent.ExcludeMethod<
    WalletBuilder<
      [...TVariants, AnyVariantBuilder.TargetVariant<TVariantBuilder>],
      TConfiguration | TVariantConfiguration
    >,
    WalletBuilderMethods.WithDefaultVariantsMethod
  > {
    const [previousVersion] = this.#buildState.variants.length
      ? this.#buildState.variants[this.#buildState.variants.length - 1]
      : [ProtocolVersion.ProtocolVersion(-1n), undefined];

    if (sinceVersion <= previousVersion) {
      throw new Error('ProtocolMismatch: sinceVersion is prior to previously registered version');
    }

    this.#buildState = {
      ...this.#buildState,
      variants: [...this.#buildState.variants, [sinceVersion, variantBuilder]],
    };
    // @ts-expect-error Intentionally expanding the WalletBuilder type params to include the new variant.
    return this;
  }

  /**
   * Provides variant configuration.
   *
   * @param configuration The configuration.
   * @returns A new {@link WalletBuilder} that applies `configuration` to all the configured variant implementations.
   */
  withConfiguration(
    configuration: AnyConfiguration<TConfiguration>,
  ): Fluent.ExcludeMethod<WalletBuilder<TVariants, TConfiguration>, WalletBuilderMethods.AllMethods> {
    this.#buildState = {
      ...this.#buildState,
      configuration: configuration as TConfiguration,
    };
    return this;
  }

  /**
   * Builds a wallet like implementation.
   */
  build(): AnyVariantWalletLike<TVariants>;
  /**
   * Builds a wallet like implementation from a given BIP32 compatible seed phrase.
   *
   * @param seed The BIP32 seed phrase to use.
   */
  build(seed: WalletSeed.WalletSeed): AnyVariantWalletLike<TVariants>;
  /**
   * Builds and restores a wallet like implementation from some given wallet state.
   *
   * @param state The serialized wallet state.
   */
  build(state: WalletState.WalletState): AnyVariantWalletLike<TVariants>;
  build(seedOrState?: WalletSeed.WalletSeed | WalletState.WalletState): AnyVariantWalletLike<TVariants> {
    if (seedOrState) {
      throw new Error('NotImplemented: restoring from seed or state is not currently supported.');
    }
    // TODO: Do something with the seed or provided state.
    const variants = this.#buildState.variants.map(
      ([sinceVersion, variantBuilder]) => [sinceVersion, variantBuilder.build(this.#buildState.configuration)] as const,
    );

    const runtime = Runtime.make().pipe(
      // TODO: Replace `undefined` state with state that may be received from caller.
      Runtime.withVariants(variants, undefined),
    );

    return {
      state: Observable.fromStream(Runtime.asStream<Variant.AnyVariantArray.States<TVariants>>(runtime)),
      get syncComplete() {
        const [sourceGap, applyGap] = Effect.runSync(Runtime.getProgress(runtime));
        return sourceGap === 0n && applyGap === 0n;
      },
      balanceTransaction(_: unknown) {
        throw new Error('NotImplemented');
      },
    } as unknown as AnyVariantWalletLike<TVariants>;
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
  type BuildState<TConfiguration> = {
    readonly configuration: TConfiguration;
    readonly variants: AnyVersionedVariantBuilderArray;
  };
}

/** @internal */
declare namespace WalletBuilderMethods {
  type WithDefaultVariantsMethod = 'withDefaultVariants';
  type WithVariantMethod = 'withVariant';
  type AllVariantMethods = WithDefaultVariantsMethod | WithVariantMethod;
  type WithConfigurationMethod = 'withConfiguration';
  type AllMethods = AllVariantMethods | WithConfigurationMethod;
}

/**
 * A type that represents a {@link WalletLike} implementation that operates over at _least one_ variant;
 * otherwise `never`.
 *
 * @typeParam TVariants The collection of variants.
 */
export type AnyVariantWalletLike<TVariants extends Variant.AnyVariantArray> = TVariants extends []
  ? never
  : WalletLike<unknown, Variant.AnyVariantArray.States<TVariants>>;

/**
 * Ensures that a configuration type is not `never` or an empty object.
 *
 * @internal
 */
type AnyConfiguration<TConfiguration extends Variant.AnyVariantConfiguration> =
  keyof Types.UnionToIntersection<TConfiguration> extends never ? never : Types.UnionToIntersection<TConfiguration>;
