import { CanAssign, Equal, Expect } from '@midnight-ntwrk/wallet-sdk-utilities/types';
import { VariantBuilder } from '../abstractions/index.js';
import { WalletBuilder } from '../WalletBuilder.js';
import {
  InterceptingVariantBuilder,
  NumericRangeBuilder,
  NumericRangeMultiplierBuilder,
  RangeConfig,
  RangeMultiplierConfig,
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
