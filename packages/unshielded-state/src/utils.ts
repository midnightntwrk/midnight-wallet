export const safeParseJson = (serialized: string): unknown =>
  JSON.parse(serialized, (key, value) =>
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    key === 'value' && typeof value === 'string' ? BigInt(value) : value,
  ) as unknown;

export const safeStringifyJson = (jsonObject: object): string =>
  JSON.stringify(jsonObject, (_, v) =>
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    typeof v === 'bigint' ? v.toString() : v,
  );
