export const merge =
  <K extends string | number | symbol, T>(combine: (a: T, b: T) => T) =>
  (records: Array<Record<K, T>>): Record<K, T> => {
    const result: Record<K, T> = {} as Record<K, T>;
    for (const record of records) {
      for (const key in record) {
        if (Object.hasOwn(result, key)) {
          result[key] = combine(result[key], record[key]);
        } else {
          result[key] = record[key];
        }
      }
    }
    return result;
  };

export const mergeWithAccumulator =
  <K extends string | number | symbol, T, S>(mempty: S, combine: (acc: S, b: T) => S) =>
  (records: Array<Record<K, T>>): Record<K, S> => {
    const result: Record<K, S> = {} as Record<K, S>;
    for (const record of records) {
      for (const key in record) {
        if (Object.hasOwn(result, key)) {
          result[key] = combine(result[key], record[key]);
        } else {
          result[key] = combine(mempty, record[key]);
        }
      }
    }
    return result;
  };
