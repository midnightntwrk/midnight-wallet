import { Effect } from 'effect';
import {
  ProverClient,
  HttpProverClient as _HttpProverClient,
  SerializedUnprovenTransaction,
} from '@midnight/wallet-prover-client-ts/effect';

/**
 * Sends serialized unproven transactions to a Proof Server over HTTP.
 */
export class HttpProverClient {
  #innerClient: ProverClient.ProverClient.Service;

  /**
   * Initializes a new {@link HttpProverClient}.
   *
   * @param config The server configuration to use when configuring the HTTP elements of the Proof Server.
   * @throws {@link ProverClient.InvalidProtocolSchemeError}
   * The `config` is invalid for a HTTP context. E.g., expecting 'http:' or 'https:' URLs but something other
   * was provided.
   */
  constructor(config: ProverClient.ProverClient.ServerConfig) {
    this.#innerClient = Effect.gen(function* () {
      return yield* ProverClient.ProverClient;
    }).pipe(Effect.provide(_HttpProverClient.layer(config)), Effect.runSync);
  }

  /**
   * Proves an unproven transaction by submitting it over HTTP to an associated Proof Server.
   *
   * @param transaction A serialized unproven transaction.
   * @returns A `Promise` that resolves with a serialized transaction representing the proven version of
   * `transaction`; or fails with a client or server side error.
   * @throws {@link ProverClient.ProverClientError}
   * There was an issue with the provided `transaction`, or a connection with the configured Proof
   * Server could not be initiated.
   * @throws {@link ProverClient.ProverServerError}
   * Unable to establish a connection with the configured Proof Server, or there was an internal error that
   * prevented the proof request from being executed.
   */
  proveTransaction(transaction: Uint8Array): Promise<Uint8Array> {
    const unprovenTx = SerializedUnprovenTransaction.SerializedUnprovenTransaction(transaction);

    return this.#innerClient.proveTransaction(unprovenTx).pipe(Effect.runPromise);
  }
}
