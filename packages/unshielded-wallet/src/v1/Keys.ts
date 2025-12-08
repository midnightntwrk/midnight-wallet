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
import { UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import type { CoreWallet } from './CoreWallet.js';
import { SignatureVerifyingKey } from '@midnight-ntwrk/ledger-v6';

export type KeysCapability<TState> = {
  getPublicKey(state: TState): SignatureVerifyingKey;
  getAddress(state: TState): UnshieldedAddress;
};

export const makeDefaultKeysCapability = (): KeysCapability<CoreWallet> => {
  return {
    getPublicKey: (state: CoreWallet): SignatureVerifyingKey => {
      return state.publicKey.publicKey;
    },
    getAddress: (state: CoreWallet): UnshieldedAddress => {
      return new UnshieldedAddress(Buffer.from(state.publicKey.address, 'hex'));
    },
  };
};
