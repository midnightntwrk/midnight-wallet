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
import type { CoreWallet } from './CoreWallet.js';
import {
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
} from '@midnight-ntwrk/wallet-sdk-address-format';

export type KeysCapability<TState> = {
  getCoinPublicKey(state: TState): ShieldedCoinPublicKey;
  getEncryptionPublicKey(state: TState): ShieldedEncryptionPublicKey;
  getAddress(state: TState): ShieldedAddress;
};

export const makeDefaultKeysCapability = (): KeysCapability<CoreWallet> => {
  return {
    getCoinPublicKey: (state: CoreWallet): ShieldedCoinPublicKey => {
      return new ShieldedCoinPublicKey(Buffer.from(state.publicKeys.coinPublicKey, 'hex'));
    },
    getEncryptionPublicKey: (state: CoreWallet): ShieldedEncryptionPublicKey => {
      return new ShieldedEncryptionPublicKey(Buffer.from(state.publicKeys.encryptionPublicKey, 'hex'));
    },
    getAddress: (state: CoreWallet): ShieldedAddress => {
      const coinPublicKey = new ShieldedCoinPublicKey(Buffer.from(state.publicKeys.coinPublicKey, 'hex'));
      const encryptionPublicKey = new ShieldedEncryptionPublicKey(
        Buffer.from(state.publicKeys.encryptionPublicKey, 'hex'),
      );
      return new ShieldedAddress(coinPublicKey, encryptionPublicKey);
    },
  };
};
