// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) 2025 Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
// http://www.apache.org/licenses/LICENSE-2.0
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
import { Effect } from 'effect';
import { describe, it } from 'vitest';
import * as QueryClient from '../QueryClient.js';
import * as HttpQueryClient from '../HttpQueryClient.js';

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
