import { Effect, Stream } from 'effect';
import * as path from 'node:path';
import { DockerComposeEnvironment, Wait, type StartedDockerComposeEnvironment } from 'testcontainers';
import { randomUUID } from 'node:crypto';
import { WsSubscriptionClient } from '../../../effect';
import { ZswapEvents } from '../ZswapEvents';

const COMPOSE_PATH = path.resolve(new URL(import.meta.url).pathname, '../../../../../');

const timeout_minutes = (mins: number) => 1_000 * 60 * mins;

describe('ZSwap events subscription', () => {
  describe('with available Indexer Server', () => {
    const environmentId = randomUUID();
    let environment: StartedDockerComposeEnvironment | undefined = undefined;
    const getIndexerPort = () => environment?.getContainer(`indexer_${environmentId}`).getMappedPort(8088) ?? 8088;

    beforeAll(async () => {
      environment = await new DockerComposeEnvironment(COMPOSE_PATH, 'docker-compose.yml')
        .withEnvironment({
          TESTCONTAINERS_UID: environmentId,
        })
        .withWaitStrategy(`node_${environmentId}`, Wait.forListeningPorts())
        .withWaitStrategy(`indexer_${environmentId}`, Wait.forLogMessage(/block indexed/))
        .up();
    }, timeout_minutes(3));

    afterAll(async () => {
      await environment?.down();
    }, timeout_minutes(1));

    it(
      'should stream GraphQL subscription',
      async () => {
        await Effect.gen(function* () {
          const events = yield* ZswapEvents.run({
            id: 0,
          }).pipe(
            Stream.take(2),
            Stream.tap((data) => Effect.log(`ID=${data.zswapLedgerEvents.id}, MAX_ID=${data.zswapLedgerEvents.maxId}`)),
            Stream.runCollect,
          );

          expect(events).toHaveLength(2);
        }).pipe(
          Effect.provide(WsSubscriptionClient.layer({ url: `ws://127.0.0.1:${getIndexerPort()}/api/v1/graphql/ws` })),
          Effect.scoped,
          Effect.runPromise,
        );
      },
      timeout_minutes(1),
    );
  });
});
