// A translation that completes asynchronously, as it would if driving its incremental loop had to yield.
export const translate_ledger_state = async (preForkLedger) =>
  new Uint8Array(Array.from(await Promise.resolve(preForkLedger)).reverse());
