import { describe, it } from '@jest/globals';
import { VariantBuilder } from '../abstractions/index';
import { FullConfiguration } from '../WalletBuilder';
import { CanAssign, Equal } from './testUtils';
import {
  InterceptingVariantBuilder,
  NumericRangeBuilder,
  NumericRangeMultiplierBuilder,
  RangeConfig,
  RangeMultiplierConfig,
} from './variants';
import { Expect } from '../utils/types';

describe('WalletBuilder', () => {
  describe('inferring configuration type', () => {
    it('infers undefined for no variants', () => {
      type _1 = Expect<Equal<FullConfiguration<[]>, undefined>>;
    });

    it('infers undefined for a variant with no effective configuration to pass', () => {
      type _11 = Expect<
        Equal<
          FullConfiguration<[VariantBuilder.VersionedVariantBuilder<InterceptingVariantBuilder<string, string>>]>,
          undefined
        >
      >;
    });

    it('infers an expected intersection type with multiple variants', () => {
      //Note: CanAssign assertion is used because the exact types are following the pattern object & Variant1Config & Variant2Config
      type _2 = Expect<
        Equal<FullConfiguration<[VariantBuilder.VersionedVariantBuilder<NumericRangeBuilder>]>, RangeConfig>
      >;
      type _3 = Expect<
        CanAssign<
          RangeConfig,
          FullConfiguration<
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
          FullConfiguration<
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
