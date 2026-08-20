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

/**
 * Whether the wallets agree about which side of a protocol boundary they are on.
 *
 * @remarks
 *   The three wallets follow the same chain but not in lock-step: each learns of a protocol version change when its own
 *   synchronization reaches it. Between the first of them crossing and the last, the facade cannot act at one version,
 *   and an application that only reads `activeProtocolVersion` cannot tell that moment from an ordinary one. This is
 *   the reading that can — stated over the version signals the facade already has, and never over a wall clock.
 */
import { ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { describe, expect, it } from 'vitest';
import { protocolPhaseOf, type WalletProtocolVersions } from '../src/index.js';

const version = (value: bigint): ProtocolVersion.ProtocolVersion => ProtocolVersion.ProtocolVersion(value);

const forkVersion = version(2_000_000n);

const versions = (shielded: bigint, unshielded: bigint, dust: bigint): WalletProtocolVersions => ({
  shielded: version(shielded),
  unshielded: version(unshielded),
  dust: version(dust),
});

describe('a chain the wallets all read the same way', () => {
  it('is settled at the version they act at, when all three are before the boundary', () => {
    expect(protocolPhaseOf(versions(1n, 1n, 1n), forkVersion)).toStrictEqual({
      _tag: 'Settled',
      version: version(1n),
    });
  });

  it('is settled when all three are past the boundary', () => {
    expect(protocolPhaseOf(versions(2_000_000n, 2_000_001n, 2_000_000n), forkVersion)).toStrictEqual({
      _tag: 'Settled',
      version: version(2_000_000n),
    });
  });

  it('is settled while they differ inside one epoch, because a difference there changes nothing', () => {
    // Two versions on the same side of the boundary are the same ledger version, so a wallet lagging within the
    // epoch is ordinary synchronization rather than a crossing.
    expect(protocolPhaseOf(versions(1n, 5n, 3n), forkVersion)).toStrictEqual({
      _tag: 'Settled',
      version: version(1n),
    });
  });

  it('is settled on a chain with no boundary at all, whatever the wallets report', () => {
    expect(protocolPhaseOf(versions(1n, 9n, 4n), ProtocolVersion.MinSupportedVersion)).toStrictEqual({
      _tag: 'Settled',
      version: version(1n),
    });
  });
});

describe('a chain the wallets are still crossing', () => {
  it('is crossing while any one of them is behind the boundary and any other is past it', () => {
    expect(protocolPhaseOf(versions(2_000_000n, 1n, 2_000_000n), forkVersion)).toStrictEqual({
      _tag: 'Crossing',
      from: version(1n),
      to: version(2_000_000n),
      behind: ['unshielded'],
    });
  });

  it('names every wallet still behind, so an application can say which one it is waiting for', () => {
    expect(protocolPhaseOf(versions(2_000_000n, 1n, 3n), forkVersion)).toStrictEqual({
      _tag: 'Crossing',
      from: version(1n),
      to: version(2_000_000n),
      behind: ['unshielded', 'dust'],
    });
  });

  it('reports the version the facade acts at as the one the laggards are still on', () => {
    // `from` is what `activeProtocolVersion` answers, and deliberately so: it is the version the facade is bound to
    // until the crossing finishes, and the one anything it builds meanwhile is stamped with.
    const crossing = protocolPhaseOf(versions(1n, 2_000_000n, 2_000_000n), forkVersion);

    expect(crossing._tag).toBe('Crossing');
    expect(crossing._tag === 'Crossing' && crossing.from).toBe(version(1n));
  });
});
