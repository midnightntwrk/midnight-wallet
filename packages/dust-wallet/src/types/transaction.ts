import { LedgerParameters } from '@midnight-ntwrk/ledger-v6';

export type TotalCostParameters = {
  ledgerParams: LedgerParameters;
  additionalFeeOverhead: bigint;
};
