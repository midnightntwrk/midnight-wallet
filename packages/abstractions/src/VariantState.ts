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

/**
 * The state of whichever wallet variant produced an emission, sealed so that only that variant can read it.
 *
 * @remarks
 *   A wallet spanning a protocol boundary emits states from more than one variant, and each variant's core state is made
 *   of its own ledger version's objects. Typing the state an application receives as either one names a ledger version
 *   in the wallet's API; typing it as the union of both names two, and still leaves the reader to tell them apart.
 *
 *   So the wallet seals the core state together with the tag of the variant that produced it — the tag the runtime
 *   publishes every state with — and only that variant unwraps it. Everything an application reads is projected by the
 *   wallet state beside it; the core state is reachable only through the variant's own subpath, which is where its
 *   ledger version is named anyway. It is the {@link WalletTransaction} arrangement applied to state: there the seal is
 *   broken by a protocol version range, here by the variant itself, because the producing variant is known exactly
 *   where the state is built.
 */
import * as Option from 'effect/Option';

/**
 * A variant's core state, reachable only by that variant.
 *
 * @remarks
 *   A class for the same reason {@link WalletTransaction} is one: a `#private` field is the only way to carry something an
 *   application provably cannot reach. Nothing about it mutates.
 * @example
 *   ```typescript
 *   const sealed = VariantState.seal(V2Tag, coreWallet);
 *   const mine = VariantState.unwrapFor<CoreWallet>(sealed, V2Tag); // Option.some(coreWallet)
 *   const theirs = VariantState.unwrapFor<V1CoreWallet>(sealed, V1Tag); // Option.none()
 *   ```;
 */
export class VariantState {
  /** The tag of the variant that produced the state, and so the only one that can read it. */
  readonly #variantTag: string | symbol;

  /** The core state itself, of whichever ledger version that variant runs. */
  readonly #carried: unknown;

  private constructor(variantTag: string | symbol, carried: unknown) {
    this.#variantTag = variantTag;
    this.#carried = carried;
  }

  /**
   * Seals a variant's core state.
   *
   * @param variantTag The tag of the variant that produced the state.
   * @param state The variant's core state.
   * @returns The sealed state.
   */
  static seal(variantTag: string | symbol, state: unknown): VariantState {
    return new VariantState(variantTag, state);
  }

  /**
   * Reads the state a handle carries, if the caller is the variant that sealed it.
   *
   * @remarks
   *   Tags are compared by identity, so two packages' variants that share a tag's description — every wallet package
   *   names its variants `V1` and `V2` — are still told apart. The result type is the caller's to name, because the
   *   handle deliberately does not remember it; the tag is the whole of the guarantee.
   * @param handle The sealed state.
   * @param variantTag The tag of the variant asking.
   * @returns The carried state, or nothing when another variant produced it or another copy of this class sealed it,
   *   whose private fields this class cannot read.
   */
  static unwrapFor<T>(handle: VariantState, variantTag: string | symbol): Option.Option<T> {
    // The carried type is erased when a state is sealed, and deliberately: remembering it would put a ledger version
    // back into the handle's own type. The tag check is the same guarantee the caller would otherwise make for itself.
    return VariantState.is(handle) && handle.#variantTag === variantTag
      ? Option.some(handle.#carried as T)
      : Option.none();
  }

  /**
   * Determines whether a value is a sealed variant state.
   *
   * @param value The value to test.
   * @returns `true` when `value` is a {@link VariantState}.
   */
  static is(value: unknown): value is VariantState {
    return typeof value === 'object' && value !== null && #carried in value;
  }
}
