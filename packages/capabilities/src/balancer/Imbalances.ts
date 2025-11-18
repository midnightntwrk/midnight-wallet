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
export type TokenType = string;
export type TokenValue = bigint;

export interface CoinRecipe {
  type: TokenType;
  value: TokenValue;
}

export type Imbalance = [TokenType, TokenValue];

export type Imbalances = Map<TokenType, TokenValue>;
export const Imbalances = new (class {
  empty = (): Imbalances => {
    return new Map();
  };
  fromEntry = (tokenType: TokenType, value: bigint): Imbalances => {
    return new Map([[tokenType, value]]);
  };
  fromEntries = (entries: Iterable<readonly [TokenType, bigint]>): Imbalances => {
    const out = new Map<string, bigint>();
    for (const [tokenType, value] of entries) {
      const existingValue = this.getValue(out, tokenType);
      out.set(tokenType, value + existingValue);
    }
    return out;
  };
  fromMap = (map: Map<TokenType, bigint>): Imbalances => {
    return this.fromEntries(map.entries());
  };
  fromMaybeMap = (map: Map<TokenType, bigint> | undefined): Imbalances => {
    return this.fromMap(map ?? new Map<TokenType, bigint>());
  };
  getValue = (map: Imbalances, tokenType: TokenType): bigint => {
    return map.get(tokenType) ?? 0n;
  };
  typeSet = (map: Imbalances): Set<TokenType> => {
    return new Set(map.keys());
  };

  ensureZerosFor(map: Imbalances, types: Iterable<TokenType>): Imbalances {
    const out = this.fromEntries(map.entries());
    for (const tokenType of types) {
      const existingValue = this.getValue(out, tokenType);
      out.set(tokenType, existingValue);
    }
    return out;
  }

  merge = (a: Imbalances, b: Imbalances): Imbalances => {
    const allTokenTypes = this.typeSet(a).union(this.typeSet(b));

    return this.fromEntries(
      allTokenTypes
        .values()
        .map((tokenType) => {
          const aValue = this.getValue(a, tokenType);
          const bValue = this.getValue(b, tokenType);
          return [tokenType, aValue + bValue] as const;
        })
        .filter(([, value]) => value !== 0n)
        .toArray(),
    );
  };
})();
