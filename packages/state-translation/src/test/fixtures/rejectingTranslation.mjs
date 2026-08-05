// A translation that fails asynchronously.
export const translate_ledger_state = () => Promise.reject(new Error('translation loop gave up'));
