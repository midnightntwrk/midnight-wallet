import { describe, it } from '@jest/globals';
import { Equal, Expect } from '../../test/testUtils';
import { dispatch, PolyFunction, TagOf } from '../polyFunction';

describe('PolyFunction', () => {
  type NumberVariant = {
    __polyTag__: 'NumberVariant';
    number: number;
  };

  const stringTag: unique symbol = Symbol('StringTag');
  type StringVariant = {
    __polyTag__: typeof stringTag;
    string: string;
  };

  it('properly infers tag', () => {
    type _1 = Expect<Equal<TagOf<NumberVariant>, 'NumberVariant'>>;
    type _2 = Expect<Equal<TagOf<StringVariant>, typeof stringTag>>;
  });

  it('properly builds poly function type for single variant', () => {
    type Foo = 'foo';
    type _1 = Expect<Equal<PolyFunction<NumberVariant, Foo>, { NumberVariant: (variant: NumberVariant) => Foo }>>;
    type _2 = Expect<Equal<PolyFunction<StringVariant, Foo>, { [stringTag]: (variant: StringVariant) => Foo }>>;
  });

  it('properly builds poly function type for multiple variants', () => {
    type Foo = 'foo';
    type _1 = Expect<
      Equal<
        PolyFunction<NumberVariant | StringVariant, Foo>,
        {
          NumberVariant: (variant: NumberVariant) => Foo;
          [stringTag]: (variant: StringVariant) => Foo;
        }
      >
    >;
  });

  it('provides a union of arguments if multiple variants have the same tag', () => {
    type Foo = 'foo';
    type Variant11 = {
      __polyTag__: 'Variant1';
      value: string;
    };
    type Variant12 = {
      __polyTag__: 'Variant1';
      value: number;
    };
    type Variant2 = {
      __polyTag__: 'Variant2';
      values: string[];
    };

    type _1 = Expect<
      Equal<
        PolyFunction<Variant11 | Variant12 | Variant2, Foo>,
        {
          Variant1: (variant: Variant11 | Variant12) => Foo;
          Variant2: (variant: Variant2) => Foo;
        }
      >
    >;
    const impl: PolyFunction<Variant11 | Variant12 | Variant2, string> = {
      Variant1: (variant) => {
        switch (typeof variant.value) {
          case 'string':
            return `variant11:${variant.value}`;
          case 'number':
            return `variant12:${variant.value.toString(16)}`;
        }
      },
      Variant2: (variant) => {
        return `variant2:${variant.values.join(',')}`;
      },
    };

    expect(dispatch({ __polyTag__: 'Variant1', value: 'foo' }, impl)).toEqual('variant11:foo');
    expect(dispatch({ __polyTag__: 'Variant1', value: 42 }, impl)).toEqual('variant12:2a');
    expect(dispatch({ __polyTag__: 'Variant2', values: ['a', 'b', 'c'] }, impl)).toEqual('variant2:a,b,c');
  });

  it('dispatches the call correctly', () => {
    const impl: PolyFunction<NumberVariant | StringVariant, string> = {
      NumberVariant: (variant: NumberVariant) => `number:${variant.number}`,
      [stringTag]: (variant: StringVariant) => `string:${variant.string}`,
    };

    expect(dispatch({ __polyTag__: 'NumberVariant', number: 42 }, impl)).toEqual('number:42');
    expect(dispatch({ __polyTag__: stringTag, string: 'foo' }, impl)).toEqual('string:foo');
  });

  it('throws an error if dispatch target is not provided in the polyFunction', () => {
    const impl = {
      NumberVariant: (variant: NumberVariant) => `number:${variant.number}`,
      // [stringTag]: (variant: StringVariant) => `string:${variant.string}`,
    } as PolyFunction<NumberVariant | StringVariant, string>;

    expect(dispatch({ __polyTag__: 'NumberVariant', number: 42 }, impl)).toEqual('number:42');
    expect(() => dispatch({ __polyTag__: stringTag, string: 'foo' }, impl)).toThrow(String(stringTag));
  });
});
