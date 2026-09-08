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
/* eslint-disable @typescript-eslint/no-explicit-any -- unknown does not work well as a default, because it causes assignability issues */
import { Either, Option, type Scope, type SubscriptionRef } from 'effect';
import type { Effect } from 'effect/Effect';
import type { Stream } from 'effect/Stream';
import { type HList, Poly } from '@midnightntwrk/wallet-sdk-utilities';
import { ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { type WalletRuntimeError } from './WalletRuntimeError.js';
import type * as StateChange from './StateChange.js';

export interface VariantContext<TState> {
  stateRef: SubscriptionRef.SubscriptionRef<TState>;
  /**
   * The half-open protocol version range `[sinceVersion, nextVariantSinceVersion)` the variant is active for, derived
   * from the registration order of the variants.
   *
   * @remarks
   *   A variant uses it to recognize data that belongs to another variant: observing a protocol version outside of this
   *   range is what makes it emit a {@link StateChange.VersionChange}, so the runtime can migrate to the variant that
   *   owns that version.
   *
   *   The runtime keeps the same range on its own `RunningVariant` record, but that record is built _from_ the result of
   *   {@link Variant.start} and a variant holds no back-reference to the runtime, so it is unreachable from inside a
   *   starting variant. Handing it over through the context keeps `withVariant(sinceVersion)` the single source of
   *   truth, so the migration boundary the runtime enforces and the boundary a variant splits its sync batches on
   *   cannot drift apart.
   */
  activationRange: ProtocolVersion.ProtocolVersion.Range;
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

  /**
   * Produces this variant's initial state from the previous variant's state, at the protocol version boundary.
   *
   * @remarks
   *   An implementation is expected to be written so that it succeeds: a migration that fails leaves the wallet unable to
   *   follow the chain past the fork, so re-shaping state must not be able to reject state a previous variant
   *   considered valid.
   *
   *   The error channel is not an invitation to weaken that; it exists because part of the migration is not the variant's
   *   own code. The v8-to-v9 state translation is a ledger-side tool reached across a WASM boundary
   *   (`LedgerStateTranslator` in `capabilities`): it is loaded at that moment, run to completion, and signals failure
   *   by throwing. A typed failure surfaces that on the state stream — which is what already happened at runtime before
   *   this signature said so — instead of turning it into a defect that tears the runtime down with no diagnosis.
   */
  migrateState(previousState: TPreviousState): Effect<TState, WalletRuntimeError>;
};

export type RunningVariant<TTag extends symbol | string, TState> = Poly.WithTag<TTag> & {
  state: Stream<StateChange.StateChange<TState>, WalletRuntimeError>;
};

/** A utility type that represents any {@link Variant}. */
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

/** An array of {@link Variant} instances. */
export type AnyVariantArray = AnyVariant[];

/** A type that associates a {@link Variant} with a given version of the Midnight protocol. */
export type VersionedVariant<T extends AnyVariant> = Readonly<{
  sinceVersion: ProtocolVersion.ProtocolVersion;
  variant: T;
}>;

export type AnyVersionedVariant = VersionedVariant<AnyVariant>;

/**
 * An ordered array of types that associates a {@link Variant} with a given version of the Midnight protocol.
 *
 * @remarks
 *   The expected order of the variants will be ascending on `sinceVersion`.
 */
export type AnyVersionedVariantArray = AnyVersionedVariant[];

export type VariantTag<T> =
  T extends VersionedVariant<infer V> ? VariantTag<V> : T extends Poly.WithTag<infer Tag> ? Tag : never;
export type VariantRecord<Variants> = Variants extends [infer THead, ...infer TRest]
  ? { readonly [K in VariantTag<THead>]: THead } & VariantRecord<TRest>
  : Variants extends []
    ? object
    : never;
/**
 * Reads the tag of the variant a {@link VersionedVariant} wraps.
 *
 * @remarks
 *   Generic over the versioned variant rather than over the variant inside it, so that a union — what
 *   {@link selectByRange} resolves to — yields the union of its tags instead of collapsing to the first member's.
 */
export const getVersionedVariantTag = <TVersionedVariant extends AnyVersionedVariant>(
  v: TVersionedVariant,
): VariantTag<TVersionedVariant> => Poly.getTag(v.variant) as VariantTag<TVersionedVariant>;
export const makeVersionedRecord = <Variants extends AnyVersionedVariantArray>(
  variants: Variants,
): VariantRecord<Variants> => {
  return variants.reduce((acc: Partial<VariantRecord<Variants>>, variant) => {
    return { ...acc, [getVersionedVariantTag(variant)]: variant };
  }, {}) as VariantRecord<Variants>;
};

/**
 * Finds the variant that is active for a given protocol version.
 *
 * @remarks
 *   Registration says only which version a variant starts answering for, so the range it owns is `[sinceVersion,
 *   nextVariantSinceVersion)` — the same half-open window the runtime hands a starting variant as
 *   {@link VariantContext.activationRange}, derived here through the shared
 *   {@link ProtocolVersion.makeRegistryFromActivations} so the two cannot disagree.
 *
 *   Selection is total: a version below the first registration, or a registration order the builder would have rejected
 *   anyway (`withVariant` throws on a version that is not strictly ascending), selects nothing rather than throwing.
 *   Callers decide what a miss means — for restoring a snapshot it is an unsupported snapshot version, not a defect.
 * @param variants The registered variants, in ascending order of `sinceVersion`.
 * @param version The protocol version to resolve.
 * @returns The versioned variant whose activation range contains `version`, if there is one.
 */
export const selectByRange = <Variants extends AnyVersionedVariantArray>(
  variants: Variants,
  version: ProtocolVersion.ProtocolVersion,
): Option.Option<HList.Each<Variants>> =>
  ProtocolVersion.makeRegistryFromActivations(
    variants.map((variant: HList.Each<Variants>) => ({ sinceVersion: variant.sinceVersion, value: variant })),
  ).pipe(
    Either.match({
      onLeft: (): Option.Option<HList.Each<Variants>> => Option.none(),
      onRight: (registry) => ProtocolVersion.select(registry, version),
    }),
  );
