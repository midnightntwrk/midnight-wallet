export type WithTag<T extends string | symbol> = {
  __polyTag__: T;
};
export type TagOf<T> = T extends WithTag<infer Tag> ? Tag : never;

export type WithTagFrom<T> = WithTag<TagOf<T>>;
/**
 * Polymorphic function - function defined for multiple types at once
 * Leveraging tagging mechanics it can predictably work at runtime and be quite intuitively defined by hand
 */
export type PolyFunction<Variants extends WithTag<string | symbol>, T> = {
  [V in Variants as TagOf<V>]: (variant: V) => T;
};

export const getTag = <TTag extends string | symbol>(t: WithTag<TTag>): TTag => t.__polyTag__;

export const dispatch = <TVariant extends WithTag<string | symbol>, TResult>(
  subject: TVariant,
  impl: PolyFunction<TVariant, TResult>,
): TResult => {
  if (subject.__polyTag__ in impl) {
    //Sadly, the type casts below are needed because eslint or TS limitations
    const subjectTag = subject.__polyTag__ as TagOf<TVariant>;
    const chosen = impl[subjectTag] as (v: TVariant) => TResult;
    return chosen(subject);
  } else {
    throw new Error(`Not found implementation for ${String(subject.__polyTag__)}`);
  }
};
