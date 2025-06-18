import { describe, it } from '@jest/globals';
import { CanAssign, Equal, Expect } from '../../test/testUtils';
import {
  InterceptingRunningVariant,
  InterceptingVariant,
  Numeric,
  NumericMultiplier,
  NumericRange,
  NumericRangeMultiplier,
} from '../../test/variants';
import * as H from '../../utils/hlist';
import * as Poly from '../../utils/polyFunction';
import { ProtocolVersion } from '../ProtocolVersion';
import { makeVersionedRecord, RunningVariant, RunningVariantOf, StateOf, VersionedVariant } from '../Variant';

describe('Variant', () => {
  it('infers its state correctly', () => {
    type _1 = Expect<Equal<StateOf<VersionedVariant<NumericRange>>, number>>;
    type _2 = Expect<Equal<StateOf<NumericRange>, number>>;
    type _3 = Expect<Equal<StateOf<VersionedVariant<NumericRangeMultiplier>>, number>>;
    type _4 = Expect<Equal<StateOf<NumericRangeMultiplier>, number>>;
    type _5 = Expect<Equal<StateOf<VersionedVariant<InterceptingVariant<string, string>>>, string>>;
    type _6 = Expect<Equal<StateOf<InterceptingVariant<string, string>>, string>>;
    type _7 = Expect<
      Equal<StateOf<InterceptingVariant<string, string> | NumericRangeMultiplier | NumericRange>, string | number>
    >;
    type _8 = Expect<
      Equal<
        StateOf<
          | VersionedVariant<InterceptingVariant<string, string>>
          | VersionedVariant<NumericRangeMultiplier>
          | VersionedVariant<NumericRange>
        >,
        string | number
      >
    >;
  });

  it('infers variant state by finding it in an hlist', () => {
    type Variants = [
      VersionedVariant<InterceptingVariant<'foo', string>>,
      VersionedVariant<NumericRangeMultiplier>,
      VersionedVariant<NumericRange>,
    ];
    type InferState<TTag extends string | symbol> = StateOf<H.Find<Variants, { variant: Poly.WithTag<TTag> }>>;

    type _1 = Expect<Equal<InferState<'foo'>, string>>;
    type _2 = Expect<Equal<InferState<typeof Numeric>, number>>;
    type _3 = Expect<Equal<InferState<typeof NumericMultiplier>, number>>;

    type _4 = Expect<Equal<InferState<'bar'>, never>>;
  });

  it('infers its running type correctly', () => {
    type _1 = Expect<Equal<RunningVariantOf<VersionedVariant<NumericRange>>, RunningVariant<'NumericRange', number>>>;
    type _2 = Expect<Equal<RunningVariantOf<NumericRange>, RunningVariant<'NumericRange', number>>>;
    type _3 = Expect<
      Equal<RunningVariantOf<VersionedVariant<NumericRangeMultiplier>>, RunningVariant<'NumericMultiplier', number>>
    >;
    type _4 = Expect<Equal<RunningVariantOf<NumericRangeMultiplier>, RunningVariant<'NumericMultiplier', number>>>;
    type _5 = Expect<
      Equal<
        RunningVariantOf<VersionedVariant<InterceptingVariant<string, string>>>,
        InterceptingRunningVariant<string, string>
      >
    >;
    type _6 = Expect<
      Equal<RunningVariantOf<InterceptingVariant<string, string>>, InterceptingRunningVariant<string, string>>
    >;
    type _7 = Expect<
      Equal<
        RunningVariantOf<InterceptingVariant<string, string> | NumericRangeMultiplier | NumericRange>,
        | RunningVariant<'NumericRange', number>
        | RunningVariant<'NumericMultiplier', number>
        | InterceptingRunningVariant<string, string>
      >
    >;
    type _8 = Expect<
      Equal<
        RunningVariantOf<
          | VersionedVariant<InterceptingVariant<string, string>>
          | VersionedVariant<NumericRangeMultiplier>
          | VersionedVariant<NumericRange>
        >,
        | RunningVariant<'NumericRange', number>
        | RunningVariant<'NumericMultiplier', number>
        | InterceptingRunningVariant<string, string>
      >
    >;
  });

  describe('building a tagged record', () => {
    it('returns and infers an empty object in case of empty array provided', () => {
      const record = makeVersionedRecord([] as const);
      expect(record).toEqual({});
      type _1 = Expect<Equal<typeof record, object>>;
    });

    it('returns and infers in single-variant case correctly', () => {
      const range: VersionedVariant<NumericRange> = {
        sinceVersion: ProtocolVersion(1n),
        variant: new NumericRange({ min: 0, max: 1 }, 1, false),
      };
      const record1 = makeVersionedRecord([range] as const);
      expect(record1).toEqual({ [Numeric]: range });
      type _1 = Expect<Equal<typeof record1, object & { readonly NumericRange: VersionedVariant<NumericRange> }>>;

      const rangeMultiplier: VersionedVariant<NumericRangeMultiplier> = {
        sinceVersion: ProtocolVersion(1n),
        variant: new NumericRangeMultiplier({ min: 0, max: 1, multiplier: 2 }),
      };
      const record2 = makeVersionedRecord([rangeMultiplier] as const);
      expect(record2).toEqual({ [NumericMultiplier]: rangeMultiplier });
      type _2 = Expect<
        Equal<typeof record2, object & { readonly NumericMultiplier: VersionedVariant<NumericRangeMultiplier> }>
      >;

      const interceptor: VersionedVariant<InterceptingVariant<'foo', number>> = {
        sinceVersion: ProtocolVersion(1n),
        variant: new InterceptingVariant('foo'),
      };
      const record3 = makeVersionedRecord([interceptor] as const);
      expect(record3).toEqual({ foo: interceptor });
      type _3 = Expect<
        Equal<typeof record3, object & { readonly foo: VersionedVariant<InterceptingVariant<'foo', number>> }>
      >;
    });

    it('returns and infers in multi-variant case correctly', () => {
      const range: VersionedVariant<NumericRange> = {
        sinceVersion: ProtocolVersion(1n),
        variant: new NumericRange({ min: 0, max: 1 }, 1, false),
      };
      const rangeMultiplier: VersionedVariant<NumericRangeMultiplier> = {
        sinceVersion: ProtocolVersion(1n),
        variant: new NumericRangeMultiplier({ min: 0, max: 1, multiplier: 2 }),
      };
      const interceptor: VersionedVariant<InterceptingVariant<'foo', number>> = {
        sinceVersion: ProtocolVersion(1n),
        variant: new InterceptingVariant('foo'),
      };

      const record = makeVersionedRecord([range, rangeMultiplier, interceptor] as const);
      expect(record).toEqual({
        [Numeric]: range,
        [NumericMultiplier]: rangeMultiplier,
        foo: interceptor,
      });
      type _1 = Expect<
        CanAssign<
          {
            readonly NumericRange: VersionedVariant<NumericRange>;
            readonly NumericMultiplier: VersionedVariant<NumericRangeMultiplier>;
            readonly foo: VersionedVariant<InterceptingVariant<'foo', number>>;
          },
          typeof record
        >
      >;
    });
  });
});
