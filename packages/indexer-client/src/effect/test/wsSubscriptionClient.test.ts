import { Effect } from 'effect';
import { describe, it } from 'vitest';
import * as SubscriptionClient from '../SubscriptionClient.js';
import * as WsSubscriptionClient from '../WsSubscriptionClient.js';

describe('WsSubscriptionClient', () => {
  describe('layer', () => {
    // Ensures that we cannot construct a layer for WsSubscriptionClient when we use common incorrect URI schemes.
    it.each(['ftp:', 'mailto:', 'http:', 'https:', 'file:'])(
      'should fail when constructed with %s as the URI scheme',
      async (scheme) => {
        await Effect.gen(function* () {
          // We should never be able to resolve a SubscriptionClient since the configuration used to create the
          // associated WsSubscriptionClient layer is invalid with the protocol schemes being used.
          return yield* SubscriptionClient.SubscriptionClient;
        }).pipe(
          Effect.flatMap((_) => Effect.fail('Unexpectedly resolved a SubscriptionClient')),
          Effect.provide(WsSubscriptionClient.layer({ url: `${scheme}//localhost.com` })),
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
