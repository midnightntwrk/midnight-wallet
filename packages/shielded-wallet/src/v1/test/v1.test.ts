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
import { describe, it, expect, vi } from 'vitest';
import { type DefaultV1Variant, V1Builder } from '../V1Builder.js';
import * as ledger from '@midnight-ntwrk/ledger-v7';
import { WalletError } from '../WalletError.js';
import { Effect, Either, Encoding, Option, pipe, Ref, SubscriptionRef } from 'effect';
import { type SubmissionService } from '../Submission.js';
import { makeDefaultTransactingCapability } from '../Transacting.js';
import { NodeContext } from '@effect/platform-node';
import { WalletSeed, NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { makeDefaultCoinsAndBalancesCapability } from '../CoinsAndBalances.js';
import { chooseCoin } from '@midnight-ntwrk/wallet-sdk-capabilities';
import { makeDefaultKeysCapability } from '../Keys.js';
import { CoreWallet } from '../CoreWallet.js';
import { makeFakeTx } from '../../test/genTxs.js';

describe('V1 Variant', () => {
  it('gracefully stops submission service', async () => {
    const makeFakeSubmission = Ref.make<boolean>(false).pipe(
      Effect.map((ref) => ({
        wasClosedRef: ref,
        submitTransaction: () =>
          Effect.fail(WalletError.submission(new Error('This submission implementation does not submit'))),
        close: (): Effect.Effect<void> => Ref.set(ref, true),
      })),
    );

    const result = await Effect.gen(function* () {
      const fakeSubmission = yield* makeFakeSubmission;
      const variant: DefaultV1Variant = new V1Builder()
        .withDefaults()
        .withSubmission(() => fakeSubmission)
        .build({
          networkId: NetworkId.NetworkId.Undeployed,
          relayURL: new URL('http://localhost:9944'),
          indexerClientConnection: {
            indexerHttpUrl: 'http://localhost:8080',
          },
          provingServerUrl: new URL('http://localhost:6300'),
        });
      const secretKeys = ledger.ZswapSecretKeys.fromSeed(
        WalletSeed.fromString('0000000000000000000000000000000000000000000000000000000000000001'),
      );
      const initialState = CoreWallet.initEmpty(secretKeys, NetworkId.NetworkId.Undeployed);
      yield* variant.start({ stateRef: yield* SubscriptionRef.make(initialState) });
      return fakeSubmission.wasClosedRef;
    }).pipe(
      Effect.scoped,
      Effect.flatMap((ref) => Ref.get(ref)),
      Effect.runPromise,
    );

    //Having the wallet start and end before getting ref allows to meaningfully read
    // its state as a sign whether close was called or not
    expect(result).toBe(true);
  });

  it('reverts transaction, which failed submission', async () => {
    const config = {
      networkId: NetworkId.NetworkId.Undeployed,
      relayURL: new URL('http://localhost:9944'),
      indexerClientConnection: {
        indexerHttpUrl: 'http://localhost:8080',
      },
      provingServerUrl: new URL('http://localhost:6300'),
    };
    const expectedState = CoreWallet.initEmpty(
      ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 1)),
      NetworkId.NetworkId.Undeployed,
    );
    const testProgram = Effect.gen(function* () {
      const theTransaction = makeFakeTx(100n) as unknown as ledger.FinalizedTransaction; // @TODO optimize
      const failingSubmission: SubmissionService<ledger.FinalizedTransaction> = {
        submitTransaction: () => Effect.fail(WalletError.submission(new Error('boo!'))),
        close: () => Effect.void,
      };
      const transacting = makeDefaultTransactingCapability(config, () => ({
        coinsAndBalancesCapability: makeDefaultCoinsAndBalancesCapability(),
        coinSelection: chooseCoin,
        keysCapability: makeDefaultKeysCapability(),
      }));
      const spiedRevert = vi.spyOn(transacting, 'revertTransaction');
      spiedRevert.mockImplementation((state, transaction) => {
        if (Encoding.encodeHex(transaction.serialize()) === Encoding.encodeHex(theTransaction.serialize())) {
          // Returning a completely different state allows to later test that it is properly connected, without invoking the actual logic
          return Either.right(expectedState);
        } else {
          return Either.left(WalletError.other('Unexpected tx'));
        }
      });

      const variant = new V1Builder()
        .withDefaults()
        .withSubmission(() => failingSubmission)
        .withTransacting(() => transacting)
        .build(config);
      const secretKeys = ledger.ZswapSecretKeys.fromSeed(
        WalletSeed.fromString('0000000000000000000000000000000000000000000000000000000000000001'),
      );
      const initialState = CoreWallet.empty(secretKeys, NetworkId.NetworkId.Undeployed);
      const stateRef = yield* SubscriptionRef.make(initialState);
      const running = yield* variant.start({ stateRef: stateRef });
      const submissionResult = yield* running.submitTransaction(theTransaction).pipe(Effect.either);
      const lastState = yield* SubscriptionRef.get(stateRef);

      return { submissionResult, lastState };
    });

    const result = await pipe(testProgram, Effect.scoped, Effect.provide(NodeContext.layer), Effect.runPromise);

    expect(pipe(result.submissionResult, Either.getLeft, Option.getOrThrow).message).toMatch('boo!');
    expect(result.lastState).toBe(expectedState);
  });
});
