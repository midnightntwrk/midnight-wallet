// A translation that refuses the state it was given.
export const translate_ledger_state = () => {
  throw new Error('state is not translatable');
};
