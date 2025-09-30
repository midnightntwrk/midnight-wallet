export declare namespace Fluent {
  /**
   * Exclude named methods from `T` so that they are no longer callable.
   */
  type ExcludeMethod<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;
}
