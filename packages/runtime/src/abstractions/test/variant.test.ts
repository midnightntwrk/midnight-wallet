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
import { HList, Poly } from '@midnight-ntwrk/wallet-sdk-utilities';
import type { Expect, Equal, CanAssign } from '@midnight-ntwrk/wallet-sdk-utilities/types';
import { describe, expect, it } from 'vitest';
import {
  InterceptingRunningVariant,
  InterceptingVariant,
  Numeric,
  NumericMultiplier,
  NumericRange,
  NumericRangeMultiplier,
} from '../../testing/variants.js';
import { makeVersionedRecord, RunningVariant, RunningVariantOf, StateOf, VersionedVariant } from '../Variant.js';

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
    type InferState<TTag extends string | symbol> = StateOf<HList.Find<Variants, { variant: Poly.WithTag<TTag> }>>;

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
        sinceVersion: ProtocolVersion.ProtocolVersion(1n),
        variant: new NumericRange({ min: 0, max: 1 }, 1, false),
      };
      const record1 = makeVersionedRecord([range] as const);
      expect(record1).toEqual({ [Numeric]: range });
      type _1 = Expect<Equal<typeof record1, object & { readonly NumericRange: VersionedVariant<NumericRange> }>>;

      const rangeMultiplier: VersionedVariant<NumericRangeMultiplier> = {
        sinceVersion: ProtocolVersion.ProtocolVersion(1n),
        variant: new NumericRangeMultiplier({ min: 0, max: 1, multiplier: 2 }),
      };
      const record2 = makeVersionedRecord([rangeMultiplier] as const);
      expect(record2).toEqual({ [NumericMultiplier]: rangeMultiplier });
      type _2 = Expect<
        Equal<typeof record2, object & { readonly NumericMultiplier: VersionedVariant<NumericRangeMultiplier> }>
      >;

      const interceptor: VersionedVariant<InterceptingVariant<'foo', number>> = {
        sinceVersion: ProtocolVersion.ProtocolVersion(1n),
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
        sinceVersion: ProtocolVersion.ProtocolVersion(1n),
        variant: new NumericRange({ min: 0, max: 1 }, 1, false),
      };
      const rangeMultiplier: VersionedVariant<NumericRangeMultiplier> = {
        sinceVersion: ProtocolVersion.ProtocolVersion(1n),
        variant: new NumericRangeMultiplier({ min: 0, max: 1, multiplier: 2 }),
      };
      const interceptor: VersionedVariant<InterceptingVariant<'foo', number>> = {
        sinceVersion: ProtocolVersion.ProtocolVersion(1n),
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
