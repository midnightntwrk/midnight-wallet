import { Deferred, Effect, Encoding, Exit, pipe, Scope } from 'effect';
import { WalletError } from './WalletError';
import * as zswap from '@midnight-ntwrk/zswap';
import { Simulator } from './Simulator';
import {
  NodeClient,
  NodeClientError,
  PolkadotNodeClient,
  SubmissionEvent as SubmissionEventImported,
} from '@midnight-ntwrk/wallet-node-client-ts/effect';
import * as ledger from '@midnight-ntwrk/ledger';

export const SubmissionEvent = SubmissionEventImported;
export type SubmissionEvent = SubmissionEventImported.SubmissionEvent;
export declare namespace SubmissionEventCases {
  export type Finalized = SubmissionEventImported.Cases.Finalized;
  export type Submitted = SubmissionEventImported.Cases.Submitted;
  export type InBlock = SubmissionEventImported.Cases.InBlock;
}

export type SubmitTransactionMethod<TTransaction> = {
  (transaction: TTransaction, waitForStatus: 'Submitted'): Effect.Effect<SubmissionEventCases.Submitted, WalletError>;
  (transaction: TTransaction, waitForStatus: 'InBlock'): Effect.Effect<SubmissionEventCases.InBlock, WalletError>;
  (transaction: TTransaction, waitForStatus: 'Finalized'): Effect.Effect<SubmissionEventCases.Finalized, WalletError>;
  (transaction: TTransaction): Effect.Effect<SubmissionEventCases.InBlock, WalletError>;
  (
    transaction: TTransaction,
    waitForStatus?: 'Submitted' | 'InBlock' | 'Finalized',
  ): Effect.Effect<SubmissionEvent, WalletError>;
};

export interface SubmissionService<TTransaction> {
  submitTransaction: SubmitTransactionMethod<TTransaction>;
  close(): Effect.Effect<void>;
}

export type DefaultSubmissionConfiguration = {
  relayURL: URL;
  networkId: zswap.NetworkId;
};
export const makeDefaultSubmissionService = (
  config: DefaultSubmissionConfiguration,
): SubmissionService<zswap.Transaction> => {
  //Using Deferred under the hood + allowing for "close" method in the service allows to keep resource usage in check and a synchronous API
  type ScopeAndClient = { scope: Scope.CloseableScope; client: NodeClient.Service };

  const scopeAndClientDeferred = Deferred.make<ScopeAndClient, NodeClientError.NodeClientError>().pipe(Effect.runSync);

  const makeScopeAndClient: Effect.Effect<ScopeAndClient, NodeClientError.NodeClientError> = Effect.gen(function* () {
    const scope = yield* Scope.make();
    const client = yield* PolkadotNodeClient.make({
      nodeURL: config.relayURL,
    }).pipe(Effect.provideService(Scope.Scope, scope));

    return { scope, client };
  });

  void pipe(scopeAndClientDeferred, Deferred.complete(makeScopeAndClient), Effect.runPromise);

  const submit = (transaction: zswap.Transaction, waitForStatus: SubmissionEvent['_tag'] = 'InBlock') => {
    return pipe(
      NodeClient.sendMidnightTransactionAndWait(transaction.serialize(config.networkId), waitForStatus),
      Effect.provideServiceEffect(
        NodeClient.NodeClient,
        pipe(
          scopeAndClientDeferred,
          Deferred.await,
          Effect.map(({ client }) => client),
        ),
      ),
      Effect.mapError((err) => WalletError.submission(err)),
    );
  };

  return {
    submitTransaction: submit as SubmitTransactionMethod<zswap.Transaction>,
    close(): Effect.Effect<void> {
      return pipe(
        scopeAndClientDeferred,
        Deferred.await,
        Effect.flatMap(({ scope }) => Scope.close(scope, Exit.void)),
        Effect.ignoreLogged,
      );
    },
  };
};

export type SimulatorSubmissionConfiguration = {
  simulator: Simulator;
};
export const makeSimulatorSubmissionService =
  (waitForStatus: 'Submitted' | 'InBlock' | 'Finalized' = 'InBlock') =>
  (config: SimulatorSubmissionConfiguration): SubmissionService<zswap.ProofErasedTransaction> => {
    const submit = (transaction: zswap.ProofErasedTransaction): Effect.Effect<SubmissionEvent, WalletError> => {
      const serializedTx = transaction.serialize(zswap.NetworkId.Undeployed);
      return config.simulator
        .submitRegularTx(ledger.ProofErasedTransaction.deserialize(serializedTx, ledger.NetworkId.Undeployed))
        .pipe(
          Effect.map((output) => {
            // Let's mimic node's client behavior here
            switch (waitForStatus) {
              case 'Submitted':
                return SubmissionEvent.Submitted({
                  tx: serializedTx,
                  txHash: Encoding.encodeHex(serializedTx.subarray(0, 32)),
                });
              case 'InBlock':
                return SubmissionEvent.InBlock({
                  tx: serializedTx,
                  blockHash: output.blockHash,
                  blockHeight: output.blockNumber,
                  txHash: Encoding.encodeHex(serializedTx.subarray(0, 32)),
                });
              case 'Finalized':
                return SubmissionEvent.Finalized({
                  tx: serializedTx,
                  blockHash: output.blockHash,
                  blockHeight: output.blockNumber,
                  txHash: Encoding.encodeHex(serializedTx.subarray(0, 32)),
                });
            }
          }),
        );
    };

    return {
      submitTransaction: submit as SubmitTransactionMethod<zswap.ProofErasedTransaction>,
      close: (): Effect.Effect<void> => Effect.void,
    };
  };
