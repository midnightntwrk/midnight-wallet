/**
 * A utility type that ensures that a given type is `true` or otherwise forces a compile time error.
 *
 * @internal
 */
export type Expect<T extends true> = T;

export type ItemType<T> = T extends ReadonlyArray<infer R> ? R : never;
