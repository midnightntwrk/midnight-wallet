import * as ledger from '@midnight-ntwrk/ledger-v6';
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';

/**
 * Temporary function until the ledger fixes imbalances.get()
 *
 * @param imbalances
 * @param rawTokenType
 * @returns bigint
 */
export const getNonDustImbalance = (
  imbalances: Map<ledger.TokenType, bigint>,
  rawTokenType: ledger.RawTokenType,
): bigint => {
  const [, value] = Array.from(imbalances.entries()).find(([t, value]) =>
    t.tag !== 'dust' && t.raw == rawTokenType ? value : undefined,
  ) ?? [undefined, BigInt(0)];

  return value;
};

export const getShieldedSeed = (seed: string): Uint8Array => {
  const seedBuffer = Buffer.from(seed, 'hex');
  const hdWalletResult = HDWallet.fromSeed(seedBuffer);

  const { hdWallet } = hdWalletResult as {
    type: 'seedOk';
    hdWallet: HDWallet;
  };

  const derivationResult = hdWallet.selectAccount(0).selectRole(Roles.Zswap).deriveKeyAt(0);

  if (derivationResult.type === 'keyOutOfBounds') {
    throw new Error('Key derivation out of bounds');
  }

  return Buffer.from(derivationResult.key);
};
