import { ConfigurableBuilder } from './Builder';
import type * as ProtocolVersion from './ProtocolVersion';
import { Variant, AnyVariantConfiguration } from './Variant';

/**
 * Builds a target {@link Variant} object from internal build state.
 *
 * @typeParam TTState The type of state that the variant will operate over.
 * @typeParam TPreviousState The type of state that the variant can migrate from.
 * @typeParam TConfiguration A type representing the configuration required by the variant.
 */

export abstract class VariantBuilder<TState, TPreviousState = null, TConfiguration = AnyVariantConfiguration>
  implements ConfigurableBuilder<TConfiguration, Variant<TState, TPreviousState>>
{
  /**
   * Builds the target variant object from the internal build state.
   *
   * @param configuration The configuration to use when building the target variant.
   *
   * @returns An instance of {@link Variant} that operates over `TState`.
   */
  abstract build(configuration: TConfiguration): Variant<TState, TPreviousState>;
}

/**
 * A utility type that represents any {@link VariantBuilder}.
 */
export type AnyVariantBuilder = VariantBuilder<unknown, unknown, unknown>;

/**
 * A tuple that associates a {@link VariantBuilder} with a given version of the Midnight protocol.
 */
export type AnyVersionedVariantBuilder = readonly [sinceVersion: ProtocolVersion.ProtocolVersion, AnyVariantBuilder];

/**
 * An array of tuples that associates a {@link VariantBuilder} with a given version of the Midnight protocol.
 */
export type AnyVersionedVariantBuilderArray = AnyVersionedVariantBuilder[];

export declare namespace AnyVariantBuilder {
  /**
   * The type of variant being built by a given {@link VariantBuilder}.
   *
   * @typeParam TVariantBuilder The {@link VariantBuilder}.
   *
   * @remarks
   * The returned type is the narrow type returned by the {@link VariantBuilder.build} method found
   * on `TVariantBuilder` (being more specific); otherwise `never`.
   */
  type TargetVariant<TVariantBuilder> = TVariantBuilder extends AnyVariantBuilder
    ? ReturnType<TVariantBuilder['build']>
    : never;

  /**
   * The type of configuration that the given variant builder can be configured with.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Configuration<T> = T extends VariantBuilder<any, unknown, infer C> ? C : never;
}
