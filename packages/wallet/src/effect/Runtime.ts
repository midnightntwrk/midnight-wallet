import { Types } from 'effect';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import { type Pipeable } from 'effect/Pipeable';
import * as Stream from 'effect/Stream';
import type { Variant } from '../abstractions/index';
import { ProtocolState } from '../abstractions/index';
import * as internal from './internal/runtime';
import { VariantStream } from './VariantStream';

const RuntimeSymbol = internal.RuntimeSymbol;

/** {@inheritDoc} */
export const Runtime: Context.Tag<AnyRuntime, AnyRuntime> = internal.RuntimeTag;

/**
 * The core wallet runtime.
 */
export interface Runtime<R = Runtime.Context> extends Pipeable, Runtime.Variance<R> {}

export declare namespace Runtime {
  /**
   * Utility interface that manages the type variance of {@link Runtime}.
   *
   * @internal
   */
  interface Variance<R> {
    readonly [RuntimeSymbol.typeId]: {
      readonly _R: Types.Covariant<R>;
    };
  }

  /**
   * The required context for {@link Runtime}.
   */
  type Context = VariantStream;
}

/**
 * A type representing any given runtime.
 */
export type AnyRuntime = Runtime<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Determines if a given value is a runtime.
 *
 * @param u The value to test.
 * @returns `true` if `u` is a type of {@link Runtime}.
 */
export const is: (u: unknown) => u is AnyRuntime = internal.is;

/**
 * Constructs a new runtime.
 *
 * @param configuration The configuration that should be applied during runtime.
 * @returns A {@link Runtime}.
 */
export const make: () => Runtime = internal.make;

/**
 * Adds services to a runtime that manages an array of variants, including their state update streams.
 *
 * @param variants The array of variants that should be processed by the runtime.
 * @param state The starting state of the runtime.
 * @returns A {@link Runtime} configured with services that manage `variants`.
 */
export const withVariants: {
  <R>(
    variants: Variant.AnyVersionedVariantArray,
    state: unknown,
  ): (self: Runtime<R>) => Runtime<Exclude<R, VariantStream>>;
  <R>(self: Runtime<R>, variants: Variant.AnyVersionedVariantArray, state: unknown): Runtime<Exclude<R, VariantStream>>;
} = internal.withVariants;

/**
 * Converts a runtime to a stream of Midnight protocol state updates that change over time.
 *
 * @param self The {@link Runtime} to convert.
 * @returns A `Stream` of {@link ProtocolState} objects capturing the changes in state over time that are
 * relevant to `self`.
 */
export const asStream: <TState>(self: Runtime<never>) => Stream.Stream<ProtocolState<TState>> = internal.asStream;

/**
 * Returns the current progress of the runtime.
 *
 * @param self The {@link Runtime} for which progress is required.
 * @returns An `Effect` that resolves with an object containing the `total` number of offsets to be processed, along
 * with a `lag` indicator that represents how many offsets behind the runtime is.
 *
 * @remarks
 * When `lag` is `0`, it is an indicator that the runtime is currently in sync (i.e., in a completed state).
 */
export const getProgress: (self: Runtime<never>) => Effect.Effect<readonly [sourceGap: bigint, applyGap: bigint]> =
  internal.getProgress;
