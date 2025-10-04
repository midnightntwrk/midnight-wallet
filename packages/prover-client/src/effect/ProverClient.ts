import { Effect, Context } from 'effect';
import * as ledger from '@midnight-ntwrk/ledger-v6';
import { ClientError, ServerError } from '@midnight-ntwrk/wallet-sdk-utilities/networking';

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
    proveTransaction<S extends ledger.Signaturish, B extends ledger.Bindingish>(
      tx: ledger.Transaction<S, ledger.PreProof, B>,
      costModel?: ledger.CostModel,
    ): Effect.Effect<ledger.Transaction<S, ledger.Proof, B>, ClientError | ServerError>;
  }
}
