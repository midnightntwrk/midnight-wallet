// This file is part of MIDNIGHT-WALLET-SDK.
import { Bindingish, Intent, Proofish, Signaturish, Transaction } from '@midnight-ntwrk/ledger-v7';
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
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { pipe, Iterable as Iter, Number as Num } from 'effect';

export const getDustSeed = (seed: string): Uint8Array<ArrayBufferLike> => {
  const seedBuffer = Buffer.from(seed, 'hex');
  const hdWalletResult = HDWallet.fromSeed(seedBuffer);

  const { hdWallet } = hdWalletResult as {
    type: 'seedOk';
    hdWallet: HDWallet;
  };

  const derivationResult = hdWallet.selectAccount(0).selectRole(Roles.Dust).deriveKeyAt(0);

  if (derivationResult.type === 'keyOutOfBounds') {
    throw new Error('Key derivation out of bounds');
  }

  return derivationResult.key;
};

export const sumUtxos = (
  tx: Transaction<Signaturish, Proofish, Bindingish>,
  section: 'guaranteed' | 'fallible',
  type: 'input' | 'output',
): number => {
  return pipe(
    tx,
    (tx) => tx.intents ?? new Map<number, Intent<Signaturish, Proofish, Bindingish>>(),
    (intentsMap) => intentsMap.values(),
    Iter.map((intent) =>
      section === 'guaranteed' ? intent.guaranteedUnshieldedOffer : intent.fallibleUnshieldedOffer,
    ),
    Iter.map((maybeOffer) => (type == 'input' ? maybeOffer?.inputs : maybeOffer?.outputs)),
    Iter.map((maybeUtxos) => maybeUtxos?.length ?? 0),
    Iter.reduce(0, Num.sum),
  );
};
