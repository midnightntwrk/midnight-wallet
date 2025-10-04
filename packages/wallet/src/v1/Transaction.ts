import { pipe } from 'effect';
import { Imbalances } from '@midnight-ntwrk/wallet-sdk-capabilities';
import { TransactionImbalances } from './TransactionImbalances';
import * as ledger from '@midnight-ntwrk/ledger-v6';

export type TransactionTrait<Tx> = {
  getImbalances(tx: Tx): TransactionImbalances;
  id(tx: Tx): string;
};
export const TransactionTrait = new (class {
  default: TransactionTrait<ledger.FinalizedTransaction> = {
    getImbalances(tx: ledger.FinalizedTransaction): TransactionImbalances {
      return TransactionTrait.shared.getImbalances(tx);
    },
    id(tx) {
      return tx.identifiers().at(0)!;
    },
  };
  proofErased: TransactionTrait<ledger.ProofErasedTransaction> = {
    getImbalances(tx): TransactionImbalances {
      return TransactionTrait.shared.getImbalances(tx);
    },
    id(tx) {
      return tx.identifiers().at(0)!;
    },
  };
  unproven: TransactionTrait<ledger.UnprovenTransaction> = {
    getImbalances(tx: ledger.UnprovenTransaction): TransactionImbalances {
      return TransactionTrait.shared.getImbalances(tx);
    },
    id(tx) {
      return tx.identifiers().at(0)!;
    },
  };

  shared = {
    getImbalances(
      tx: ledger.FinalizedTransaction | ledger.UnprovenTransaction | ledger.ProofErasedTransaction,
    ): TransactionImbalances {
      const guaranteedImbalances = TransactionTrait.shared.getGuaranteedImbalances(tx);
      const fallibleImbalances = TransactionTrait.shared.getFallibleImbalances(tx);

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
