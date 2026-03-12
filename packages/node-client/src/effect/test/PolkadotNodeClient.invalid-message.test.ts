// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) 2025 Midnight Foundation
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
import { describe, expect, it, vi } from 'vitest';
import { Cause, Effect, Exit, Option, Stream } from 'effect';
import { PolkadotNodeClient, makeConfig } from '../PolkadotNodeClient.js';
import { SerializedTransaction } from '@midnight-ntwrk/wallet-sdk-abstractions';

describe('PolkadotNodeClient invalid transaction handling', () => {
  it('reports invalid transactions with an invalidity-specific message', async () => {
    const txData = SerializedTransaction.of(new Uint8Array([1, 2, 3]));
    const unsubscribe = vi.fn().mockResolvedValue(undefined);
    const api = {
      isConnected: true,
      connect: vi.fn(),
      tx: {
        midnight: {
          sendMnTransaction: vi.fn().mockReturnValue({
            send: vi.fn((handleSubmissionResult) => {
              queueMicrotask(() => {
                void handleSubmissionResult({
                  status: {
                    isReady: false,
                    isFuture: false,
                    isBroadcast: false,
                    isRetracted: false,
                    isInBlock: false,
                    isFinalized: false,
                    isFinalityTimeout: false,
                    isUsurped: false,
                    isDropped: false,
                    isInvalid: true,
                  },
                  txHash: { toString: () => '0xdeadbeef' },
                });
              });

              return Promise.resolve(unsubscribe);
            }),
          }),
        },
      },
    } as const;

    const result = await (
      new PolkadotNodeClient(makeConfig({ nodeURL: new URL('ws://127.0.0.1:9944') }), api as never)
        .sendMidnightTransaction(txData)
        .pipe(Stream.runCollect, Effect.runPromiseExit)
    );

    expect(Exit.isFailure(result)).toBe(true);

    if (Exit.isFailure(result)) {
      const failure = Cause.failureOption(result.cause);
      expect(Option.isSome(failure)).toBe(true);

      if (Option.isSome(failure)) {
        expect(failure.value._tag).toBe('TransactionInvalidError');

        if (failure.value._tag === 'TransactionInvalidError') {
          expect(failure.value.message).toBe('Transaction is invalid and was rejected by the node');
          expect(failure.value.txData).toEqual(txData);
        }
      }
    }

    expect(unsubscribe).toHaveBeenCalled();
  });
});
