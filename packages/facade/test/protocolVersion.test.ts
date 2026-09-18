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
import { ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { describe, expect, it } from 'vitest';
import { lowestProtocolVersion, type WalletProtocolVersions } from '../src/index.js';

const version = (value: bigint): ProtocolVersion.ProtocolVersion => ProtocolVersion.ProtocolVersion(value);

const versions = (shielded: bigint, unshielded: bigint, dust: bigint): WalletProtocolVersions => ({
  shielded: version(shielded),
  unshielded: version(unshielded),
  dust: version(dust),
});

describe('lowestProtocolVersion', () => {
  it('is the version all three wallets have reached when they agree', () => {
    expect(lowestProtocolVersion(versions(9n, 9n, 9n))).toBe(version(9n));
  });

  it('is the lowest of the three while they disagree, whichever wallet is behind', () => {
    // A transaction spans all three wallets, so the one still on the older protocol version bounds
    // what the facade as a whole can do — no matter which one it is.
    expect(lowestProtocolVersion(versions(8n, 9n, 9n))).toBe(version(8n));
    expect(lowestProtocolVersion(versions(9n, 8n, 9n))).toBe(version(8n));
    expect(lowestProtocolVersion(versions(9n, 9n, 8n))).toBe(version(8n));
  });

  it('is the lowest even when more than one wallet is behind', () => {
    expect(lowestProtocolVersion(versions(8n, 8n, 9n))).toBe(version(8n));
    expect(lowestProtocolVersion(versions(2n, 5n, 3n))).toBe(version(2n));
  });

  it('handles the minimum supported version without treating it as absent', () => {
    expect(lowestProtocolVersion(versions(0n, 9n, 9n))).toBe(ProtocolVersion.MinSupportedVersion);
  });
});
