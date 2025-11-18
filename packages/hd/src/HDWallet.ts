// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) 2025 Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
// http://www.apache.org/licenses/LICENSE-2.0
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
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

type DerivationResult = { readonly type: 'keyDerived'; readonly key: Uint8Array } | { readonly type: 'keyOutOfBounds' };
type CompositeDerivationResult<T extends readonly Role[]> =
  | { readonly type: 'keysDerived'; readonly keys: Record<T[number], Uint8Array> }
  | { readonly type: 'keyOutOfBounds'; readonly roles: readonly Role[] };
type HDWalletResult =
  | { readonly type: 'seedOk'; readonly hdWallet: HDWallet }
  | { readonly type: 'seedError'; readonly error: unknown };

const PURPOSE = 44;
const COIN_TYPE = 2400;

const CompositeDerivationResult = {
  fromResults: <T extends readonly Role[]>(
    results: { role: T[number]; result: DerivationResult }[],
  ): CompositeDerivationResult<T> => {
    const { succeededKeys, failedRoles } = results.reduce(
      (acc, result) => {
        if (result.result.type === 'keyDerived') {
          acc.succeededKeys[result.role] = result.result.key!;
        } else {
          acc.failedRoles.push(result.role);
        }
        return acc;
      },
      { succeededKeys: {} as Record<T[number], Uint8Array>, failedRoles: [] as Role[] },
    );

    if (failedRoles.length > 0) {
      return { type: 'keyOutOfBounds', roles: failedRoles };
    } else {
      return { type: 'keysDerived', keys: succeededKeys };
    }
  },
};

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

  /**
   * Once all keys are derived - clear internals from private data, so that they do not reside in memory longer than needed.
   */
  public clear(): void {
    this.rootKey.wipePrivateData();
  }
}

export class AccountKey {
  private readonly rootKey: HDKey;
  private readonly account: number;

  constructor(rootKey: HDKey, account: number) {
    this.account = account;
    this.rootKey = rootKey;
  }

  // After account, select a role.
  public selectRole(role: Role): RoleKey {
    return new RoleKey(this.rootKey, this.account, role);
  }

  public selectRoles<T extends readonly Role[]>(roles: T): CompositeRoleKey<T> {
    return new CompositeRoleKey<T>(this.rootKey, this.account, roles);
  }
}

export class RoleKey {
  private readonly rootKey: HDKey;
  private readonly account: number;
  private readonly role: Role;

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

export class CompositeRoleKey<T extends readonly Role[]> {
  private readonly rootKey: HDKey;
  private readonly account: number;
  private readonly roles: T;

  constructor(rootKey: HDKey, account: number, roles: T) {
    this.roles = roles;
    this.rootKey = rootKey;
    this.account = account;
  }

  public deriveKeysAt(index: number): CompositeDerivationResult<T> {
    const results = this.roles.map((role) => ({
      role,
      result: new RoleKey(this.rootKey, this.account, role).deriveKeyAt(index),
    }));

    return CompositeDerivationResult.fromResults<T>(results);
  }
}
