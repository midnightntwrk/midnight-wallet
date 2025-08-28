import { Effect, Layer, Stream } from 'effect';
import * as path from 'node:path';
import { existsSync } from 'node:fs';
import { DockerComposeEnvironment, type StartedDockerComposeEnvironment } from 'testcontainers';
import { randomUUID } from 'node:crypto';
import { HttpQueryClient, WsSubscriptionClient } from '@midnight-ntwrk/wallet-sdk-indexer-client/effect';
import { Connect, Disconnect, Wallet } from '@midnight-ntwrk/wallet-sdk-indexer-client';

const COMPOSE_PATH = path.resolve(new URL(import.meta.url).pathname, '../../../../../e2e-tests');

const KNOWN_VIEWING_KEY = 'mn_shield-esk_undeployed1qvqzp338tsl9e76kay06pyqyu60suelywytqux9c058mqhm6350smhczah53pj';

const timeout_minutes = (mins: number) => 1_000 * 60 * mins;

describe('Wallet subscription', () => {
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
          const events = yield* Wallet.run({ sessionId: session.connect, index: null }).pipe(
            Stream.take(5),
            Stream.tap((data) => Effect.log(data.wallet.__typename)),
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
