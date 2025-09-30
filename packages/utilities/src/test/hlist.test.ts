import type { Equal, Expect } from '../testUtils';
import {
  Append,
  append,
  Each,
  Empty,
  empty,
  find,
  Find,
  foldLeft,
  foldRight,
  head,
  Head,
  headOr,
  HeadOr,
  Prepend,
  prepend,
  reverse,
  Reverse,
  Tail,
  Tails,
} from '../hlist';

describe('HList', () => {
  it('properly prepends to the list', () => {
    const addedNumber = prepend(empty, 1);
    const addedString = prepend(addedNumber, 'foo');

    type List = Prepend<Prepend<Empty, number>, string>;
    type _1 = Expect<Equal<List, [string, number]>>;
    type _2 = Expect<Equal<typeof addedNumber, [number]>>;
    type _3 = Expect<Equal<typeof addedString, [string, number]>>;

    expect(addedNumber).toEqual([1]);
    expect(addedString).toEqual(['foo', 1]);
  });

  it('properly appends to the list', () => {
    const addedNumber = append(empty, 1);
    const addedString = append(addedNumber, 'foo');

    type List = Append<Append<Empty, number>, string>;
    type _1 = Expect<Equal<List, [number, string]>>;
    type _2 = Expect<Equal<typeof addedNumber, [number]>>;
    type _3 = Expect<Equal<typeof addedString, [number, string]>>;

    expect(addedNumber).toEqual([1]);
    expect(addedString).toEqual([1, 'foo']);
  });

  it('properly gets first element', () => {
    const appendedNumber = append(empty, 1 as const);
    const appendedString = append(appendedNumber, 'foo' as const);
    const prependedString = prepend(appendedNumber, 'foo' as const);
    const appendedString2 = append(appendedString, 'bar' as const);
    const prependedString2 = prepend(prependedString, 'bar' as const);
    const prependedObject = prepend(prependedString2, { foo: 'bar' } as const);

    type _1 = Expect<Equal<Head<[number, string]>, number>>;
    type _2 = Expect<Equal<Head<[number]>, number>>;
    type _3 = Expect<Equal<Head<[number, 1, 2]>, number>>;
    type _4 = Expect<Equal<Head<[]>, never>>;

    expect(() => head(empty)).toThrow();
    expect(head(appendedNumber)).toEqual(1);
    type _5 = Expect<Equal<Head<typeof appendedNumber>, 1>>;
    expect(head(appendedString)).toEqual(1);
    type _6 = Expect<Equal<Head<typeof appendedString>, 1>>;
    expect(head(prependedString)).toEqual('foo');
    type _7 = Expect<Equal<Head<typeof prependedString>, 'foo'>>;
    expect(head(appendedString2)).toEqual(1);
    type _8 = Expect<Equal<Head<typeof appendedString2>, 1>>;
    expect(head(prependedString2)).toEqual('bar');
    type _9 = Expect<Equal<Head<typeof prependedString2>, 'bar'>>;
    expect(head(prependedObject).foo).toEqual('bar');
    type _10 = Expect<Equal<Head<typeof prependedObject>, Readonly<{ foo: 'bar' }>>>;
  });

  it('allows to get first element, with providing a default', () => {
    const appendedNumber = append(empty, 1 as const);
    const appendedString = append(appendedNumber, 'foo' as const);
    const prependedString = prepend(appendedNumber, 'foo' as const);
    const appendedString2 = append(appendedString, 'bar' as const);
    const prependedString2 = prepend(prependedString, 'bar' as const);

    type _1 = Expect<Equal<HeadOr<[number, string], boolean>, number>>;
    type _2 = Expect<Equal<HeadOr<[number], boolean>, number>>;
    type _3 = Expect<Equal<HeadOr<[number, 1, 2], boolean>, number>>;
    type _4 = Expect<Equal<HeadOr<[], boolean>, boolean>>;

    expect(headOr(empty, () => null)).toBeNull();
    expect(headOr(appendedNumber, () => null)).toEqual(1);
    type _5 = Expect<Equal<HeadOr<typeof appendedNumber, boolean>, 1>>;
    expect(headOr(appendedString, () => null)).toEqual(1);
    type _6 = Expect<Equal<HeadOr<typeof appendedString, boolean>, 1>>;
    expect(headOr(prependedString, () => null)).toEqual('foo');
    type _7 = Expect<Equal<HeadOr<typeof prependedString, boolean>, 'foo'>>;
    expect(headOr(appendedString2, () => null)).toEqual(1);
    type _8 = Expect<Equal<HeadOr<typeof appendedString2, boolean>, 1>>;
    expect(headOr(prependedString2, () => null)).toEqual('bar');
    type _9 = Expect<Equal<HeadOr<typeof prependedString2, boolean>, 'bar'>>;
  });

  it('properly reverses the list', () => {
    const appendedNumber = append(empty, 1 as const);
    const appendedString = append(appendedNumber, 'foo' as const);
    const prependedString = prepend(appendedNumber, 'foo' as const);
    const appendedString2 = append(appendedString, 'bar' as const);
    const prependedString2 = prepend(prependedString, 'bar' as const);

    type _1 = Expect<Equal<Reverse<[number]>, [number]>>;
    type _2 = Expect<Equal<Reverse<Empty>, Empty>>;
    type _3 = Expect<Equal<Reverse<[number, string]>, [string, number]>>;

    expect(reverse(empty)).toEqual(empty);
    type _4 = Expect<Equal<Reverse<typeof empty>, Empty>>;
    expect(reverse(appendedNumber)).toEqual(appendedNumber);
    type _5 = Expect<Equal<Reverse<typeof appendedNumber>, [1]>>;
    expect(reverse(appendedString)).toEqual(prependedString);
    type _6 = Expect<Equal<Reverse<typeof appendedString>, ['foo', 1]>>;
    expect(reverse(prependedString2)).toEqual(appendedString2);
    type _7 = Expect<Equal<Reverse<typeof prependedString2>, [1, 'foo', 'bar']>>;
  });

  it('properly explodes list into union of its elements', () => {
    type _1 = Expect<Equal<Each<[string, number]>, string | number>>;
    type _2 = Expect<Equal<Each<[number, string]>, string | number>>;
    type _3 = Expect<Equal<Each<[]>, never>>;
    type _4 = Expect<Equal<Each<[string, number, boolean]>, string | number | boolean>>;
  });

  it('properly finds element matching given predicate', () => {
    type WithStringValue = {
      value: string;
    };
    type WithNumberValue = {
      value: number;
    };
    type WithTag<Tag extends string | symbol> = {
      tag: Tag;
    };
    type TestList = [
      WithNumberValue,
      WithNumberValue & WithTag<'foo'>,
      WithStringValue,
      WithStringValue & WithTag<'bar'>,
    ];
    const testList: TestList = [
      { value: 42 },
      { value: 11, tag: 'foo' },
      { value: 'ooo' },
      { value: 'aaa', tag: 'bar' },
    ];
    const unknownValuePredicate = (value: unknown): value is { value: unknown } =>
      typeof value === 'object' && value != null && 'value' in value;
    const stringValuePredicate = (value: unknown): value is { value: string } =>
      unknownValuePredicate(value) && typeof value.value === 'string';
    const stringTagPredicate = (value: unknown): value is { tag: string } =>
      typeof value === 'object' && value != null && 'tag' in value && typeof value.tag === 'string';
    const barTagPredicate = (value: unknown): value is { tag: 'bar' } =>
      stringTagPredicate(value) && value.tag == 'bar';

    type _1 = Expect<Equal<Find<[string, number], string>, string>>;
    type _2 = Expect<Equal<Find<[string, number], number>, number>>;
    type _3 = Expect<Equal<Find<['foo', 'bar', number], string>, 'foo'>>;
    type _4 = Expect<Equal<Find<[number, 'foo', 'bar'], string>, 'foo'>>;
    type _5 = Expect<Equal<Find<TestList, { value: unknown }>, WithNumberValue>>;
    type _6 = Expect<Equal<Find<TestList, { value: string }>, WithStringValue>>;
    type _7 = Expect<Equal<Find<TestList, { tag: string }>, WithNumberValue & WithTag<'foo'>>>;
    type _8 = Expect<Equal<Find<TestList, { tag: 'bar' }>, WithStringValue & WithTag<'bar'>>>;

    const found1 = find(testList, unknownValuePredicate);
    expect(found1).toEqual({ value: 42 });
    type _9 = Expect<Equal<typeof found1, WithNumberValue>>;
    const found2 = find(testList, stringValuePredicate);
    expect(found2).toEqual({ value: 'ooo' });
    type _10 = Expect<Equal<typeof found2, WithStringValue>>;
    const found3 = find(testList, stringTagPredicate);
    expect(found3).toEqual({ value: 11, tag: 'foo' });
    type _11 = Expect<Equal<typeof found3, WithNumberValue & WithTag<'foo'>>>;
    const found4 = find(testList, barTagPredicate);
    expect(found4).toEqual({ value: 'aaa', tag: 'bar' });
    type _12 = Expect<Equal<typeof found4, WithStringValue & WithTag<'bar'>>>;
  });

  describe('folds', () => {
    type NumberVariant = {
      __polyTag__: 'NumberVariant';
      number: number;
    };

    const stringTag: unique symbol = Symbol('StringTag');
    type StringVariant = {
      __polyTag__: typeof stringTag;
      string: string;
    };

    type TestList = [NumberVariant, StringVariant];
    const testList: TestList = [
      { __polyTag__: 'NumberVariant', number: 42 },
      { __polyTag__: stringTag, string: 'foo' },
    ];

    it('left', () => {
      const folded = foldLeft(testList, 'init', (acc) => ({
        NumberVariant: (variant: NumberVariant) => acc + `,number:${variant.number}`,
        [stringTag]: (variant: StringVariant) => acc + `,string:${variant.string}`,
      }));
      type _1 = Expect<Equal<typeof folded, string>>;
      expect(folded).toEqual('init,number:42,string:foo');
    });

    it('right', () => {
      const folded = foldRight(testList, 'init', (acc) => ({
        NumberVariant: (variant: NumberVariant) => acc + `,number:${variant.number}`,
        [stringTag]: (variant: StringVariant) => acc + `,string:${variant.string}`,
      }));
      type _1 = Expect<Equal<typeof folded, string>>;
      expect(folded).toEqual('init,string:foo,number:42');
    });
  });

  it('properly infers tail type', () => {
    type _1 = Expect<Equal<Tail<[]>, []>>;
    type _2 = Expect<Equal<Tail<[string]>, []>>;
    type _3 = Expect<Equal<Tail<[string, number]>, [number]>>;
    type _4 = Expect<Equal<Tail<[string, number, boolean]>, [number, boolean]>>;
  });

  it('properly infers all tails type', () => {
    type _1 = Expect<Equal<Tails<[]>, []>>;
    type _2 = Expect<Equal<Tails<[string]>, []>>;
    type _3 = Expect<Equal<Tails<[string, number]>, [number] | []>>;
    type _4 = Expect<Equal<Tails<[string, number, boolean]>, [number, boolean] | [boolean] | []>>;
  });
});
