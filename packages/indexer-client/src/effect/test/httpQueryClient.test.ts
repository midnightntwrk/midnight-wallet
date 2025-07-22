import { Effect } from 'effect';
import * as QueryClient from '../QueryClient';
import * as HttpQueryClient from '../HttpQueryClient';

describe('HttpQueryClient', () => {
  describe('layer', () => {
    // Ensures that we cannot construct a layer for HttpQueryClient when we use common incorrect URI schemes.
    it.each(['ftp:', 'mailto:', 'ws:', 'wss:', 'file:'])(
      'should fail when constructed with %s as the URI scheme',
      async (scheme) => {
        await Effect.gen(function* () {
          // We should never be able to resolve a QueryClient since the configuration used to create the
          // associated HttpQueryClient layer is invalid with the protocol schemes being used.
          return yield* QueryClient.QueryClient;
        }).pipe(
          Effect.flatMap((_) => Effect.fail('Unexpectedly resolved a QueryClient')),
          Effect.provide(HttpQueryClient.layer({ url: `${scheme}//localhost.com` })),
          // Ensure the reported invalid protocol scheme is the one used.
          Effect.catchTag('InvalidProtocolSchemeError', (err) =>
            err.invalidScheme !== scheme
              ? Effect.fail(`Expected '${scheme}' but received '${err.invalidScheme}'`)
              : Effect.succeed(void 0),
          ),
          Effect.scoped,
          Effect.runPromise,
        );
      },
    );
  });
});
