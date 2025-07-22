/**
 * A utility type that ensures that a given type is `true` or otherwise forces a compile time error.
 */
export type Expect<T extends true> = T;

/**
 * A utility type that exactly compares two types for equality.
 */
export type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;

export type ItemType<T> = T extends ReadonlyArray<infer R> ? R : never;
