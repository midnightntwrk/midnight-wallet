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
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { expect } from 'vitest';
import { type NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { ShieldedAddress, UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { TestContainersFixture } from '../test-fixture.js';

export function validateNetworkInAddress(address: string) {
  switch (TestContainersFixture.network) {
    case 'testnet':
      expect(address).toContain('test');
      break;
    case 'devnet':
      expect(address).toContain('dev');
      break;
    case 'undeployed':
      expect(address).toContain('undeployed');
      break;
  }
}

export function getShieldedAddress(networkId: NetworkId.NetworkId, walletAddress: ShieldedAddress): string {
  return ShieldedAddress.codec.encode(networkId, walletAddress).asString();
}

export function getUnshieldedAddress(networkId: NetworkId.NetworkId, walletAddress: UnshieldedAddress): string {
  return UnshieldedAddress.codec.encode(networkId, walletAddress).asString();
}
