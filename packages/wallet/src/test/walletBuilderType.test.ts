import type { Expect, Equal } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { VariantBuilder } from '../abstractions/index';
import { FullConfiguration, BuildArguments } from '../WalletBuilder';
import { CanAssign } from './testUtils';
import {
  InterceptingVariantBuilder,
  NumericRangeBuilder,
  NumericRangeMultiplierBuilder,
  RangeConfig,
  RangeMultiplierConfig,
} from './variants';

describe('WalletBuilder', () => {
  describe('inferring configuration type', () => {
    it('infers undefined for no variants', () => {
      type _1 = Expect<Equal<FullConfiguration<[]>, unknown>>;
    });

    it('infers undefined for a variant with no effective configuration to pass', () => {
      type _11 = Expect<
        Equal<
          FullConfiguration<[VariantBuilder.VersionedVariantBuilder<InterceptingVariantBuilder<string, string>>]>,
          object
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

  describe('inferring build parameters type', () => {
    it('infers no parameters for no variants', () => {
      type _1 = Expect<Equal<BuildArguments<[]>, []>>;
    });

    it('infers no parameters if variant does not have effective config', () => {
      type _1 = Expect<
        Equal<BuildArguments<[VariantBuilder.VersionedVariantBuilder<InterceptingVariantBuilder<string, string>>]>, []>
      >;
    });

    it('infers proper type for single variant', () => {
      type _1 = Expect<
        Equal<BuildArguments<[VariantBuilder.VersionedVariantBuilder<NumericRangeBuilder>]>, [RangeConfig]>
      >;
      type _2 = Expect<
        Equal<
          BuildArguments<[VariantBuilder.VersionedVariantBuilder<NumericRangeMultiplierBuilder>]>,
          [RangeMultiplierConfig]
        >
      >;
    });

    it('infers proper type for multiple variants', () => {
      type _1 = Expect<
        CanAssign<
          [RangeConfig],
          BuildArguments<
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
          BuildArguments<
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
