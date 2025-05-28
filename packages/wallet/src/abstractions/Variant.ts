import { Scope, SubscriptionRef } from 'effect';
import type { Effect } from 'effect/Effect';
import type { Stream } from 'effect/Stream';
import type { ProtocolVersion } from './ProtocolVersion';
import { StateChange } from './StateChange';
import { WalletRuntimeError } from './WalletRuntimeError';

export interface VariantContext<TState> {
  stateRef: SubscriptionRef.SubscriptionRef<TState>;
}

/**
 * Encapsulates a variant of a wallet implementation.
 *
 * @typeParam TTState The type of state that the variant will operate over.
 * @typeParam TPreviousState The type of state that the variant can migrate from.
 * @typeParam TDomain The variant-specific functionality
 */
// TODO: de-effectify Variant interface?
export interface Variant<TState, TPreviousState = null, TDomain extends object = object> {
  start(
    context: VariantContext<TState>,
    state: TState,
  ): Effect<RunningVariant<TState, TDomain>, WalletRuntimeError, Scope.Scope>;

  migrateState(previousState: TPreviousState): Effect<TState>;
}

export type RunningVariant<TState, TDomain extends object> = {
  state: Stream<StateChange<TState>, WalletRuntimeError>;
} & TDomain;

/**
 * A utility type that represents any {@link Variant}.
 */
export type AnyVariant = Variant<unknown, unknown, object>;

export declare namespace AnyVariant {
  /**
   * The type of state that the given variant operates over.
   */
  type State<T> = T extends Variant<infer S, unknown> ? S : never;

  /**
   * The type of state that the given variant can migrate from.
   */
  type PreviousState<T> = T extends Variant<unknown, infer S> ? S : never;
}

/**
 * Base type that represents variant configuration.
 */
export type AnyVariantConfiguration = Record<string, unknown>;

/**
 * An array of {@link Variant} instances.
 */
export type AnyVariantArray = AnyVariant[];

/**
 * A tuple that associates a {@link Variant} with a given version of the Midnight protocol.
 */
export type AnyVersionedVariant = readonly [sinceVersion: ProtocolVersion, AnyVariant];

export type AnyRunningVariant = RunningVariant<unknown, object>;

export type AnyVersionedRunningVariant = readonly [sinceVersion: ProtocolVersion, AnyRunningVariant];

/**
 * An ordered array of tuples that associates a {@link Variant} with a given version of the Midnight protocol.
 *
 * @remarks
 * The expected order of the variants will be ascending on `sinceVersion`.
 */
export type AnyVersionedVariantArray = AnyVersionedVariant[];

export declare namespace AnyVariantArray {
  /**
   * The state types that the given variants operate over.
   */
  type States<TArray> = TArray extends AnyVariantArray ? AnyVariant.State<TArray[number]> : never;

  /**
   * The type of the latest variant found in the given {@link Variant} array.
   *
   * @typeParam TArray The {@link Variant} array.
   *
   * @remarks
   * For any given {@link Variant} array, the last element is considered the latest {@link Variant}
   * (i.e., the one that is associated with the highest protocol version). It is assumed that variants
   * will be added in protocol version order (with a runtime check to enforce this).
   */
  type Latest<TArray> = TArray extends [...AnyVariantArray, infer V] ? V : never;
}
