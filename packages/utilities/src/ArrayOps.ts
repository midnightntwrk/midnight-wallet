import { NonEmptyReadonlyArray, reduce, match } from 'effect/Array';
import { dual } from 'effect/Function';

export const fold: {
  <T>(folder: (acc: T, item: T) => T): (arr: NonEmptyReadonlyArray<T>) => T;
  <T>(arr: NonEmptyReadonlyArray<T>, folder: (acc: T, item: T) => T): T;
} = dual(2, <T>(arr: NonEmptyReadonlyArray<T>, folder: (acc: T, item: T) => T): T => arr.reduce(folder));

export type Monoid<T> = {
  empty: T;
  combine: (a: T, b: T) => T;
};

export const generalSum: {
  <T>(monoid: Monoid<T>): (arr: ReadonlyArray<T>) => T;
  <T>(arr: ReadonlyArray<T>, monoid: Monoid<T>): T;
} = dual(2, <T>(arr: ReadonlyArray<T>, monoid: Monoid<T>): T => reduce(arr, monoid.empty, monoid.combine));

const numberAdditionMonoid: Monoid<number> = {
  empty: 0,
  combine: (a, b) => a + b,
};

const bigintAdditionMonoid: Monoid<bigint> = {
  empty: 0n,
  combine: (a, b) => a + b,
};

export const sumNumber: (arr: ReadonlyArray<number>) => number = generalSum(numberAdditionMonoid);

export const sumBigInt: (arr: ReadonlyArray<bigint>) => bigint = generalSum(bigintAdditionMonoid);

export const assertNonEmpty = <T>(arr: ReadonlyArray<T>): NonEmptyReadonlyArray<T> => {
  return match(arr, {
    onNonEmpty: (refined) => refined,
    onEmpty: () => {
      throw new Error('Expected non-empty array');
    },
  });
};
