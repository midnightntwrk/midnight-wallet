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
export type HttpUrl = Brand.Branded<URL, 'HttpURL'>;
/**
 * Constructs a 'HTTP' URL from a source URL, ensuring that the protocol is correct.
 */
export const HttpURL = Brand.refined<HttpUrl>(
  (url) => url.protocol === 'http:' || url.protocol === 'https:',
  (url) => Brand.error(`Invalid protocol scheme '${url.protocol}'. Expected 'http:' or 'https:'`),
);

/**
 * Constructs a new {@link HttpURL} from a given string.
 *
 * @param url The URL to be made into a HTTP URL.
 * @returns An `Either` that represents the valid HTTP URL constructed from `url`; or an
 * {@link InvalidProtocolSchemeError}.
 */
export const make: (url: URL | string) => Either.Either<HttpUrl, InvalidProtocolSchemeError> = (url) => {
  const targetURL = new URL(url);
  try {
    return Either.right(HttpURL(targetURL));
  } catch (err: unknown) {
    return Either.left(new InvalidProtocolSchemeError({ message: String(err), invalidScheme: targetURL.protocol }));
  }
};
