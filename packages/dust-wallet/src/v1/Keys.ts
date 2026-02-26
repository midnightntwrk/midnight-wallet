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
import { DustPublicKey } from '@midnight-ntwrk/ledger-v7';
import { DustAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { CoreWallet } from './CoreWallet.js';

export type KeysCapability<TState> = {
  getPublicKey(state: TState): DustPublicKey;
  getAddress(state: TState): DustAddress;
};

export const makeDefaultKeysCapability = (): KeysCapability<CoreWallet> => {
  return {
    getPublicKey: (state: CoreWallet): DustPublicKey => {
      return state.publicKey.publicKey;
    },
    getAddress: (state: CoreWallet): DustAddress => {
      return new DustAddress(state.publicKey.publicKey);
    },
  };
};
