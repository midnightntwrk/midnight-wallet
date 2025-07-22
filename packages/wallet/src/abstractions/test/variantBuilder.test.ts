import { describe } from '@jest/globals';
import { HList, type Expect, type Equal } from '@midnight-ntwrk/abstractions';
import {
  InterceptingVariant,
  InterceptingVariantBuilder,
  NumericRange,
  NumericRangeBuilder,
  NumericRangeMultiplier,
  NumericRangeMultiplierBuilder,
  RangeConfig,
  RangeMultiplierConfig,
} from '../../test/variants';
import { VersionedVariant } from '../Variant';
import { ConfigurationOf, VersionedVariantBuilder, VersionedVariantsOf } from '../VariantBuilder';

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
