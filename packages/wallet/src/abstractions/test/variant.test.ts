import { describe, it } from '@jest/globals';
import { Equal, Expect } from '../../test/testUtils';
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
import { RunningVariant, RunningVariantOf, StateOf, VersionedVariant } from '../Variant';

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
});
