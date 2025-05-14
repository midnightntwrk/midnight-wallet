/**
 * Builds a target object from internal build state.
 *
 * @typeParam TBuildTarget The type of object to build.
 */
export interface Builder<TBuildTarget> {
  /**
   * Builds the target object from the internal build state.
   *
   * @returns An instance of `TBuildTarget`.
   */
  build(...args: unknown[]): TBuildTarget;
}

/**
 * Builds a target object from internal build state, applying some given configuration.
 *
 * @typeParam TConfiguration A type representing the configuration to supply during the build.
 * @typeParam TBuildTarget The type of object to build.
 */
export interface ConfigurableBuilder<TConfiguration, TBuildTarget> {
  /**
   * Builds the target object from the internal build state, applying some given configuration.
   *
   * @param configuration The configuration to apply.
   *
   * @returns An instance of `TBuildTarget`.
   */
  build(configuration: TConfiguration, ...args: unknown[]): TBuildTarget;
}
