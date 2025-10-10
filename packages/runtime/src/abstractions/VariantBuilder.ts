import { ProtocolVersion } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { AnyVariant, VersionedVariant } from './Variant.js';

/**
 * Builds a target {@link Variant} object from internal build state.
 *
 * @typeParam TTState The type of state that the variant will operate over.
 * @typeParam TPreviousState The type of state that the variant can migrate from.
 * @typeParam TConfiguration A type representing the configuration required by the variant.
 */

export interface VariantBuilder<TVariant extends AnyVariant, TConfiguration extends object = object> {
  /**
   * Builds the target variant object from the internal build state.
   *
   * @param configuration The configuration to use when building the target variant.
   *
   * @returns An instance of {@link Variant} that operates over `TState`.
   */
  build(configuration: TConfiguration): TVariant;
}

/**
 * Base type that represents variant configuration.
 */
export type AnyBuilderConfiguration = object;

/**
 * A utility type that represents any {@link VariantBuilder}.
 */
export type AnyVariantBuilder = VariantBuilder<AnyVariant, AnyBuilderConfiguration>;

export type VariantOf<T> =
  T extends VersionedVariantBuilder<infer TBuilder>
    ? VariantOf<TBuilder>
    : T extends VariantBuilder<infer TVariant, object>
      ? TVariant
      : never;

export type VersionedVariantBuilder<TBuilder extends AnyVariantBuilder> = Readonly<{
  sinceVersion: ProtocolVersion.ProtocolVersion;
  variantBuilder: TBuilder;
}>;

export type VariantsOf<T> = T extends [infer THead, ...infer TRest]
  ? [VariantOf<THead>, ...VariantsOf<TRest>]
  : T extends []
    ? []
    : never;

export type VersionedVariantsOf<T> = T extends [infer THead, ...infer Rest]
  ? [VersionedVariant<VariantOf<THead>>, ...VersionedVariantsOf<Rest>]
  : T extends []
    ? []
    : never;

export type ConfigurationOf<T> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  T extends VariantBuilder<any, infer Config>
    ? Config
    : T extends VersionedVariantBuilder<infer Builder>
      ? ConfigurationOf<Builder>
      : never;

/**
 * A type that associates a {@link VariantBuilder} with a given version of the Midnight protocol.
 */
export type AnyVersionedVariantBuilder = VersionedVariantBuilder<AnyVariantBuilder>;
