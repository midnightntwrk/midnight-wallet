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
import { pipe } from 'effect';
import { Imbalances } from '@midnight-ntwrk/wallet-sdk-capabilities';
import { type TransactionImbalances } from './TransactionImbalances.js';
import type * as ledger from '@midnight-ntwrk/ledger-v7';

export type TransactionOps<Tx> = {
  getImbalances(tx: Tx): TransactionImbalances;
  id(tx: Tx): string;
};
export const TransactionOps = new (class {
  default: TransactionOps<ledger.FinalizedTransaction> = {
    getImbalances(tx: ledger.FinalizedTransaction): TransactionImbalances {
      return TransactionOps.shared.getImbalances(tx);
    },
    id(tx) {
      return tx.identifiers().at(0)!;
    },
  };
  proofErased: TransactionOps<ledger.ProofErasedTransaction> = {
    getImbalances(tx): TransactionImbalances {
      return TransactionOps.shared.getImbalances(tx);
    },
    id(tx) {
      return tx.identifiers().at(0)!;
    },
  };
  unproven: TransactionOps<ledger.UnprovenTransaction> = {
    getImbalances(tx: ledger.UnprovenTransaction): TransactionImbalances {
      return TransactionOps.shared.getImbalances(tx);
    },
    id(tx) {
      return tx.identifiers().at(0)!;
    },
  };

  shared = {
    getImbalances(
      tx: ledger.FinalizedTransaction | ledger.UnprovenTransaction | ledger.ProofErasedTransaction,
    ): TransactionImbalances {
      const guaranteedImbalances = TransactionOps.shared.getGuaranteedImbalances(tx);
      const fallibleImbalances = TransactionOps.shared.getFallibleImbalances(tx);

      return pipe({
        guaranteed: guaranteedImbalances,
        fallible: fallibleImbalances,
        fees: 0n,
      });
    },
    getGuaranteedImbalances: (
      tx: ledger.FinalizedTransaction | ledger.UnprovenTransaction | ledger.ProofErasedTransaction,
    ): Imbalances => {
      const rawGuaranteedImbalances = tx
        .imbalances(0)
        .entries()
        .filter(([token]) => token.tag === 'shielded')
        .map(([token, value]) => {
          return [(token as { tag: 'shielded'; raw: string }).raw.toString(), value] as [string, bigint];
        });

      return Imbalances.fromEntries(rawGuaranteedImbalances);
    },
    getFallibleImbalances: (
      tx: ledger.FinalizedTransaction | ledger.UnprovenTransaction | ledger.ProofErasedTransaction,
    ): Imbalances => {
      try {
        const rawFallibleImbalances = tx
          .imbalances(1)
          .entries()
          .filter(([token]) => token.tag === 'shielded')
          .map(([token, value]) => {
            return [(token as { tag: 'shielded'; raw: string }).raw.toString(), value] as [string, bigint];
          });
        return Imbalances.fromEntries(rawFallibleImbalances);
      } catch {
        return Imbalances.empty();
      }
    },
  };
})();
