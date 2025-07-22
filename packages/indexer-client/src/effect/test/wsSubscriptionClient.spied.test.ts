import { Effect } from 'effect';
import { jest } from '@jest/globals';
import * as SubscriptionClient from '../SubscriptionClient';

jest.unstable_mockModule('graphql-ws', () => ({
  createClient: jest.fn(),
}));

describe('WsSubscriptionClient', () => {
  describe('layer', () => {
    it('disposes of underlying scoped client', async () => {
      const graphqlWS = await import('graphql-ws');
      const SpiedWsSubscriptionClient = await import('../WsSubscriptionClient');

      const dispose = jest.fn();
      const spiedCreateClient = jest
        .spyOn(graphqlWS, 'createClient')
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any
        .mockImplementationOnce(() => ({ dispose }) as any);

      await Effect.gen(function* () {
        const client = yield* SubscriptionClient.SubscriptionClient;

        expect(client).toBeDefined();
      }).pipe(
        Effect.provide(SpiedWsSubscriptionClient.layer({ url: 'ws://localhost.com' })),
        Effect.scoped,
        Effect.runPromise,
      );

      expect(spiedCreateClient).toHaveBeenCalled();
      expect(dispose).toHaveBeenCalled();
    });
  });
});
