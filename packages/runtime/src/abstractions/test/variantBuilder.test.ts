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
import { HList } from '@midnight-ntwrk/wallet-sdk-utilities';
import type { Equal, Expect } from '@midnight-ntwrk/wallet-sdk-utilities/types';
import { describe, it } from 'vitest';
import {
  InterceptingVariant,
  InterceptingVariantBuilder,
  NumericRange,
  NumericRangeBuilder,
  NumericRangeMultiplier,
  NumericRangeMultiplierBuilder,
  RangeConfig,
  RangeMultiplierConfig,
} from '../../testing/variants.js';
import { VersionedVariant } from '../Variant.js';
import { ConfigurationOf, VersionedVariantBuilder, VersionedVariantsOf } from '../VariantBuilder.js';

describe('VariantBuilder', () => {
  type Builders = [NumericRangeBuilder, InterceptingVariantBuilder<string, string>, NumericRangeMultiplierBuilder];
  type VersionedBuilders = [
    VersionedVariantBuilder<NumericRangeBuilder>,
    VersionedVariantBuilder<InterceptingVariantBuilder<string, string>>,
    VersionedVariantBuilder<NumericRangeMultiplierBuilder>,
  ];

  it('properly infers its versioned variant types', () => {
    type Expected = [
      VersionedVariant<NumericRange>,
      VersionedVariant<InterceptingVariant<string, string>>,
      VersionedVariant<NumericRangeMultiplier>,
    ];

    type _1 = Expect<Equal<VersionedVariantsOf<Builders>, Expected>>;
    type _2 = Expect<Equal<VersionedVariantsOf<VersionedBuilders>, Expected>>;
  });

  it('properly infers needed configuration', () => {
    type Expected = RangeConfig | RangeMultiplierConfig | object;

    type _1 = Expect<Equal<ConfigurationOf<VersionedVariantBuilder<NumericRangeBuilder>>, RangeConfig>>;
    type _2 = Expect<Equal<ConfigurationOf<NumericRangeBuilder>, RangeConfig>>;
    type _3 = Expect<
      Equal<ConfigurationOf<VersionedVariantBuilder<InterceptingVariantBuilder<string, string>>>, object>
    >;
    type _4 = Expect<Equal<ConfigurationOf<InterceptingVariantBuilder<string, string>>, object>>;

    type _5 = Expect<
      Equal<ConfigurationOf<VersionedVariantBuilder<NumericRangeMultiplierBuilder>>, RangeMultiplierConfig>
    >;
    type _6 = Expect<Equal<ConfigurationOf<NumericRangeMultiplierBuilder>, RangeMultiplierConfig>>;
    type _7 = Expect<Equal<ConfigurationOf<HList.Each<Builders>>, Expected>>;
    type _8 = Expect<Equal<ConfigurationOf<HList.Each<VersionedBuilders>>, Expected>>;
  });
});
