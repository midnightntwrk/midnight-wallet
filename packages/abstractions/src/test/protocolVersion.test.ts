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

  describe('V9NativeForkVersion', () => {
    it('is the version a midnight-node 2.x reports on its ledger events, 2000000', () => {
      expect(ProtocolVersion.V9NativeForkVersion).toBe(2_000_000n);
      expect(ProtocolVersion.is(ProtocolVersion.V9NativeForkVersion)).toBeTruthy();
    });

    it('lies strictly inside the supported range, so it splits it into two non-empty epochs', () => {
      expect(ProtocolVersion.V9NativeForkVersion).toBeGreaterThan(ProtocolVersion.MinSupportedVersion);
      expect(ProtocolVersion.V9NativeForkVersion).toBeLessThan(ProtocolVersion.MaxSupportedVersion);
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

describe('ForkSchedule', () => {
  it('names where each ledger version after the first begins, keyed by ledger version', () => {
    const schedule: ProtocolVersion.ForkSchedule = { v9: ProtocolVersion.V9NativeForkVersion };
    expect(schedule.v9).toBe(ProtocolVersion.V9NativeForkVersion);
  });

  it('has no entry for ledger-v8, which begins at MinSupportedVersion', () => {
    // A type-level fact stated as a value: were `v8` a key, this annotation would be `true` and the assignment would
    // not compile.
    const v8Scheduled: 'v8' extends keyof ProtocolVersion.ForkSchedule ? true : false = false;
    expect(v8Scheduled).toBe(false);
  });
});

describe('V9NativeForkSchedule', () => {
  it('has ledger-v9 begin at V9NativeForkVersion, and says nothing else', () => {
    expect(ProtocolVersion.V9NativeForkSchedule).toStrictEqual({ v9: ProtocolVersion.V9NativeForkVersion });
  });

  it('is a ForkSchedule, so a configuration can name it where it would otherwise write the literal', () => {
    const schedule: ProtocolVersion.ForkSchedule = ProtocolVersion.V9NativeForkSchedule;
    expect(schedule.v9).toBe(ProtocolVersion.V9NativeForkVersion);
  });
});
