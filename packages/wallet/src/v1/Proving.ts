import { HttpProverClient, ProverClient } from '@midnight-ntwrk/wallet-sdk-prover-client/effect';
import { InvalidProtocolSchemeError, SerializedUnprovenTransaction } from '@midnight-ntwrk/wallet-sdk-abstractions';
import * as ledger from '@midnight-ntwrk/ledger';
import { Effect, pipe } from 'effect';
import { ProvingRecipe } from './ProvingRecipe';
import { ProvingError, WalletError } from './WalletError';
import { UnprovenTransaction, ProofErasedTransaction, FinalizedTransaction } from './Transaction';

export interface ProvingService<TTransaction> {
  prove(recipe: ProvingRecipe<TTransaction>): Effect.Effect<TTransaction, WalletError>;
}

export type DefaultProvingConfiguration = {
  provingServerUrl: URL;
  networkId: ledger.NetworkId;
};

export const httpProveTx = (
  networkId: ledger.NetworkId,
  unproven: UnprovenTransaction,
): Effect.Effect<FinalizedTransaction, WalletError, ProverClient.ProverClient> => {
  return Effect.gen(function* () {
    const client = yield* ProverClient.ProverClient;
    const unprovenSerialized = SerializedUnprovenTransaction(unproven.serialize(networkId));
    const provenSerialized = yield* client.proveTransaction(unprovenSerialized);
    return ledger.Transaction.deserialize<ledger.SignatureEnabled, ledger.Proof, ledger.PreBinding>(
      'signature',
      'proof',
      'pre-binding',
      provenSerialized,
      networkId,
    );
  }).pipe(Effect.mapError((err) => WalletError.proving(err)));
};

export const makeDefaultProvingService = (
  configuration: DefaultProvingConfiguration,
): ProvingService<FinalizedTransaction> => {
  const clientLayer = HttpProverClient.layer({
    url: configuration.provingServerUrl,
  });

  return {
    prove(recipe: ProvingRecipe<FinalizedTransaction>): Effect.Effect<FinalizedTransaction, WalletError> {
      switch (recipe.type) {
        case 'BalanceTransactionToProve':
          return pipe(
            httpProveTx(configuration.networkId, recipe.transactionToProve),
            Effect.map((proven) => recipe.transactionToBalance.merge(proven)),
            Effect.provide(clientLayer),
            Effect.catchTag(InvalidProtocolSchemeError.tag, (invalidProtocolScheme) => {
              return Effect.fail(
                new ProvingError({
                  message: 'Invalid proving client configuration',
                  cause: invalidProtocolScheme,
                }),
              );
            }),
          );
        case 'TransactionToProve':
          return pipe(
            httpProveTx(configuration.networkId, recipe.transaction),
            Effect.provide(clientLayer),
            Effect.catchTag(InvalidProtocolSchemeError.tag, (invalidProtocolScheme) => {
              return Effect.fail(
                new ProvingError({
                  message: 'Invalid proving client configuration',
                  cause: invalidProtocolScheme,
                }),
              );
            }),
          );
        case 'NothingToProve':
          return Effect.succeed(recipe.transaction);
      }
    },
  };
};

export const makeSimulatorProvingService = (): ProvingService<ProofErasedTransaction> => {
  return {
    prove(recipe: ProvingRecipe<ProofErasedTransaction>): Effect.Effect<ProofErasedTransaction, WalletError> {
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
