import { HDKey } from '@scure/bip32';

type ValueOf<T> = T[keyof T];

export const Roles = {
  NightExternal: 0,
  NightInternal: 1,
  Dust: 2,
  Zswap: 3,
  Metadata: 4,
} as const;

export type Role = ValueOf<typeof Roles>;

type DerivationResult = { type: 'keyDerived'; key: Uint8Array } | { type: 'keyOutOfBounds' };
type HDWalletResult = { type: 'seedOk'; hdWallet: HDWallet } | { type: 'seedError'; error: unknown };

const PURPOSE = 44;
const COIN_TYPE = 2400;

export class HDWallet {
  private readonly rootKey: HDKey;

  private constructor(key: HDKey) {
    this.rootKey = key;
  }

  static fromSeed(seed: Uint8Array): HDWalletResult {
    try {
      const rootKey = HDKey.fromMasterSeed(seed);
      return { type: 'seedOk', hdWallet: new HDWallet(rootKey) };
    } catch (e: unknown) {
      return { type: 'seedError', error: e };
    }
  }

  // Begin by selecting an account.
  public selectAccount(account: number): AccountKey {
    return new AccountKey(this.rootKey, account);
  }
}

export class AccountKey {
  private rootKey: HDKey;
  private account: number;

  constructor(rootKey: HDKey, account: number) {
    this.account = account;
    this.rootKey = rootKey;
  }

  // After account, select a role.
  public selectRole(role: Role): RoleKey {
    return new RoleKey(this.rootKey, this.account, role);
  }
}

export class RoleKey {
  private rootKey: HDKey;
  private account: number;
  private role: Role;

  constructor(rootKey: HDKey, account: number, role: Role) {
    this.role = role;
    this.account = account;
    this.rootKey = rootKey;
  }

  // Finally, derive the key at the given index.
  public deriveKeyAt(index: number): DerivationResult {
    const path = `m/${PURPOSE}'/${COIN_TYPE}'/${this.account}'/${this.role}/${index}`;
    const derivedKey = this.rootKey.derive(path);
    return derivedKey.privateKey ? { type: 'keyDerived', key: derivedKey.privateKey } : { type: 'keyOutOfBounds' };
  }
}
