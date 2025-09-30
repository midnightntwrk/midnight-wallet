import {
  NodeClient,
  PolkadotNodeClient as EffectNodeClient,
  SubmissionEvent,
  NodeClientError,
  Config,
} from './effect/index';
import { Effect, Exit, pipe, Scope } from 'effect';
import { Observable } from '@polkadot/types/types';
import { ObservableOps } from '@midnight-ntwrk/wallet-sdk-utilities';

export { Config, makeConfig, DEFAULT_CONFIG } from './effect/PolkadotNodeClient';

export class PolkadotNodeClient {
  static init(config: Config): Promise<PolkadotNodeClient> {
    return Effect.gen(function* () {
      const scope = yield* Scope.make();
      const client = yield* NodeClient.NodeClient.pipe(
        Effect.provide(EffectNodeClient.layer(config)),
        Effect.provideService(Scope.Scope, scope),
      );

      return new PolkadotNodeClient(client, scope);
    }).pipe(Effect.runPromise);
  }

  readonly #effectClient: NodeClient.Service;
  readonly #scope: Scope.CloseableScope;
  private constructor(effectClient: NodeClient.Service, scope: Scope.CloseableScope) {
    this.#effectClient = effectClient;
    this.#scope = scope;
  }

  sendMidnightTransaction(
    serializedTransaction: NodeClient.SerializedMnTransaction,
  ): Observable<SubmissionEvent.SubmissionEvent> {
    return ObservableOps.fromStream(this.#effectClient.sendMidnightTransaction(serializedTransaction));
  }

  sendMidnightTransactionAndWait(
    serializedTransaction: NodeClient.SerializedMnTransaction,
    waitFor: SubmissionEvent.Cases.Submitted['_tag'],
  ): Promise<SubmissionEvent.Cases.Submitted>;
  sendMidnightTransactionAndWait(
    serializedTransaction: NodeClient.SerializedMnTransaction,
    waitFor: SubmissionEvent.Cases.InBlock['_tag'],
  ): Promise<SubmissionEvent.Cases.InBlock>;
  sendMidnightTransactionAndWait(
    serializedTransaction: NodeClient.SerializedMnTransaction,
    waitFor: SubmissionEvent.Cases.Finalized['_tag'],
  ): Promise<SubmissionEvent.Cases.Finalized>;
  sendMidnightTransactionAndWait(
    serializedTransaction: NodeClient.SerializedMnTransaction,
    waitFor: SubmissionEvent.SubmissionEvent['_tag'],
  ): Promise<SubmissionEvent.SubmissionEvent> {
    const runRequest = <A>(
      request: Effect.Effect<A, NodeClientError.NodeClientError, NodeClient.NodeClient>,
    ): Promise<A> => pipe(request, Effect.provideService(NodeClient.NodeClient, this.#effectClient), Effect.runPromise);

    return NodeClient.sendMidnightTransactionAndWait(serializedTransaction, waitFor).pipe(runRequest);
  }

  close(): Promise<void> {
    return Scope.close(this.#scope, Exit.void).pipe(Effect.runPromise);
  }
}
