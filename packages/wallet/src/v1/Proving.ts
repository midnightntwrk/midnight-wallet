import { HttpProverClient, ProverClient } from '@midnight-ntwrk/wallet-prover-client-ts/effect';
import { InvalidProtocolSchemeError, SerializedUnprovenTransaction } from '@midnight-ntwrk/abstractions';
import { ProofErasedTransaction } from '@midnight-ntwrk/zswap';
import * as zswap from '@midnight-ntwrk/zswap';
import { Effect, pipe } from 'effect';
import { ProvingRecipe } from './ProvingRecipe';
import { ProvingError, WalletError } from './WalletError';

export interface ProvingService<TTransaction> {
  prove(recipe: ProvingRecipe<TTransaction>): Effect.Effect<TTransaction, WalletError>;
}

export type DefaultProvingConfiguration = {
  provingServerUrl: URL;
  networkId: zswap.NetworkId;
};

export const httpProveTx = (
  networkId: zswap.NetworkId,
  unproven: zswap.UnprovenTransaction,
): Effect.Effect<zswap.Transaction, WalletError, ProverClient.ProverClient> => {
  return Effect.gen(function* () {
    const client = yield* ProverClient.ProverClient;
    const unprovenSerialized = SerializedUnprovenTransaction(unproven.serialize(networkId));
    const provenSerialized = yield* client.proveTransaction(unprovenSerialized);
    return zswap.Transaction.deserialize(provenSerialized, networkId);
  }).pipe(Effect.mapError((err) => WalletError.proving(err)));
};

export const makeDefaultProvingService = (
  configuration: DefaultProvingConfiguration,
): ProvingService<zswap.Transaction> => {
  const clientLayer = HttpProverClient.layer({
    url: configuration.provingServerUrl,
  });

  return {
    prove(recipe: ProvingRecipe<zswap.Transaction>): Effect.Effect<zswap.Transaction, WalletError> {
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

export const makeSimulatorProvingService = (): ProvingService<zswap.ProofErasedTransaction> => {
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
