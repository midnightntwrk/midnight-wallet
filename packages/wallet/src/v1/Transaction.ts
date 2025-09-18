import { pipe } from 'effect';
import { Imbalances } from '@midnight-ntwrk/wallet-sdk-capabilities';
import { TotalCostParameters, TransactionImbalances } from './TransactionImbalances';
import * as ledger from '@midnight-ntwrk/ledger';

export type UnprovenTransaction = ledger.Transaction<ledger.SignatureEnabled, ledger.PreProof, ledger.PreBinding>;
// TODO: It cannot stay with PreBinding, it needs to be Binding; to be fixed with upgrade to Ledger v6
export type FinalizedTransaction = ledger.Transaction<ledger.SignatureEnabled, ledger.Proof, ledger.PreBinding>;
// @TODO: figure out if ledger.Signaturish is the right type
export type ProofErasedTransaction = ledger.Transaction<ledger.Signaturish, ledger.NoProof, ledger.NoBinding>;

export type TransactionTrait<Tx> = {
  getImbalancesWithFeesOverhead(tx: Tx, costParams: TotalCostParameters): TransactionImbalances;
  id(tx: Tx): string;
};
export const TransactionTrait = new (class {
  default: TransactionTrait<FinalizedTransaction> = {
    getImbalancesWithFeesOverhead(tx: FinalizedTransaction, costParams): TransactionImbalances {
      return TransactionTrait.shared.getImbalancesWithFeesOverhead(tx, costParams);
    },
    id(tx) {
      return tx.identifiers().at(0)!;
    },
  };
  proofErased: TransactionTrait<ProofErasedTransaction> = {
    getImbalancesWithFeesOverhead(tx, costParams): TransactionImbalances {
      return TransactionTrait.shared.getImbalancesWithFeesOverhead(tx, costParams);
    },
    id(tx) {
      return tx.identifiers().at(0)!;
    },
  };
  unproven: TransactionTrait<UnprovenTransaction> = {
    getImbalancesWithFeesOverhead(tx: UnprovenTransaction, costParams: TotalCostParameters): TransactionImbalances {
      return TransactionTrait.shared.getImbalancesWithFeesOverhead(tx, costParams);
    },
    id(tx) {
      return tx.identifiers().at(0)!;
    },
  };

  shared = {
    getImbalancesWithFeesOverhead(
      tx: FinalizedTransaction | UnprovenTransaction | ProofErasedTransaction,
      costParams: TotalCostParameters,
    ): TransactionImbalances {
      const feesNeeded = tx.fees(costParams.ledgerParams);

      const guaranteedImbalances = TransactionTrait.shared.getGuaranteedImbalances(tx, feesNeeded);
      const fallibleImbalances = TransactionTrait.shared.getFallibleImbalances(tx);

      return pipe(
        {
          guaranteed: guaranteedImbalances,
          fallible: fallibleImbalances,
          fees: feesNeeded,
        },
        TransactionImbalances.addFeesOverhead(feesNeeded),
      );
    },
    getGuaranteedImbalances: (
      tx: FinalizedTransaction | UnprovenTransaction | ProofErasedTransaction,
      feesNeeded: bigint,
    ): Imbalances => {
      const rawGuaranteedImbalances = tx
        .imbalances(0, feesNeeded)
        .entries()
        .filter(([token]) => token.tag === 'shielded')
        .map(([token, value]) => {
          return [(token as { tag: 'shielded'; raw: string }).raw.toString(), value] as [string, bigint];
        });

      return Imbalances.fromEntries(rawGuaranteedImbalances);
    },
    getFallibleImbalances: (tx: FinalizedTransaction | UnprovenTransaction | ProofErasedTransaction): Imbalances => {
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
    estimateFeeOverhead(params: {
      numberOfInputs: number;
      numberOfOutputs: number;
      costParams: TotalCostParameters;
    }): bigint {
      return (
        BigInt(params.numberOfInputs) * params.costParams.ledgerParams.transactionCostModel.inputFeeOverhead +
        BigInt(params.numberOfOutputs) * params.costParams.ledgerParams.transactionCostModel.outputFeeOverhead +
        BigInt(params.numberOfInputs + params.numberOfOutputs) * params.costParams.additionalFeeOverhead
      );
    },
  };
})();
