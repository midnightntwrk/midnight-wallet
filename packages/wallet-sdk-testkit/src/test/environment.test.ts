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
import { describe, expect, it } from 'vitest';
import { parseMidnightNetwork } from '../environment.js';

describe('parseMidnightNetwork', () => {
  it.each(['undeployed', 'qanet', 'devnet', 'preview', 'preprod', 'stagenet'] as const)('should read %s', (network) => {
    expect(parseMidnightNetwork(network)).toBe(network);
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['an unknown name', 'mainnet'],
    ['a different case', 'Preview'],
  ])(
    'should reject a network that is %s, naming it, rather than fail later on endpoints it has no preset for',
    (_case, raw) => {
      expect(() => parseMidnightNetwork(raw)).toThrow(`Unrecognized network: ${String(raw)}`);
    },
  );
});
