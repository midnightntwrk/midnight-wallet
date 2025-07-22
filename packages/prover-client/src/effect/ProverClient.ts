import { Effect, Context } from 'effect';
import {
  ClientError,
  ServerError,
  SerializedTransaction,
  SerializedUnprovenTransaction,
} from '@midnight-ntwrk/abstractions';

/**
 * A client that provides proof services for unproven transactions.
 */
export class ProverClient extends Context.Tag('@midnight-ntwrk/prover-client#ProverClient')<
  ProverClient,
  ProverClient.Service
>() {}

export declare namespace ProverClient {
  /**
   * Provides server related configuration for {@link ProverClient} implementations.
   */
  interface ServerConfig {
    /** The base URL to the Proof Server. */
    readonly url: URL | string;
  }

  interface Service {
    /**
     * Proves an unproven transaction by submitting it to an associated Proof Server.
     *
     * @param transaction A serialized unproven transaction.
     * @returns An `Effect` that yields with a serialized transaction representing the proven version of `transaction`;
     * or fails with a client or server side error.
     */
    proveTransaction(
      transaction: SerializedUnprovenTransaction,
    ): Effect.Effect<SerializedTransaction, ClientError | ServerError>;
  }
}
