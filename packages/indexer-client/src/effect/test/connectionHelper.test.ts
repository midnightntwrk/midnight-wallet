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
import { Either } from 'effect';
import { describe, expect, it } from 'vitest';
import { createWebSocketUrl, deriveWebSocketUrl } from '../ConnectionHelper.js';

const right = (e: Either.Either<string, unknown>) => (Either.isRight(e) ? e.right : undefined);

describe('deriveWebSocketUrl', () => {
  it('flips http→ws and https→wss', () => {
    expect(right(deriveWebSocketUrl('http://example.com/api'))).toBe('ws://example.com/api/ws');
    expect(right(deriveWebSocketUrl('https://example.com/api'))).toBe('wss://example.com/api/ws');
  });

  it('appends /ws regardless of whether the input path ends with a slash', () => {
    expect(right(deriveWebSocketUrl('http://example.com/api'))).toBe('ws://example.com/api/ws');
    expect(right(deriveWebSocketUrl('http://example.com/api/'))).toBe('ws://example.com/api/ws');
  });
});

describe('createWebSocketUrl', () => {
  it('returns the provided wsUrl as-is, ignoring httpUrl', () => {
    expect(right(createWebSocketUrl('http://example.com/api', 'ws://override.example/custom'))).toBe(
      'ws://override.example/custom',
    );
  });

  it('falls back to deriveWebSocketUrl when wsUrl is undefined', () => {
    expect(right(createWebSocketUrl('https://example.com/api'))).toBe('wss://example.com/api/ws');
  });
});
