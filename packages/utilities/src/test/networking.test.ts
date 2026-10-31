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
import { Either, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { HttpURL, type InvalidProtocolSchemeError, WsURL } from '../networking/index.js';

/** A client's URL parser, and a URL with a scheme it cannot dial. */
type SchemeCase = Readonly<{
  client: string;
  make: (url: string) => Either.Either<URL, InvalidProtocolSchemeError>;
  url: string;
  message: string;
}>;

describe('Refusing a URL whose scheme the client cannot dial', () => {
  // The refusal's message is what every error wrapping it repeats, up to the one a caller reads, so it has to say in
  // words which scheme was given and which were expected.
  it.each<SchemeCase>([
    {
      client: 'an HTTP',
      make: HttpURL.make,
      url: 'ftp://localhost:6300',
      message: "Invalid protocol scheme 'ftp:'. Expected 'http:' or 'https:'",
    },
    {
      client: 'a WebSocket',
      make: WsURL.make,
      url: 'http://localhost:9944',
      message: "Invalid protocol scheme 'http:'. Expected 'ws:' or 'wss:'",
    },
  ])('names the scheme $client client was handed and the ones it expects', ({ make, url, message }) => {
    const refusal = Either.getLeft(make(url)).pipe(
      Option.map((error) => ({ message: error.message, invalidScheme: error.invalidScheme })),
    );

    expect(refusal).toStrictEqual(Option.some({ message, invalidScheme: new URL(url).protocol }));
  });
});
