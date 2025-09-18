import * as ledger from '@midnight-ntwrk/ledger';

export const shieldedToken = (): { raw: string; tag: 'shielded' } =>
  ledger.shieldedToken() as { raw: string; tag: 'shielded' };
