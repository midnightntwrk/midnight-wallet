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
import { expect } from 'vitest';
import { type NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { MidnightBech32m, ShieldedAddress, UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { type MidnightNetwork } from './types.js';

/**
 * Asserts the bech32m network prefix of `address` matches `expectedNetwork`.
 *
 * Replaces the old `TestContainersFixture.network` static read — the expected network is now an
 * explicit argument (typically `env.network`).
 */
export function validateNetworkInAddress(address: string, expectedNetwork: MidnightNetwork): void {
  const parsed = MidnightBech32m.parse(address);
  expect(parsed.network).toBe(expectedNetwork);
}

export function getShieldedAddress(networkId: NetworkId.NetworkId, walletAddress: ShieldedAddress): string {
  return ShieldedAddress.codec.encode(networkId, walletAddress).asString();
}

export function getUnshieldedAddress(networkId: NetworkId.NetworkId, walletAddress: UnshieldedAddress): string {
  return UnshieldedAddress.codec.encode(networkId, walletAddress).asString();
}
