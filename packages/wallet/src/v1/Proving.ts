import { HttpProverClient, ProverClient } from '@midnight-ntwrk/wallet-sdk-prover-client/effect';
import * as ledger from '@midnight-ntwrk/ledger-v6';
import { Effect, pipe } from 'effect';
import { ProvingRecipe } from './ProvingRecipe';
import { ProvingError, WalletError } from './WalletError';

export interface ProvingService<TTransaction> {
  prove(recipe: ProvingRecipe<TTransaction>): Effect.Effect<TTransaction, WalletError>;
}

export type DefaultProvingConfiguration = {
  provingServerUrl: URL;
};

export const makeDefaultProvingService = (
  configuration: DefaultProvingConfiguration,
): ProvingService<ledger.FinalizedTransaction> => {
  const clientLayer = HttpProverClient.layer({
    url: configuration.provingServerUrl,
  });

  return {
    prove(recipe: ProvingRecipe<ledger.FinalizedTransaction>): Effect.Effect<ledger.FinalizedTransaction, WalletError> {
      switch (recipe.type) {
        case 'BalanceTransactionToProve':
          return pipe(
            ProverClient.ProverClient,
            Effect.flatMap((client) =>
              client.proveTransaction(recipe.transactionToProve, ledger.CostModel.initialCostModel()),
            ),
            Effect.map((provenTx) => recipe.transactionToBalance.merge(provenTx.bind())),
            Effect.provide(clientLayer),
            Effect.catchAll((error) =>
              Effect.fail(
                new ProvingError({
                  message: error.message,
                  cause: error,
                }),
              ),
            ),
          );
        case 'TransactionToProve':
          return pipe(
            ProverClient.ProverClient,
            Effect.flatMap((client) =>
              client.proveTransaction(recipe.transaction, ledger.CostModel.initialCostModel()),
            ),
            Effect.map((proven) => proven.bind()),
            Effect.provide(clientLayer),
            Effect.catchAll((error) =>
              Effect.fail(
                new ProvingError({
                  message: error.message,
                  cause: error,
                }),
              ),
            ),
          );
        case 'NothingToProve':
          return Effect.succeed(recipe.transaction);
      }
    },
  };
};

export const makeSimulatorProvingService = (): ProvingService<ledger.ProofErasedTransaction> => {
  return {
    prove(
      recipe: ProvingRecipe<ledger.ProofErasedTransaction>,
    ): Effect.Effect<ledger.ProofErasedTransaction, WalletError> {
      switch (recipe.type) {
        case 'BalanceTransactionToProve':
          return pipe(
            Effect.succeed(recipe.transactionToProve.eraseProofs()),
            Effect.map((proven) => recipe.transactionToBalance.merge(proven)),
          );
        case 'TransactionToProve':
          return Effect.succeed(recipe.transaction.eraseProofs());
        case 'NothingToProve':
          return Effect.succeed(recipe.transaction);
      }
    },
  };
};
