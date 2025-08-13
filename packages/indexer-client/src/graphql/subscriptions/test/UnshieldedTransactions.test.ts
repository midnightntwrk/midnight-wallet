import { Effect, Stream } from 'effect';
import * as path from 'node:path';
import { DockerComposeEnvironment, type StartedDockerComposeEnvironment } from 'testcontainers';
import { randomUUID } from 'node:crypto';
import { WsSubscriptionClient } from '../../../effect';
import { UnshieldedTransactions } from '../UnshieldedTransactions';

const COMPOSE_PATH = path.resolve(new URL(import.meta.url).pathname, '../../../../../');

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
            address: 'mn_addr_undeployed1h3ssm5ru2t6eqy4g3she78zlxn96e36ms6pq996aduvmateh9p9sk96u7s',
            transactionId: 0,
          }).pipe(
            Stream.take(2),
            Stream.tap((data) => Effect.log(data.unshieldedTransactions.type)),
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
