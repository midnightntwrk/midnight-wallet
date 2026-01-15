/*
 * This file is part of MIDNIGHT-WALLET-SDK.
 * Copyright (C) 2025 Midnight Foundation
 * SPDX-License-Identifier: Apache-2.0
 * Licensed under the Apache License, Version 2.0 (the "License");
 * You may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/* eslint-disable no-console */
import * as Wallet from './wallet.js';
import * as ui from './ui.js';
import { createRoot } from 'react-dom/client';
import React from 'react';
import * as rx from 'rxjs';
import { pick } from 'lodash-es';
import { Buffer } from 'buffer';

const seed = crypto.getRandomValues(Buffer.alloc(32));
const wallet = await Wallet.init(seed);

createRoot(document.getElementById('root')!).render(<ui.Main wallet={wallet.wallet} />);

wallet.wallet
  .state()
  .pipe(
    rx.filter((s) => s.isSynced),
    rx.tap((state) => {
      console.log('Synced state:', state);
      console.dir(
        {
          shielded: pick(state.shielded, [
            'balances',
            'availableCoins',
            'pendingCoins',
            'totalCoins',
            'progress',
            'transactionHistory',
            'coinPublicKey',
            'encryptionPublicKey',
            'address',
          ]),
          unshielded: pick(state.unshielded, [
            'balances',
            'availableCoins',
            'pendingCoins',
            'totalCoins',
            'progress',
            'transactionHistory',
            'address',
          ]),
          dust: pick(state.dust, [
            'totalCoins',
            'availableCoins',
            'pendingCoins',
            'progress',
            'dustPublicKey',
            'dustAddress',
          ]),
        },
        { depth: null },
      );
    }),
  )
  .subscribe();
