import { Effect, Layer, Stream } from 'effect';
import * as path from 'node:path';
import { existsSync } from 'node:fs';
import { DockerComposeEnvironment, type StartedDockerComposeEnvironment } from 'testcontainers';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HttpQueryClient, WsSubscriptionClient } from '@midnight-ntwrk/wallet-sdk-indexer-client/effect';
import { Connect, Disconnect, ShieldedTransactions } from '@midnight-ntwrk/wallet-sdk-indexer-client';

const COMPOSE_PATH = path.resolve(new URL(import.meta.url).pathname, '../../../../../e2e-tests');

const KNOWN_VIEWING_KEY = 'mn_shield-esk_undeployed1qqpsq87f9ac09e95wjm2rp8vp0yd0z4pns7p2w7c9qus0vm20fj4dl93nu709t';

const timeout_minutes = (mins: number) => 1_000 * 60 * mins;

// TODO: This is replicating the tests from indexer client, it should be rewritten to use the wallet sync service instead
describe.skip('Wallet subscription', () => {
  describe('with available Indexer Server', () => {
    const environmentId = randomUUID();
    let environment: StartedDockerComposeEnvironment | undefined = undefined;
    const getIndexerPort = () => environment?.getContainer(`indexer_${environmentId}`).getMappedPort(8088) ?? 8088;
    const composeFile = 'docker-compose-dynamic.yml';
    const composeFullPath = path.join(COMPOSE_PATH, composeFile);
    if (!existsSync(composeFullPath)) {
      throw new Error(`Docker compose file not found: ${composeFile}`);
    }

    beforeAll(async () => {
      environment = await new DockerComposeEnvironment(COMPOSE_PATH, composeFile)
        .withEnvironment({
          TESTCONTAINERS_UID: environmentId,
        })
        .up();
    }, timeout_minutes(3));

    afterAll(async () => {
      await environment?.down();
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
              HttpQueryClient.layer({ url: `http://127.0.0.1:${getIndexerPort()}/api/v1/graphql` }),
              WsSubscriptionClient.layer({ url: `ws://127.0.0.1:${getIndexerPort()}/api/v1/graphql/ws` }),
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
