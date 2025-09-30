/**
 * A utility type that checks whether type A can be assigned to type To
 * It appears to be useful when exact inferred type are slightly too complex to express and we want the express
 * a slightly simplified type rule like Expect<CanAssign<{foo: number}, object & {foo: number}>>
 */
export type CanAssign<A, To> = A extends To ? true : false;

/**
 * A utility type that ensures that a given type is `true` or otherwise forces a compile time error.
 */
export type Expect<T extends true> = T;

export type ItemType<T> = T extends ReadonlyArray<infer R> ? R : never;

/**
 * A utility type that exactly compares two types for equality.
 */
export type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
