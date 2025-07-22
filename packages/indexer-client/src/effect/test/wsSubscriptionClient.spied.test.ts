import { Effect } from 'effect';
import * as SubscriptionClient from '../SubscriptionClient';

vi.mock('graphql-ws', () => ({
  createClient: vi.fn(),
}));

describe('WsSubscriptionClient', () => {
  describe('layer', () => {
    it('disposes of underlying scoped client', async () => {
      const graphqlWS = await import('graphql-ws');
      const SpiedWsSubscriptionClient = await import('../WsSubscriptionClient');

      const dispose = vi.fn();
      const spiedCreateClient = vi
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
