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
import { Effect, Layer, Stream } from 'effect';
import { buildTestEnvironmentVariables, getComposeDirectory } from '@midnight-ntwrk/wallet-sdk-utilities/testing';
import { DockerComposeEnvironment, type StartedDockerComposeEnvironment } from 'testcontainers';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HttpQueryClient, WsSubscriptionClient } from '@midnight-ntwrk/wallet-sdk-indexer-client/effect';
import { Connect, Disconnect, ShieldedTransactions } from '@midnight-ntwrk/wallet-sdk-indexer-client';

const KNOWN_VIEWING_KEY = 'mn_shield-esk_undeployed1qqpsq87f9ac09e95wjm2rp8vp0yd0z4pns7p2w7c9qus0vm20fj4dl93nu709t';

const timeout_minutes = (mins: number) => 1_000 * 60 * mins;

const environmentId = randomUUID();

const environmentVars = buildTestEnvironmentVariables(
  [
    'APP_INFRA_SECRET',
    'APP_INFRA_STORAGE_PASSWORD',
    'APP_INFRA_PUB_SUB_PASSWORD',
    'APP_INFRA_LEDGER_STATE_STORAGE_PASSWORD',
  ],
  {
    additionalVars: {
      TESTCONTAINERS_UID: environmentId,
    },
  },
);

const environment = new DockerComposeEnvironment(getComposeDirectory(), 'docker-compose-dynamic.yml').withEnvironment(
  environmentVars,
);

// TODO: This is replicating the tests from indexer client, it should be rewritten to use the wallet sync service instead
describe.skip('Wallet subscription', () => {
  describe('with available Indexer Server', () => {
    let startedEnvironment: StartedDockerComposeEnvironment | undefined = undefined;
    const getIndexerPort = () =>
      startedEnvironment?.getContainer(`indexer_${environmentId}`).getMappedPort(8088) ?? 8088;

    beforeAll(async () => {
      startedEnvironment = await environment.up();
    }, timeout_minutes(3));

    afterAll(async () => {
      await startedEnvironment?.down();
    }, timeout_minutes(1));

    it(
      'should stream GraphQL subscription',
      async () => {
        const makeScopedSession = Effect.acquireRelease(Connect.run({ viewingKey: KNOWN_VIEWING_KEY }), (session) =>
          Disconnect.run({ sessionId: session.connect }).pipe(Effect.catchAll((_) => Effect.void)),
        );

        await Effect.gen(function* () {
          const session = yield* makeScopedSession;
          const events = yield* ShieldedTransactions.run({
            sessionId: session.connect,
            index: null,
          }).pipe(
            Stream.take(5),
            Stream.tap((data) => Effect.log(data.shieldedTransactions.__typename)),
            Stream.runCollect, // collect the elements into a single chunk.
          );

          expect(events).toHaveLength(5);
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              HttpQueryClient.layer({ url: `http://127.0.0.1:${getIndexerPort()}/api/v3/graphql` }),
              WsSubscriptionClient.layer({ url: `ws://127.0.0.1:${getIndexerPort()}/api/v3/graphql/ws` }),
            ),
          ),
          Effect.scoped,
          Effect.runPromise,
        );
      },
      timeout_minutes(1),
    );
  });
});
