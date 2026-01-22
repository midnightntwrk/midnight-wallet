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
import { type CanAssign, type Equal, type Expect } from '@midnight-ntwrk/wallet-sdk-utilities/types';
import { type VariantBuilder } from '../abstractions/index.js';
import { type WalletBuilder } from '../WalletBuilder.js';
import {
  type InterceptingVariantBuilder,
  type NumericRangeBuilder,
  type NumericRangeMultiplierBuilder,
  type RangeConfig,
  type RangeMultiplierConfig,
} from '../testing/variants.js';
import { describe, it } from 'vitest';

describe('WalletBuilder', () => {
  describe('inferring configuration type', () => {
    it('infers undefined for no variants', () => {
      type _1 = Expect<Equal<WalletBuilder.FullConfiguration<[]>, unknown>>;
    });

    it('infers undefined for a variant with no effective configuration to pass', () => {
      type _11 = Expect<
        Equal<
          WalletBuilder.FullConfiguration<
            [VariantBuilder.VersionedVariantBuilder<InterceptingVariantBuilder<string, string>>]
          >,
          object
        >
      >;
    });

    it('infers an expected intersection type with multiple variants', () => {
      //Note: CanAssign assertion is used because the exact types are following the pattern object & Variant1Config & Variant2Config
      type _2 = Expect<
        Equal<
          WalletBuilder.FullConfiguration<[VariantBuilder.VersionedVariantBuilder<NumericRangeBuilder>]>,
          RangeConfig
        >
      >;
      type _3 = Expect<
        CanAssign<
          RangeConfig,
          WalletBuilder.FullConfiguration<
            [
              VariantBuilder.VersionedVariantBuilder<NumericRangeBuilder>,
              VariantBuilder.VersionedVariantBuilder<InterceptingVariantBuilder<string, string>>,
            ]
          >
        >
      >;
      type _4 = Expect<
        CanAssign<
          RangeMultiplierConfig,
          WalletBuilder.FullConfiguration<
            [
              VariantBuilder.VersionedVariantBuilder<NumericRangeBuilder>,
              VariantBuilder.VersionedVariantBuilder<InterceptingVariantBuilder<string, string>>,
              VariantBuilder.VersionedVariantBuilder<NumericRangeMultiplierBuilder>,
            ]
          >
        >
      >;
    });
  });

  describe('inferring build parameters type', () => {
    it('infers no parameters for no variants', () => {
      type _1 = Expect<Equal<WalletBuilder.BuildArguments<[]>, []>>;
    });

    it('infers no parameters if variant does not have effective config', () => {
      type _1 = Expect<
        Equal<
          WalletBuilder.BuildArguments<
            [VariantBuilder.VersionedVariantBuilder<InterceptingVariantBuilder<string, string>>]
          >,
          []
        >
      >;
    });

    it('infers proper type for single variant', () => {
      type _1 = Expect<
        Equal<
          WalletBuilder.BuildArguments<[VariantBuilder.VersionedVariantBuilder<NumericRangeBuilder>]>,
          [RangeConfig]
        >
      >;
      type _2 = Expect<
        Equal<
          WalletBuilder.BuildArguments<[VariantBuilder.VersionedVariantBuilder<NumericRangeMultiplierBuilder>]>,
          [RangeMultiplierConfig]
        >
      >;
    });

    it('infers proper type for multiple variants', () => {
      type _1 = Expect<
        CanAssign<
          [RangeConfig],
          WalletBuilder.BuildArguments<
            [
              VariantBuilder.VersionedVariantBuilder<NumericRangeBuilder>,
              VariantBuilder.VersionedVariantBuilder<InterceptingVariantBuilder<string, string>>,
            ]
          >
        >
      >;
      type _2 = Expect<
        CanAssign<
          [RangeMultiplierConfig],
          WalletBuilder.BuildArguments<
            [
              VariantBuilder.VersionedVariantBuilder<NumericRangeBuilder>,
              VariantBuilder.VersionedVariantBuilder<InterceptingVariantBuilder<string, string>>,
              VariantBuilder.VersionedVariantBuilder<NumericRangeMultiplierBuilder>,
            ]
          >
        >
      >;
    });
  });
});
