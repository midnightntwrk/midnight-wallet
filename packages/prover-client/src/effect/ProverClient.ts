import { Effect, Context, Data } from 'effect';
import { SerializedUnprovenTransaction } from './SerializedUnprovenTransaction';
import { SerializedTransaction } from './SerializedTransaction';

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
    ): Effect.Effect<SerializedTransaction, ProverClientError | ProverServerError>;
  }
}

/**
 * A configuration error where the protocol scheme of a given Proof Server URL was unexpected (e.g., used
 * `'ftp:'` rather than `'http:'` for a Proof Server running over HTTP).
 */
export class InvalidProtocolSchemeError extends Data.TaggedError('InvalidProtocolSchemeError')<{
  /** The scheme that caused the error. */
  readonly invalidScheme: string;

  /** An array of schemes that were permissible. */
  readonly allowedSchemes: string[];
}> {}

/**
 * An error representing a connection or client-side error.
 *
 * @remarks
 * This error typically indicates a connection issue with a target Proof Server, or when the client has submitted an
 * invalid transaction that could not be processed.
 */
export class ProverClientError extends Data.TaggedError('ProverClientError')<{
  readonly message: string;
}> {}

/**
 * An error representing a server-side error.
 */
export class ProverServerError extends Data.TaggedError('ProverServerError')<{
  readonly message: string;
}> {}
