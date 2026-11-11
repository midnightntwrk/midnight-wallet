// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
// http://www.apache.org/licenses/LICENSE-2.0
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
import { type Effect, type Schedule, Context } from 'effect';
import type * as ledgerV8 from '@midnightntwrk/ledger-v8';
import type * as ledgerV9 from '@midnightntwrk/ledger-v9';
import { type ClientError, type ServerError } from '@midnightntwrk/wallet-sdk-utilities/networking';
import type { KeyMaterialProvider } from '@midnightntwrk/zkir-v2';

/** A client that provides proof services for unproven transactions. */
export class ProverClient extends Context.Tag('@midnight-ntwrk/prover-client#ProverClient')<
  ProverClient,
  ProverClient.Service
>() {}

export declare namespace ProverClient {
  /** Provides server-related configuration for {@link ProverClient} implementations. */
  interface ServerConfig {
    /** The base URL to the Proof Server. */
    readonly url: URL | string;
    /**
     * The most requests the client has waiting at the Proof Server at once. Defaults to 10, the places a Proof Server
     * has in its queue as released.
     *
     * @remarks
     *   A ledger asks for every proof of a transaction at once, and a Proof Server refuses the requests its queue has no
     *   room for, which fails the whole transaction. Requests past this number are held back, and sent as earlier ones
     *   are answered. `/check` and `/prove` requests wait in the same queue at the server, so both count.
     *
     *   A proof that is interrupted keeps the turns of the requests it has already asked for: the ledger asks for all of
     *   them up front and cannot take one back, so they are still sent, ahead of anything proved afterwards.
     */
    readonly maxConcurrentRequests?: number;
    /**
     * How often, and how far apart, to send a request again after the Proof Server could not take it: its queue was
     * full (HTTP 429), or something between the client and it gave way (HTTP 502, 503, 504). Defaults to a wait of 1
     * second, doubling up to 10 seconds, for 5 minutes in all.
     *
     * @remarks
     *   Once the schedule has run out the request fails with what the server said last. Any other reply fails it at once,
     *   because sending the same request again would get the same reply.
     */
    readonly retrySchedule?: Schedule.Schedule<unknown, unknown>;
  }

  /** Provides wasm-related configuration for {@link KeyMaterialProvider} implementations. */
  interface WasmConfig {
    /** The Key Material Provider. */
    readonly keyMaterialProvider: KeyMaterialProvider;
  }

  interface Service {
    /**
     * Proves an unproven transaction by submitting it to an associated Proof Server.
     *
     * @param transaction A serialized unproven transaction.
     * @returns An `Effect` that yields with a serialized transaction representing the proven version of `transaction`;
     *   or fails with a client or server side error.
     */
    proveTransaction<S extends ledgerV9.Signaturish, B extends ledgerV9.Bindingish>(
      tx: ledgerV9.Transaction<S, ledgerV9.PreProof, B>,
      costModel?: ledgerV9.CostModel,
    ): Effect.Effect<ledgerV9.Transaction<S, ledgerV9.Proof, B>, ClientError | ServerError>;

    /** A proving provider that frames its requests with ledger-v9. */
    asProvingProvider(): ledgerV9.ProvingProvider;

    /** The same provider as {@link asProvingProvider}, named for the ledger version it frames with. */
    asV9ProvingProvider(): ledgerV9.ProvingProvider;

    /**
     * A proving provider that frames its requests with ledger-v8.
     *
     * @remarks
     *   A preimage is produced by the ledger version that built the transaction, and has to be framed and read back by
     *   that same version — so a client serving a ledger-v8 transaction is asked for this provider rather than the
     *   other. An in-process prover frames nothing: it works on bytes, and offers the same provider for both. What it
     *   proves for is decided by the key material it was created with, which is per ledger version.
     */
    asV8ProvingProvider(): ledgerV8.ProvingProvider;
  }
}
