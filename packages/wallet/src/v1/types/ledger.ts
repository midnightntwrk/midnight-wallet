import * as ledger from '@midnight-ntwrk/ledger';

export type UnprovenTransaction = ledger.Transaction<ledger.SignatureEnabled, ledger.PreProof, ledger.PreBinding>;
export type FinalizedTransaction = ledger.Transaction<ledger.SignatureEnabled, ledger.Proof, ledger.Bindingish>;

// @TODO: figure out if ledger.Signaturish is the right type
export type ProofErasedTransaction = ledger.Transaction<ledger.Signaturish, ledger.NoProof, ledger.NoBinding>;

export const shieldedToken = (): { raw: string; tag: 'shielded' } =>
  ledger.shieldedToken() as { raw: string; tag: 'shielded' };
