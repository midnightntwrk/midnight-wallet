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
/* eslint-disable @typescript-eslint/no-explicit-any -- unknown does not work well as a default, because it causes assignability issues */
import { type Scope, type SubscriptionRef } from 'effect';
import type { Effect } from 'effect/Effect';
import type { Stream } from 'effect/Stream';
import { Poly } from '@midnight-ntwrk/wallet-sdk-utilities';
import type { ProtocolVersion } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { type WalletRuntimeError } from './WalletRuntimeError.js';
import type * as StateChange from './StateChange.js';

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
export type Variant<
  TTag extends string | symbol,
  TState,
  TPreviousState,
  TRunning extends RunningVariant<TTag, TState>,
> = Poly.WithTag<TTag> & {
  start(context: VariantContext<TState>): Effect<TRunning, WalletRuntimeError, Scope.Scope>;

  migrateState(previousState: TPreviousState): Effect<TState>;
};

export type RunningVariant<TTag extends symbol | string, TState> = Poly.WithTag<TTag> & {
  state: Stream<StateChange.StateChange<TState>, WalletRuntimeError>;
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
export type VersionedVariant<T extends AnyVariant> = Readonly<{
  sinceVersion: ProtocolVersion.ProtocolVersion;
  variant: T;
}>;

export type AnyVersionedVariant = VersionedVariant<AnyVariant>;

/**
 * An ordered array of types that associates a {@link Variant} with a given version of the Midnight protocol.
 *
 * @remarks
 * The expected order of the variants will be ascending on `sinceVersion`.
 */
export type AnyVersionedVariantArray = AnyVersionedVariant[];

export type VariantTag<T> =
  T extends VersionedVariant<infer V> ? VariantTag<V> : T extends Poly.WithTag<infer Tag> ? Tag : never;
export type VariantRecord<Variants> = Variants extends [infer THead, ...infer TRest]
  ? { readonly [K in VariantTag<THead>]: THead } & VariantRecord<TRest>
  : Variants extends []
    ? object
    : never;
export const getVersionedVariantTag = <Variant extends AnyVariant>(v: VersionedVariant<Variant>): VariantTag<Variant> =>
  Poly.getTag(v.variant) as VariantTag<Variant>;
export const makeVersionedRecord = <Variants extends AnyVersionedVariantArray>(
  variants: Variants,
): VariantRecord<Variants> => {
  return variants.reduce((acc: Partial<VariantRecord<Variants>>, variant) => {
    return { ...acc, [getVersionedVariantTag(variant)]: variant };
  }, {}) as VariantRecord<Variants>;
};
