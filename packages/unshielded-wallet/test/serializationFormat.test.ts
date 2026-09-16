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
import { NetworkId } from '@midnightntwrk/wallet-sdk-abstractions';
import { Either } from 'effect';
import { describe, expect, it } from 'vitest';
import { CoreWallet } from '../src/v1/CoreWallet.js';
import { makeDefaultV1SerializationCapability } from '../src/v1/Serialization.js';

const publicKey = {
  publicKey: '0000000000000000000000000000000000000000000000000000000000000001',
  addressHex: '0000000000000000000000000000000000000000000000000000000000000002',
  address: 'mn_addr_undeployed1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
};

describe('V1 unshielded snapshot format version', () => {
  const capability = makeDefaultV1SerializationCapability();
  const emptyWallet = () => CoreWallet.init(publicKey, NetworkId.NetworkId.Undeployed);

  /** A snapshot as written before the format version existed: today's fields, with no `version` among them. */
  const withoutVersion = (serialized: string): string => {
    const { version: _version, ...rest } = JSON.parse(serialized) as Record<string, unknown>;
    return JSON.stringify(rest);
  };

  it('should stamp the current format version into every snapshot it writes', () => {
    const written: unknown = JSON.parse(capability.serialize(emptyWallet()));

    expect(written).toMatchObject({ version: 'v1' });
  });

  it('should read a snapshot that carries no version as the first format', () => {
    const restored = capability.deserialize(withoutVersion(capability.serialize(emptyWallet())));

    expect(Either.isRight(restored)).toBe(true);
  });

  it('should refuse a snapshot whose version this build does not know', () => {
    const fromANewerSdk = JSON.stringify({
      ...(JSON.parse(capability.serialize(emptyWallet())) as Record<string, unknown>),
      version: 'v2',
    });

    const restored = capability.deserialize(fromANewerSdk);

    expect(Either.isLeft(restored)).toBe(true);
  });

  it('should name the surface and the version it found when it refuses a snapshot', () => {
    const fromANewerSdk = JSON.stringify({
      ...(JSON.parse(capability.serialize(emptyWallet())) as Record<string, unknown>),
      version: 'v2',
    });

    const restored = capability.deserialize(fromANewerSdk);
    const failure = Either.isLeft(restored) ? restored.left.message : 'the snapshot was restored';

    expect(failure).toContain(
      'Refusing an unshielded snapshot written in format version "v2": this build reads v1 and does not downgrade.',
    );
  });

  it('should round-trip a wallet through serialize and deserialize unchanged', () => {
    const first = capability.serialize(emptyWallet());

    const restored = capability.deserialize(first);
    const second = Either.isRight(restored) ? capability.serialize(restored.right) : 'did not restore';

    expect(second).toEqual(first);
  });
});
