// The same, under the camelCase spelling the ledger side may choose instead.
export const translateLedgerState = (preForkLedger) => new Uint8Array(Array.from(preForkLedger).reverse());
