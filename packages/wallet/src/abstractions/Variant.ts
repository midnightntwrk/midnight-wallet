/* eslint-disable @typescript-eslint/no-explicit-any -- unknown does not work well as a default, because it causes assignability issues */
import { Scope, SubscriptionRef } from 'effect';
import type { Effect } from 'effect/Effect';
import type { Stream } from 'effect/Stream';
import { WithTag } from '../utils/polyFunction';
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
export type Variant<
  TTag extends string | symbol,
  TState,
  TPreviousState,
  TRunning extends RunningVariant<TTag, TState>,
> = WithTag<TTag> & {
  start(context: VariantContext<TState>, state: TState): Effect<TRunning, WalletRuntimeError, Scope.Scope>;

  migrateState(previousState: TPreviousState): Effect<TState>;
};

export type RunningVariant<TTag extends symbol | string, TState> = WithTag<TTag> & {
  state: Stream<StateChange<TState>, WalletRuntimeError>;
};

/**
 * A utility type that represents any {@link Variant}.
 */
export type AnyVariant = Variant<string | symbol, any, any, AnyRunningVariant>;

export type AnyRunningVariant = RunningVariant<string | symbol, any>;

export type RunningVariantOf<T> =
  T extends VersionedVariant<infer V>
    ? RunningVariantOf<V>
    : T extends Variant<string | symbol, any, any, infer Running>
      ? Running
      : never;

export type StateOf<T> =
  T extends Variant<any, infer S, any, AnyRunningVariant>
    ? S
    : T extends VersionedVariant<infer V>
      ? StateOf<V>
      : never;

export type PreviousStateOf<T> =
  T extends VersionedVariant<infer V>
    ? PreviousStateOf<V>
    : T extends Variant<string | symbol, unknown, infer S, any>
      ? S
      : never;

/**
 * An array of {@link Variant} instances.
 */
export type AnyVariantArray = AnyVariant[];

/**
 * A type that associates a {@link Variant} with a given version of the Midnight protocol.
 */
export type VersionedVariant<T extends AnyVariant> = Readonly<{ sinceVersion: ProtocolVersion; variant: T }>;

export type AnyVersionedVariant = VersionedVariant<AnyVariant>;

/**
 * An ordered array of types that associates a {@link Variant} with a given version of the Midnight protocol.
 *
 * @remarks
 * The expected order of the variants will be ascending on `sinceVersion`.
 */
export type AnyVersionedVariantArray = AnyVersionedVariant[];
