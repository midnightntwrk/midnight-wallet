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
import { SerializedTransaction } from '@midnightntwrk/wallet-sdk-abstractions';
import { SubmissionError } from '@midnightntwrk/wallet-sdk-capabilities';
import { NodeClientError } from '@midnightntwrk/wallet-sdk-node-client/effect';
import RpcError from '@polkadot/rpc-provider/coder/error';
import { Effect } from 'effect';
import { expect } from 'vitest';

/**
 * What a submission service built on Effect rejects with when its submission fails with `cause`: the promise boundary
 * hands the caller the fiber's failure, wrapping the service's `SubmissionError`, exactly as the default service does.
 */
export const serviceRejection = (cause: unknown): Promise<Error> =>
  Effect.runPromise(Effect.fail(new SubmissionError({ message: 'Transaction submission error', cause }))).then(
    () => expect.unreachable('a failing effect resolved'),
    (rejection: unknown) =>
      rejection instanceof Error ? rejection : expect.unreachable('the promise boundary rejected with a non-Error'),
  );

/** The bytes a node error names as the transaction it is about; no test reads them. */
export const rejectedTxData = SerializedTransaction.of(new Uint8Array([1, 2, 3]));

/** The rejection of a submission the node answered with a refusal, so it never entered the pool. */
export const nodeRefusal = (message: string): Promise<Error> =>
  serviceRejection(
    new NodeClientError.SubmissionError({
      message: 'Transaction submission failed',
      txData: rejectedTxData,
      cause: new RpcError(message, 1010),
    }),
  );

/** The rejection of a submission that never reached the node, because no connection to it was made. */
export const nodeUnreachable = (message: string): Promise<Error> =>
  serviceRejection(new NodeClientError.ConnectionError({ message }));
