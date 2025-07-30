import * as zswap from '@midnight-ntwrk/zswap';
import { Array as Arr, Option, pipe } from 'effect';
import { Imbalances } from '@midnight-ntwrk/wallet-sdk-capabilities';
import { TotalCostParameters, TransactionImbalances } from './TransactionImbalances';

export type TransactionTrait<Tx> = {
  getImbalancesWithFeesOverhead(tx: Tx, costParams: TotalCostParameters): TransactionImbalances;
  /**
   * A subject-reversed function, allows to implement reversal once in the capability itself
   */
  getRevertedFromLocalState(tx: Tx, state: zswap.LocalState): zswap.LocalState;

  id(tx: Tx): string;
};
export const TransactionTrait = new (class {
  default: TransactionTrait<zswap.Transaction> = {
    getImbalancesWithFeesOverhead(tx: zswap.Transaction, costParams): TransactionImbalances {
      return TransactionTrait.shared.getImbalancesWithFeesOverhead(tx, costParams);
    },
    getRevertedFromLocalState(tx: zswap.Transaction, state: zswap.LocalState): zswap.LocalState {
      //This might seem as an overcomplicated, but:
      // - reduces amount of handling "what-if-not" cases
      // - handles each concern exactly once (applying failed offer, handling possible non-existence of offer in tx)
      return pipe(
        [Option.fromNullable(tx.guaranteedCoins), Option.fromNullable(tx.fallibleCoins)],
        Arr.flatMap((maybeOffer) => Option.toArray(maybeOffer)),
        Arr.reduce(state, (previousState, offer) => previousState.applyFailed(offer)),
      );
    },
    id(tx) {
      return tx.identifiers().at(0)!;
    },
  };
  proofErased: TransactionTrait<zswap.ProofErasedTransaction> = {
    getImbalancesWithFeesOverhead(tx, costParams): TransactionImbalances {
      return TransactionTrait.shared.getImbalancesWithFeesOverhead(tx, costParams);
    },
    getRevertedFromLocalState(tx: zswap.ProofErasedTransaction, state: zswap.LocalState): zswap.LocalState {
      return pipe(
        [Option.fromNullable(tx.guaranteedCoins), Option.fromNullable(tx.fallibleCoins)],
        Arr.flatMap((maybeOffer) => Option.toArray(maybeOffer)),
        Arr.reduce(state, (previousState, offer) => previousState.applyFailedProofErased(offer)),
      );
    },
    id(tx) {
      return tx.identifiers().at(0)!;
    },
  };
  unproven: TransactionTrait<zswap.UnprovenTransaction> = {
    getImbalancesWithFeesOverhead(
      tx: zswap.UnprovenTransaction,
      costParams: TotalCostParameters,
    ): TransactionImbalances {
      const guaranteedImbalances = Imbalances.fromMaybeMap(tx.guaranteedCoins?.deltas);
      const fallibleImbalaces = Imbalances.fromMaybeMap(tx.fallibleCoins?.deltas);
      const feesEstimation = (() => {
        const totalNumberOfInputs = (tx.guaranteedCoins?.inputs.length ?? 0) + (tx.fallibleCoins?.inputs.length ?? 0);
        const totalNumberOfOutputs =
          (tx.guaranteedCoins?.outputs.length ?? 0) + (tx.fallibleCoins?.outputs.length ?? 0);

        return TransactionTrait.shared.estimateFeeOverhead({
          numberOfInputs: totalNumberOfInputs,
          numberOfOutputs: totalNumberOfOutputs,
          costParams,
        });
      })();

      return pipe(
        {
          guaranteed: guaranteedImbalances,
          fallible: fallibleImbalaces,
          fees: 0n,
        },
        TransactionImbalances.addFeesOverhead(feesEstimation),
      );
    },
    getRevertedFromLocalState(tx: zswap.UnprovenTransaction, state: zswap.LocalState): zswap.LocalState {
      return TransactionTrait.proofErased.getRevertedFromLocalState(tx.eraseProofs(), state);
    },
    id(tx) {
      return tx.identifiers().at(0)!;
    },
  };

  shared = {
    getImbalancesWithFeesOverhead(
      tx: zswap.Transaction | zswap.ProofErasedTransaction,
      costParams: TotalCostParameters,
    ): TransactionImbalances {
      const guaranteedImbalances = Imbalances.fromMap(tx.imbalances(true));
      const fallibleImbalances = Imbalances.fromMap(tx.imbalances(false));
      const feesNeeded = tx.fees(costParams.ledgerParams);
      return pipe(
        {
          guaranteed: guaranteedImbalances,
          fallible: fallibleImbalances,
          fees: feesNeeded,
        },
        TransactionImbalances.addFeesOverhead(feesNeeded),
      );
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
