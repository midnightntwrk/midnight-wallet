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
import { Data } from 'effect';
import { type VersionChangeType } from './VersionChangeType.js';

/**
 * A tagged enum data type that represents the state changes across wallet implementation variants.
 *
 * @remarks
 * A variant can report changes in state using the {@link StateChange.State} enum variant. The
 * {@link StateChange.ProgressUpdate} and {@link StateChange.VersionChange} enum variants should be used when a
 * variant needs to report a sync progress update, or a detected change in protocol version respectively.
 */
export type StateChange<TState> = Data.TaggedEnum<{
  /** A change in state. */
  State: { readonly state: TState };

  /** A change in reported progress. */
  ProgressUpdate: {
    /**
     * The number of blocks that remain for the underlying datasource to process in order to be fully synchronized.
     */
    readonly sourceGap: bigint;
    /**
     * The number of blocks that remain for the variant to apply in order to be fully synchronized.
     */
    readonly applyGap: bigint;
  };

  /** A change in Midnight protocol version. */
  VersionChange: { readonly change: VersionChangeType };
}>;
const StateChange = Data.taggedEnum<_StateChange>();

interface _StateChange extends Data.TaggedEnum.WithGenerics<1> {
  readonly taggedEnum: StateChange<this['A']>;
}

/**
 * A type predicate that determines if a given value is a {@link StateChange.State} enum variant.
 */
export const isState = StateChange.$is('State');

/**
 * A type predicate that determines if a given value is a {@link StateChange.ProgressUpdate} enum variant.
 */
export const isProgressUpdate = StateChange.$is('ProgressUpdate');

/**
 * A type predicate that determines if a given value is a {@link StateChange.VersionChange} enum variant.
 */
export const isVersionChange = StateChange.$is('VersionChange');

export const { $match: match, State, ProgressUpdate, VersionChange } = StateChange;
