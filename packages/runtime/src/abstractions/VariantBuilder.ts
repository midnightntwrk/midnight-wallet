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
import { ProtocolVersion } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { AnyVariant, VersionedVariant } from './Variant.js';

/**
 * Builds a target {@link Variant} object from internal build state.
 *
 * @typeParam TTState The type of state that the variant will operate over.
 * @typeParam TPreviousState The type of state that the variant can migrate from.
 * @typeParam TConfiguration A type representing the configuration required by the variant.
 */

export interface VariantBuilder<TVariant extends AnyVariant, TConfiguration extends object = object> {
  /**
   * Builds the target variant object from the internal build state.
   *
   * @param configuration The configuration to use when building the target variant.
   *
   * @returns An instance of {@link Variant} that operates over `TState`.
   */
  build(configuration: TConfiguration): TVariant;
}

/**
 * Base type that represents variant configuration.
 */
export type AnyBuilderConfiguration = object;

/**
 * A utility type that represents any {@link VariantBuilder}.
 */
export type AnyVariantBuilder = VariantBuilder<AnyVariant, AnyBuilderConfiguration>;

export type VariantOf<T> =
  T extends VersionedVariantBuilder<infer TBuilder>
    ? VariantOf<TBuilder>
    : T extends VariantBuilder<infer TVariant, object>
      ? TVariant
      : never;

export type VersionedVariantBuilder<TBuilder extends AnyVariantBuilder> = Readonly<{
  sinceVersion: ProtocolVersion.ProtocolVersion;
  variantBuilder: TBuilder;
}>;

export type VariantsOf<T> = T extends [infer THead, ...infer TRest]
  ? [VariantOf<THead>, ...VariantsOf<TRest>]
  : T extends []
    ? []
    : never;

export type VersionedVariantsOf<T> = T extends [infer THead, ...infer Rest]
  ? [VersionedVariant<VariantOf<THead>>, ...VersionedVariantsOf<Rest>]
  : T extends []
    ? []
    : never;

export type ConfigurationOf<T> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  T extends VariantBuilder<any, infer Config>
    ? Config
    : T extends VersionedVariantBuilder<infer Builder>
      ? ConfigurationOf<Builder>
      : never;

/**
 * A type that associates a {@link VariantBuilder} with a given version of the Midnight protocol.
 */
export type AnyVersionedVariantBuilder = VersionedVariantBuilder<AnyVariantBuilder>;
