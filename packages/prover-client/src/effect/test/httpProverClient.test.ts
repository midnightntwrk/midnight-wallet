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
import {
  CostModel,
  createShieldedCoinInfo,
  LedgerParameters,
  sampleCoinPublicKey,
  sampleEncryptionPublicKey,
  shieldedToken,
  Transaction,
  ZswapOffer,
  ZswapOutput,
} from '@midnight-ntwrk/ledger-v6';
import { Effect } from 'effect';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as HttpProverClient from '../HttpProverClient.js';
import * as ProverClient from '../ProverClient.js';

const PROOF_SERVER_IMAGE: string = 'ghcr.io/midnight-ntwrk/proof-server:6.1.0-alpha.6';
const PROOF_SERVER_PORT: number = 6300;

const timeout_minutes = (mins: number) => 1_000 * 60 * mins;

describe('HttpProverClient', () => {
  describe('layer', () => {
    // Ensures that we cannot construct a layer for HttpProverClient when we use common incorrect URI schemes.
    it.each(['ftp:', 'mailto:', 'ws:', 'wss:', 'file:'])(
      'should fail when constructed with %s as the URI scheme',
      async (scheme) => {
        await Effect.gen(function* () {
          // We should never be able to resolve a ProverClient since the configuration used to create the
          // associated HttpProverClient layer is invalid with the protocol schemes being used.
          return yield* ProverClient.ProverClient;
        }).pipe(
          Effect.flatMap((_) => Effect.fail('Unexpectedly resolved a ProverClient')),
          Effect.provide(HttpProverClient.layer({ url: `${scheme}//localhost.com` })),
          // Ensure the reported invalid protocol scheme is the one used.
          Effect.catchTag('InvalidProtocolSchemeError', (err) =>
            err.invalidScheme !== scheme
              ? Effect.fail(`Expected '${scheme}' but received '${err.invalidScheme}'`)
              : Effect.succeed(void 0),
          ),
          Effect.runPromise,
        );
      },
    );
  });

  describe('with available Proof Server', () => {
    let proofServerContainer: StartedTestContainer | undefined = undefined;

    const proofServerPort = () => proofServerContainer?.getMappedPort(PROOF_SERVER_PORT) ?? PROOF_SERVER_PORT;

    const shieldedTokenType = shieldedToken() as { raw: string; tag: 'shielded' };
    const makeValidTransaction = (spendCoinAmount: bigint) => {
      const spendCoin = createShieldedCoinInfo(shieldedTokenType.raw, spendCoinAmount);
      const cpk = sampleCoinPublicKey();
      const epk = sampleEncryptionPublicKey();
      const output = ZswapOutput.new(spendCoin, 0, cpk, epk);
      const unprovenOffer = ZswapOffer.fromOutput(output, shieldedTokenType.raw, spendCoinAmount);

      return Transaction.fromParts('undeployed', unprovenOffer);
    };

    beforeAll(async () => {
      proofServerContainer = await new GenericContainer(PROOF_SERVER_IMAGE)
        .withExposedPorts(PROOF_SERVER_PORT)
        .withWaitStrategy(Wait.forListeningPorts().withStartupTimeout(timeout_minutes(2)))
        .start();
    }, timeout_minutes(5));

    afterAll(async () => {
      await proofServerContainer?.stop();
    }, timeout_minutes(1));

    it(
      'should prove a valid transaction',
      async () => {
        await Effect.gen(function* () {
          const proveClient = yield* ProverClient.ProverClient;

          const spendCoinAmount = 1_000n;

          const validTx = makeValidTransaction(spendCoinAmount);

          const tx = yield* proveClient.proveTransaction(validTx, CostModel.initialCostModel());

          const imbalances = tx.imbalances(0, tx.fees(LedgerParameters.initialParameters()));

          // workaround because imbalances keys are objects, while js compares them by reference
          const filteredImbalances = Array.from(imbalances.entries()).filter(
            ([tokenType, tokenValue]) => tokenType.tag === shieldedTokenType.tag && tokenValue <= spendCoinAmount,
          );

          expect(filteredImbalances.length).toEqual(1);
          expect(tx.fees(LedgerParameters.initialParameters())).not.toEqual(0n);
        }).pipe(
          Effect.provide(HttpProverClient.layer({ url: `http://127.0.0.1:${proofServerPort()}` })),
          Effect.catchAll((err) => Effect.fail(`Encountered unexpected '${err._tag}' error: ${err.message}`)),
          Effect.runPromise,
        );
      },
      timeout_minutes(5),
    );

    it(
      'should fail to prove an invalid transaction',
      async () => {
        await Effect.gen(function* () {
          const proveClient = yield* ProverClient.ProverClient;

          const tx = makeValidTransaction(1n);

          yield* proveClient.proveTransaction(tx, CostModel.initialCostModel());
        }).pipe(
          Effect.catchAll(() => Effect.succeed(void 0)),
          Effect.provide(HttpProverClient.layer({ url: `http://127.0.0.1:${proofServerPort()}` })),
          Effect.catchAll((err) => Effect.fail(`Encountered unexpected '${err._tag}' error: ${err.message}`)),
          Effect.runPromise,
        );
      },
      timeout_minutes(5),
    );
  });
});
