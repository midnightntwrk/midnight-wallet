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
import Worker from 'web-worker';
import { type Context, Effect, Layer, Schema, pipe } from 'effect';
import { type InvalidProtocolSchemeError, ClientError } from '@midnightntwrk/wallet-sdk-utilities/networking';
import type * as ledger from '@midnightntwrk/ledger-v9';
import { type KeyMaterialProvider, type ProvingKeyMaterial } from '@midnight-ntwrk/zkir-v2';
import { DefaultKeyMaterialSource, makeKeyMaterialProvider, V8KeyMaterial, V9KeyMaterial } from './KeyMaterial.js';
import { ProverClient } from './ProverClient.js';

/**
 * Creates a layer for a {@link ProverClient} that sends requests to a Wasm Prover.
 *
 * @param config The Key Material Provider to use when configuring the prover's elements of the layer.
 * @returns A `Layer` for {@link ProverClient} that sends requests to a configured Wasm Prover.
 */
export const layer: (config: ProverClient.WasmConfig) => Layer.Layer<ProverClient, InvalidProtocolSchemeError> = (
  config,
) => Layer.effect(ProverClient, Effect.succeed(new WasmProverImpl(config.keyMaterialProvider)));

export const create = (
  config: ProverClient.WasmConfig,
): Effect.Effect<ProverClient.Service, InvalidProtocolSchemeError> => {
  return Effect.succeed(new WasmProverImpl(config.keyMaterialProvider));
};

const MAX_TIME_TO_PROCESS = 10 * 60 * 1000;

export const CheckOperationSchema = Schema.Struct({
  op: Schema.Literal('check'),
  args: Schema.Tuple(Schema.Uint8Array),
});
type CheckOperationSchema = Schema.Schema.Type<typeof CheckOperationSchema>;

export const ProveOperationSchema = Schema.Struct({
  op: Schema.Literal('prove'),
  args: Schema.Tuple(Schema.Uint8Array, Schema.Union(Schema.BigIntFromSelf, Schema.Undefined)),
});
type ProveOperationSchema = Schema.Schema.Type<typeof ProveOperationSchema>;

export const LookupKeyRequestSchema = Schema.Struct({
  op: Schema.Literal('lookupKey'),
  keyLocation: Schema.String,
});

export const GetParamsRequestSchema = Schema.Struct({
  op: Schema.Literal('getParams'),
  k: Schema.Number,
});

export const ResponseFromWorkerSchema = Schema.Struct({
  op: Schema.Literal('result'),
  value: Schema.Union(Schema.Uint8Array, Schema.Array(Schema.Union(Schema.BigIntFromSelf, Schema.Undefined))),
});

const ProvingKeyMaterialSchema = Schema.Struct({
  proverKey: Schema.Uint8Array,
  verifierKey: Schema.Uint8Array,
  ir: Schema.Uint8Array,
});

export const LookupKeyOperationResultSchema = Schema.Struct({
  op: Schema.Literal('lookupKey'),
  keyLocation: Schema.String,
  result: Schema.optional(ProvingKeyMaterialSchema),
});

export const GetParamsOperationResultSchema = Schema.Struct({
  op: Schema.Literal('getParams'),
  k: Schema.Number,
  result: Schema.Uint8Array,
});

const MessageDataSchema = Schema.Union(LookupKeyRequestSchema, GetParamsRequestSchema, ResponseFromWorkerSchema);

type MessageData = Schema.Schema.Type<typeof MessageDataSchema>;

type CallProverWorker = {
  kmProvider: KeyMaterialProvider;
} & (ProveOperationSchema | CheckOperationSchema);

