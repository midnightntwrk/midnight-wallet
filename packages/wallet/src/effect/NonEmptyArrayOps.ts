import { NonEmptyArray } from 'effect/Array';
import { dual } from 'effect/Function';

export const fold: {
  <T>(folder: (acc: T, item: T) => T): (arr: NonEmptyArray<T>) => T;
  <T>(arr: NonEmptyArray<T>, folder: (acc: T, item: T) => T): T;
} = dual(2, <T>(arr: NonEmptyArray<T>, folder: (acc: T, item: T) => T): T => arr.reduce(folder));
