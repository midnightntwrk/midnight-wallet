import { Effect, Stream } from 'effect';
import * as path from 'node:path';
import { DockerComposeEnvironment, type StartedDockerComposeEnvironment } from 'testcontainers';
import { randomUUID } from 'node:crypto';
import { Wallet } from '../Wallet';
import { Connect, Disconnect } from '../../queries';
import { WsSubscriptionClient, HttpQueryClient } from '../../../effect';

const COMPOSE_PATH = path.resolve(new URL(import.meta.url).pathname, '../../../../../../e2e-tests');

const KNOWN_VIEWING_KEY = 'mn_shield-esk_undeployed1qvqzp338tsl9e76kay06pyqyu60suelywytqux9c058mqhm6350smhczah53pj';

const timeout_minutes = (mins: number) => 1_000 * 60 * mins;

describe('Wallet subscription', () => {
  describe('with available Indexer Server', () => {
    const environmentId = randomUUID();
    let environment: StartedDockerComposeEnvironment | undefined = undefined;
    const getIndexerPort = () => environment?.getContainer(`indexer_${environmentId}`).getMappedPort(8088) ?? 8088;

    beforeAll(async () => {
      environment = await new DockerComposeEnvironment(COMPOSE_PATH, 'docker-compose-dynamic.yml')
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
        // eslint-disable-next-line prettier/prettier
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
          Effect.provide(HttpQueryClient.layer({ url: `http://127.0.0.1:${getIndexerPort()}/api/v1/graphql` })),
          Effect.provide(WsSubscriptionClient.layer({ url: `ws://127.0.0.1:${getIndexerPort()}/api/v1/graphql/ws` })),
          Effect.scoped,
          Effect.runPromise,
        );
      },
      timeout_minutes(1),
    );
  });
});