const callProverWorker = <RResponse>({ kmProvider, op, args }: CallProverWorker): Promise<RResponse> => {
  return new Promise((resolve, reject) => {
    const currentFile = import.meta.url;
    const worker = new Worker(new URL(`../../dist/proof-worker.js`, currentFile), { type: 'module' });

    // initialize worker
    worker.postMessage(
      op === 'check'
        ? Schema.encodeSync(CheckOperationSchema)({ op, args: [args[0]] })
        : Schema.encodeSync(ProveOperationSchema)({ op, args: [args[0], args[1]] }),
    );

    // a message from the worker
    worker.addEventListener('message', ({ data }: MessageEvent<MessageData>) => {
      const decoded = Schema.decodeUnknownSync(MessageDataSchema)(data);
      const { op } = decoded;
      if (op === 'lookupKey') {
        const { keyLocation } = decoded;
        kmProvider
          .lookupKey(keyLocation)
          .then((result) => {
            worker.postMessage(Schema.encodeSync(LookupKeyOperationResultSchema)({ op, keyLocation, result }));
          })
          .catch((e: Error) => {
            worker.terminate();
            reject(e);
          });
      } else if (op === 'getParams') {
        const { k } = decoded;
        kmProvider
          .getParams(k)
          .then((result) => {
            worker.postMessage(Schema.encodeSync(GetParamsOperationResultSchema)({ op, k, result }));
          })
          .catch((e: Error) => {
            worker.terminate();
            reject(e);
          });
      } else if (op === 'result') {
        const { value } = decoded;
        worker.terminate();
        resolve(value as RResponse);
      }
    });
    worker.addEventListener('error', (e: ErrorEvent) => {
      worker.terminate();
      reject(Error(e.message));
    });
    setTimeout(() => {
      worker.terminate();
      reject(new Error(`${op} action timed out`));
    }, MAX_TIME_TO_PROCESS);
  });
};

class WasmProverImpl implements Context.Tag.Service<ProverClient> {
  constructor(keyMaterialProvider: KeyMaterialProvider) {
    this.keyMaterialProvider = keyMaterialProvider;
  }

  protected readonly keyMaterialProvider: KeyMaterialProvider;

  private wasmProverProvider = (keyMaterialProvider?: KeyMaterialProvider): ledger.ProvingProvider => ({
    check: async (serializedPreimage: Uint8Array, _keyLocation: string): Promise<(bigint | undefined)[]> =>
      callProverWorker<Array<bigint | undefined>>({
        kmProvider: keyMaterialProvider ?? this.keyMaterialProvider,
        op: 'check',
        args: [serializedPreimage],
      }),
    prove: async (
      serializedPreimage: Uint8Array,
      _keyLocation: string,
      overwriteBindingInput?: bigint,
    ): Promise<Uint8Array> =>
      callProverWorker<Uint8Array>({
        kmProvider: keyMaterialProvider ?? this.keyMaterialProvider,
        op: 'prove',
        args: [serializedPreimage, overwriteBindingInput],
      }),
    lookupKey: (keyLocation: string): Promise<ProvingKeyMaterial | undefined> =>
      (keyMaterialProvider ?? this.keyMaterialProvider).lookupKey(keyLocation),
  });

  proveTransaction<S extends ledger.Signaturish, B extends ledger.Bindingish>(
    transaction: ledger.Transaction<S, ledger.PreProof, B>,
    costModel: ledger.CostModel,
    keyMaterialProvider?: KeyMaterialProvider,
  ): Effect.Effect<ledger.Transaction<S, ledger.Proof, B>, ClientError> {
    return pipe(
      Effect.succeed(this.wasmProverProvider(keyMaterialProvider)),
      Effect.flatMap((provider) =>
        Effect.tryPromise({
          try: () => transaction.prove(provider, costModel),
          catch: (error) =>
            error instanceof ClientError
              ? error
              : new ClientError({ message: 'Failed to prove transaction', cause: error }),
        }),
      ),
    );
  }

  asProvingProvider() {
    return this.wasmProverProvider();
  }

  /**
   * The same provider {@link asProvingProvider} returns.
   *
   * @remarks
   *   The in-process prover drives a zkir runtime over bytes and never looks at a ledger version, so the provider is the
   *   same under both names — but the key material it proves with is not interchangeable. Each ledger version's
   *   circuits were generated as their own generation, and a node rejects a proof made with another's, so a prover
   *   proves for the ledger version whose key material it was created with: {@link makeV9KeyMaterialProvider} for
   *   ledger-v9, {@link makeV8KeyMaterialProvider} for ledger-v8.
   */
  asV9ProvingProvider() {
    return this.wasmProverProvider();
  }

  asV8ProvingProvider() {
    return this.wasmProverProvider();
  }
}

