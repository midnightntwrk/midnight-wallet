import { Effect, Stream } from 'effect';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import { DockerComposeEnvironment, Wait, type StartedDockerComposeEnvironment } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HttpQueryClient, WsSubscriptionClient } from '../../../effect/index.js';
import { Connect, Disconnect } from '../../queries/index.js';
import { ShieldedTransactions } from '../ShieldedTransactions.js';

const COMPOSE_PATH = path.resolve(new URL(import.meta.url).pathname, '../../../../../');

const KNOWN_VIEWING_KEY =
  'mn_shield-esk_undeployed1d45kgmnfva58gwn9de3hy7tsw35k7m3dwdjkxun9wskkketetdmrzhf6dlyj7u8juj68fd4psnkqhjxh32sec0q480vzswg8kd485e2kljcsmxqc0u';

const timeout_minutes = (mins: number) => 1_000 * 60 * mins;

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
        .withWaitStrategy(`indexer_${environmentId}`, Wait.forListeningPorts())
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
            Stream.take(2),
            Stream.tap((data) => Effect.log(data.shieldedTransactions.__typename)),
            Stream.runCollect,
          );

          expect(events).toHaveLength(2);
        }).pipe(
          Effect.provide(HttpQueryClient.layer({ url: `http://127.0.0.1:${getIndexerPort()}/api/v3/graphql` })),
          Effect.provide(WsSubscriptionClient.layer({ url: `ws://127.0.0.1:${getIndexerPort()}/api/v3/graphql/ws` })),
          Effect.scoped,
          Effect.runPromise,
        );
      },
      timeout_minutes(1),
    );
  });
});
