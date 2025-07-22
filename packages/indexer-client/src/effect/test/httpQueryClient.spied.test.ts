import { Effect } from 'effect';
import { jest } from '@jest/globals';
import * as QueryClient from '../QueryClient';

jest.unstable_mockModule('graphql-http', () => ({
  createClient: jest.fn(),
}));

describe('HttpQueryClient', () => {
  describe('layer', () => {
    it('disposes of underlying scoped client', async () => {
      const graphqlHTTP = await import('graphql-http');
      const SpiedHttpQueryClient = await import('../HttpQueryClient');

      const dispose = jest.fn();
      const spiedCreateClient = jest
        .spyOn(graphqlHTTP, 'createClient')
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any
        .mockImplementationOnce(() => ({ dispose }) as any);

      await Effect.gen(function* () {
        const client = yield* QueryClient.QueryClient;

        expect(client).toBeDefined();
      }).pipe(
        Effect.provide(SpiedHttpQueryClient.layer({ url: 'http://localhost.com' })),
        Effect.scoped,
        Effect.runPromise,
      );

      expect(spiedCreateClient).toHaveBeenCalled();
      expect(dispose).toHaveBeenCalled();
    });
  });
});
