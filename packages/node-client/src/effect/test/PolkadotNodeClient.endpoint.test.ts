// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) Midnight Foundation
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
import { Cause, Effect, Exit, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { PolkadotNodeClient } from '../PolkadotNodeClient.js';

/**
 * The real `@polkadot/api`, unmocked: `WsProvider` refuses an endpoint that is not `ws://` or `wss://` by throwing from
 * its constructor, before it opens anything, so no node is needed. A file of its own because the other unit tests of
 * `make()` mock the whole module, and with it the constructor's check.
 */
describe('PolkadotNodeClient.make with an endpoint the provider refuses', () => {
  it('should fail with a ConnectionError rather than die, so a caller can handle a misconfigured node URL', async () => {
    const exit = await Effect.runPromiseExit(
      Effect.scoped(PolkadotNodeClient.make({ nodeURL: new URL('http://localhost:9944') })),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    const failure = Exit.isFailure(exit) ? Cause.failureOption(exit.cause) : Option.none<{ _tag: string }>();
    expect(Option.map(failure, (error) => error._tag)).toEqual(Option.some('ConnectionError'));
  });
});