export {
  DefaultKeyMaterialSource,
  KeyMaterialFetchError,
  KeyMaterialIntegrityError,
  KeyMaterialTransferError,
  UnknownPublicParametersError,
  type KeyMaterialError,
} from './KeyMaterial.js';

/** Where the bundled key material providers read from. */
export type KeyMaterialConfig = {
  /**
   * The host to read key material from, in place of {@link DefaultKeyMaterialSource}.
   *
   * @remarks
   *   For serving the files yourself — a mirror, or the page's own origin in a browser, since the default host sends no
   *   CORS headers. The files are laid out as the default host lays them out (`dust/10/spend.prover`,
   *   `bls_midnight_2p14`, …), and a path is kept: `https://example.com/keys` reads `https://example.com/keys/dust/…`.
   *   Whatever the host, every file is checked against the hash its ledger release declares.
   */
  readonly source?: URL | string;
};

/**
 * The key material ledger-v9's circuits were generated with: circuit generation 10.
 *
 * @remarks
 *   Every file is read from the host the ledger's own data provider reads (or from `config.source`) and checked against
 *   the SHA-256 the ledger release declares before it is handed back; a file that does not match is refused with
 *   {@link KeyMaterialIntegrityError}, since a proof made with it would be rejected by a node. Each circuit and each
 *   parameter size is read once per provider. Checking needs Web Crypto (`crypto.subtle`): Node 19 or later, or a
 *   browser page served from a secure context.
 * @example
 *   ```typescript
 *   const prover = yield* WasmProver.create({ keyMaterialProvider: WasmProver.makeV9KeyMaterialProvider() });
 *   const proven = yield* prover.proveTransaction(unprovenV9Transaction, ledger.CostModel.initialCostModel());
 *   ```;
 *
 * @param config Where to read from; the default host when left out.
 * @returns A provider for {@link create} whose prover proves ledger-v9 transactions.
 * @throws TypeError if `config.source` is not a URL.
 */
export const makeV9KeyMaterialProvider = (config?: KeyMaterialConfig): KeyMaterialProvider =>
  makeKeyMaterialProvider(V9KeyMaterial, { source: config?.source ?? DefaultKeyMaterialSource });

/**
 * The key material ledger-v8's circuits were generated with: circuit generation 9.
 *
 * @remarks
 *   The ledger-v8 twin of {@link makeV9KeyMaterialProvider}, read and checked the same way. A prover created with it
 *   proves ledger-v8 transactions, through `asV8ProvingProvider()`; ledger-v9's Dust spend circuit is a different
 *   generation, and a node rejects a Dust spend proved with the other version's key material.
 * @example
 *   ```typescript
 *   const prover = yield* WasmProver.create({ keyMaterialProvider: WasmProver.makeV8KeyMaterialProvider() });
 *   const proven = yield* Effect.promise(() =>
 *     unprovenV8Transaction.prove(prover.asV8ProvingProvider(), ledgerV8.CostModel.initialCostModel()),
 *   );
 *   ```;
 *
 * @param config Where to read from; the default host when left out.
 * @returns A provider for {@link create} whose prover proves ledger-v8 transactions.
 * @throws TypeError if `config.source` is not a URL.
 */
export const makeV8KeyMaterialProvider = (config?: KeyMaterialConfig): KeyMaterialProvider =>
  makeKeyMaterialProvider(V8KeyMaterial, { source: config?.source ?? DefaultKeyMaterialSource });

/**
 * The same provider as {@link makeV9KeyMaterialProvider}.
 *
 * @remarks
 *   Ledger-v9's, because ledger-v9 is what this prover's own surface — `proveTransaction`, `asProvingProvider` — is typed
 *   with. A prover that proves ledger-v8 transactions wants {@link makeV8KeyMaterialProvider} instead.
 * @example
 *   ```typescript
 *   const prover = yield* WasmProver.create({ keyMaterialProvider: WasmProver.makeDefaultKeyMaterialProvider() });
 *   ```;
 *
 * @param config Where to read from; the default host when left out.
 * @returns A provider for {@link create} whose prover proves ledger-v9 transactions.
 * @throws TypeError if `config.source` is not a URL.
 */
export const makeDefaultKeyMaterialProvider = (config?: KeyMaterialConfig): KeyMaterialProvider =>
  makeV9KeyMaterialProvider(config);
