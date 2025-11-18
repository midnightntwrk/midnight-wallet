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
import { Either } from 'effect';
import * as Brand from 'effect/Brand';
import { InvalidProtocolSchemeError } from './URLError.js';

/**
 * A 'HTTP' URL.
 */
export type WsURL = Brand.Branded<URL, 'WsURL'>;
/**
 * Constructs a 'WS' URL from a source URL, ensuring that the protocol is correct.
 */
export const WsURL = Brand.refined<WsURL>(
  (url) => url.protocol === 'ws:' || url.protocol === 'wss:',
  (url) => Brand.error(`Invalid protocol scheme '${url.protocol}'. Expected 'ws:' or 'wss:'`),
);

/**
 * Constructs a new {@link WsURL} from a given string.
 *
 * @param url The URL to be made into a WebSocket URL.
 * @returns An `Either` that represents the valid WebSocket URL constructed from `url`; or an
 * {@link InvalidProtocolSchemeError}.
 */
export const make: (url: URL | string) => Either.Either<WsURL, InvalidProtocolSchemeError> = (url) => {
  const targetURL = new URL(url);
  try {
    return Either.right(WsURL(targetURL));
  } catch (err: unknown) {
    return Either.left(new InvalidProtocolSchemeError({ message: String(err), invalidScheme: targetURL.protocol }));
  }
};
