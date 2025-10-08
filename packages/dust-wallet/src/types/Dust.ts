import { DustInitialNonce, DustNullifier, DustNonce, DustPublicKey, Utxo, UtxoMeta } from '@midnight-ntwrk/ledger-v6';

export type DustToken = {
  initialValue: bigint;
  owner: DustPublicKey;
  nonce: DustNonce;
  seq: number;
  ctime: Date;
  backingNight: DustInitialNonce;
  mtIndex: bigint;
};

export type DustTokenWithNullifier = DustToken & {
  nullifier: DustNullifier;
};

export type DustTokenFullInfo = {
  token: DustToken;
  dtime: Date | undefined;
  maxCap: bigint; // maximum capacity (gen.value * night_dust_ratio)
  maxCapReachedAt: Date; // ctime + timeToCapSeconds
  generatedNow: bigint;
  rate: bigint; // the slope of generation and decay for a specific dust UTXO (gen.value * generation_decay_rate)
};

export type DustGenerationInfo = {
  value: bigint;
  owner: DustPublicKey;
  nonce: DustInitialNonce;
  dtime: Date | undefined;
};

export type UtxoWithMeta = {
  utxo: Utxo;
  meta: UtxoMeta;
};
