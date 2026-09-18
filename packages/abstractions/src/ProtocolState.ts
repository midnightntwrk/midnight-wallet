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
import { Equivalence } from 'effect';
import type * as ProtocolVersion from './ProtocolVersion.js';

/**
 * A type that associates some state with a given version of the Midnight protocol, and with the variant that produced
 * it.
 *
 * @remarks
 *   `variantTag` is the tag of the wallet variant the emission came from. The runtime knows it at the moment it publishes
 *   a state, so it hands it over rather than leaving readers to infer the producing implementation from `version` —
 *   which would mean re-deriving activation ranges, and casting, on every emission. It travels with the state so that
 *   selecting the capabilities that understand a state is a lookup by tag.
 * @typeParam TState The type of state.
 * @typeParam TVariantTag The tag, or union of tags, of the variants that can produce this state.
 */
export type ProtocolState<TState, TVariantTag extends string | symbol = string | symbol> = Readonly<{
  version: ProtocolVersion.ProtocolVersion;
  variantTag: TVariantTag;
  state: TState;
}>;

export const state = <TState>(ps: ProtocolState<TState>): TState => ps.state;

/**
 * Derives an {@link Equivalence.Equivalence} for {@link ProtocolState} values from an equivalence of the underlying
 * state. Versions and producing variant tags are compared strictly.
 *
 * @param stateEquivalence The equivalence used to compare the `state` field.
 * @returns An equivalence over `ProtocolState<TState>`.
 */
export const getEquivalence = <TState, TVariantTag extends string | symbol = string | symbol>(
  stateEquivalence: Equivalence.Equivalence<TState>,
): Equivalence.Equivalence<ProtocolState<TState, TVariantTag>> =>
  Equivalence.struct({
    version: Equivalence.strict(),
    variantTag: Equivalence.strict<TVariantTag>(),
    state: stateEquivalence,
  });
