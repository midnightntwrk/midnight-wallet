export type ValuesOf<T> = T[keyof T];

export type StateUpdate<T> = (s: T) => T;

export type RecursivePartial<T> = T extends {}
  ? {
      [K in keyof T]?: RecursivePartial<T[K]>;
    }
  : T;
