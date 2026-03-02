// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) 2025-2026 Midnight Foundation
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
import { Effect, Schema, ParseResult } from 'effect';

export const BigIntSchema = Schema.declare((input: unknown): input is bigint => typeof input === 'bigint').annotations({
  identifier: 'BigIntSchema',
});

export const SafeBigInt: Schema.Schema<bigint, string> = Schema.transformOrFail(Schema.String, BigIntSchema, {
  decode: (value) =>
    Effect.try({
      try: () => BigInt(value),
      catch: (err) => new ParseResult.Unexpected(err, 'Could not parse bigint'),
    }),
  encode: (value) => Effect.succeed(value.toString()),
});
