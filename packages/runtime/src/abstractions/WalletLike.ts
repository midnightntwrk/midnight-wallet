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
/* eslint-disable @typescript-eslint/no-explicit-any */
import { type Option, type Scope } from 'effect';
import { type Observable } from 'rxjs';
import { type Runtime, type RuntimeState } from '../Runtime.js';
import { type AnyVersionedVariantArray, type StateOf, type VariantRecord } from './Variant.js';
import { type HList, type Poly } from '@midnightntwrk/wallet-sdk-utilities';
import { type ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';

/** Defines the static portion of base wallet class definition */
export interface BaseWalletClass<TVariants extends AnyVersionedVariantArray, TConfiguration = object> {
  readonly configuration: Readonly<TConfiguration>;
  new (runtime: Runtime<TVariants>, scope: Scope.CloseableScope): WalletLike<TVariants>;
  allVariants(): TVariants;
  allVariantsRecord(): VariantRecord<TVariants>;
  /**
   * Resolves the variant that is active for a given protocol version, so a caller holding only a version — a snapshot's
   * envelope, the chain's current version — can address {@link start} by the tag of the variant that owns it.
   *
   * @param version The protocol version to resolve.
   * @returns The versioned variant whose activation range contains `version`, or `Option.none()` when no registered
   *   variant covers it.
   */
  variantFor(version: ProtocolVersion.ProtocolVersion): Option.Option<HList.Each<TVariants>>;
  startEmpty<T extends WalletClassLike<TVariants, any>>(walletClass: T): WalletOf<T>;
  startFirst<T extends WalletClassLike<TVariants, any>>(
    walletClass: T,
    state: StateOf<HList.Head<TVariants>>,
  ): WalletOf<T>;
  start<T extends WalletClassLike<TVariants, any>, Tag extends string | symbol>(
    walletClass: T,
    tag: Tag,
    state: StateOf<HList.Find<TVariants, { variant: Poly.WithTag<Tag> }>>,
  ): WalletOf<T>;
  /**
   * Starts a wallet on a variant that was resolved at runtime, with the state that variant produced.
   *
   * @remarks
   *   The sibling {@link start} addresses a variant by a tag known statically, which is what lets it demand exactly that
   *   variant's state type. A tag recovered from data — a snapshot's protocol version, the chain's current version —
   *   carries no such static knowledge, and `HList.Find` over a union of tags cannot recover it: it resolves to the
   *   first matching registration, or to `never`, so the state parameter it computes is not the one the caller holds.
   *
   *   Passing the resolved variant itself instead keeps the two ends of the pairing together. The state is typed as that
   *   variant's, which for a `variantFor` result is the union of the registered variants' states — the honest guarantee
   *   when the version is runtime data, and enough to make the call type-check without a cast at the call site.
   * @param walletClass The wallet class to construct.
   * @param variant The versioned variant to start on, as resolved by {@link variantFor}.
   * @param state The state that variant is to start from.
   * @returns The started wallet.
   */
  startAtVariant<T extends WalletClassLike<TVariants, any>, TVariant extends HList.Each<TVariants>>(
    walletClass: T,
    variant: TVariant,
    state: StateOf<TVariant>,
  ): WalletOf<T>;
}

/** Defines the static portion of wallet-like definition */
export interface WalletClassLike<
  TVariants extends AnyVersionedVariantArray,
  TWallet extends WalletLike<TVariants>,
> extends BaseWalletClass<TVariants> {
  new (runtime: Runtime<TVariants>, scope: Scope.CloseableScope): TWallet;
}

export type AnyWalletClass<Variants extends AnyVersionedVariantArray> = WalletClassLike<Variants, WalletLike<Variants>>;
export type WalletOf<T> = T extends WalletClassLike<any, infer TWallet> ? TWallet : never;

/**
 * Defines a base wallet-like implementation.
 *
 * @typeParam TVariants Underlying variants
 */
export interface WalletLike<TVariants extends AnyVersionedVariantArray> {
  readonly runtime: Runtime<TVariants>;
  readonly runtimeScope: Scope.CloseableScope;

  /** A stream of state changes over any amount of time that have been processed by the wallet. */
  readonly rawState: Observable<RuntimeState<TVariants>>;

  /** Stops the wallet */
  stop(): Promise<void>;
}
