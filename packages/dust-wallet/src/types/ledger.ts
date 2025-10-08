import * as ledger from '@midnight-ntwrk/ledger-v6';

export type AnyTransaction = ledger.UnprovenTransaction | ledger.FinalizedTransaction | ledger.ProofErasedTransaction;
export type UnprovenDustSpend = ledger.DustSpend<ledger.PreProof>;

export type NetworkId = string;
