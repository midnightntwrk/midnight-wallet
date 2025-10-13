import { Effect, Stream } from 'effect';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import { DockerComposeEnvironment, Wait, type StartedDockerComposeEnvironment } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WsSubscriptionClient } from '../../../effect/index.js';
import { UnshieldedTransactions } from '../UnshieldedTransactions.js';

const COMPOSE_PATH = path.resolve(new URL(import.meta.url).pathname, '../../../../../');

const timeout_minutes = (mins: number) => 1_000 * 60 * mins;

const ADDRESS = 'mn_addr_undeployed1rhqz8aq6t74ym2uq5gh53t9x02gducxnamtdvnjxfhelxwaf8ztqpmrwwj';

describe('Wallet subscription', () => {
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
          const events = yield* UnshieldedTransactions.run({
            address: ADDRESS,
            transactionId: 0,
          }).pipe(
            Stream.take(2),
            Stream.tap((data) => Effect.log(data.unshieldedTransactions.type)),
            Stream.runCollect,
          );

          expect(events).toHaveLength(2);
        }).pipe(
          Effect.provide(WsSubscriptionClient.layer({ url: `ws://127.0.0.1:${getIndexerPort()}/api/v3/graphql/ws` })),
          Effect.scoped,
          Effect.runPromise,
        );
      },
      timeout_minutes(1),
    );
  });
});
