import * as Wallet from './wallet.js';
import * as ui from './ui.js';
import { createRoot } from 'react-dom/client';
import React from 'react';
import * as rx from 'rxjs';
import { pick } from 'lodash-es';
import { Buffer } from 'buffer';

createRoot(document.getElementById('root')!).render(<ui.Main />);

const seed = crypto.getRandomValues(Buffer.alloc(32));
const wallet = await Wallet.init(seed);

wallet.wallet.state().pipe(
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
);
