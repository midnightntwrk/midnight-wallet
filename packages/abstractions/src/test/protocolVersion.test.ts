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
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import * as ProtocolVersion from '../ProtocolVersion.js';

describe('ProtocolVersion', () => {
  describe('is', () => {
    it('should return true for valid values', () => {
      expect(ProtocolVersion.is(100n)).toBeTruthy();
      expect(ProtocolVersion.is(ProtocolVersion.ProtocolVersion(100n))).toBeTruthy();
    });

    it('should return false for invalid values', () => {
      expect(ProtocolVersion.is('some-string')).toBeFalsy();
      expect(ProtocolVersion.is(100)).toBeFalsy();
      expect(ProtocolVersion.is(100.0)).toBeFalsy();
      expect(ProtocolVersion.is({ protocolVersion: 100n })).toBeFalsy();
    });
  });

  it.each([ProtocolVersion.MinSupportedVersion, ProtocolVersion.MaxSupportedVersion])(
    'should be encodable and decodable',
    (input) => {
      const encodedString = Schema.encodeSync(ProtocolVersion.ProtocolVersionSchema)(input);

      expect(encodedString).toBe(Number(input).toString());

      const protocolVersion = Schema.decodeSync(ProtocolVersion.ProtocolVersionSchema)(encodedString);

      expect(ProtocolVersion.is(protocolVersion)).toBeTruthy();
      expect(protocolVersion).toBe(input);
    },
  );
});
