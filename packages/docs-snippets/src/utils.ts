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
import type * as ledger from '@midnightntwrk/wallet-sdk/ledger/v9';
import {
  type DefaultConfiguration,
  DustWallet,
  InMemoryTransactionHistoryStorage,
  WalletEntrySchema,
  WalletFacade,
  ShieldedWallet,
  createKeystore,
  PublicKey as UnshieldedPublicKey,
  UnshieldedWallet,
  type UnshieldedKeystore,
  WalletSeeds,
  mergeWalletEntries,
  ProtocolVersion,
} from '@midnightntwrk/wallet-sdk';
import { type Buffer } from 'buffer';

const INDEXER_PORT = Number.parseInt(process.env['INDEXER_PORT'] ?? '8088', 10);
const NODE_PORT = Number.parseInt(process.env['NODE_PORT'] ?? '9944', 10);
const PROOF_SERVER_PORT = Number.parseInt(process.env['PROOF_SERVER_PORT'] ?? '6300', 10);
// The proof server built against ledger-v8, for the chain's history below `forks.v9`. Never contacted on a chain
// that has been on ledger-v9 since genesis, like the one this runs against.
const V8_PROOF_SERVER_PORT = Number.parseInt(process.env['V8_PROOF_SERVER_PORT'] ?? '6301', 10);
const INDEXER_HTTP_URL = `http://localhost:${INDEXER_PORT}/api/v4/graphql`;
const INDEXER_WS_URL = `ws://localhost:${INDEXER_PORT}/api/v4/graphql/ws`;

export const configuration: DefaultConfiguration = {
  networkId: 'undeployed',
  // The protocol version this chain hands over to ledger-v9 at. A 2.x node reports 2000000;
  // the final mainnet fork constant is not yet fixed, so this is supplied per environment.
  forks: { v9: ProtocolVersion.V9NativeForkVersion },
  costParameters: {
    feeBlocksMargin: 5,
  },
  relayURL: new URL(`ws://localhost:${NODE_PORT}`),
  // One proof server per ledger version, keyed the way `forks` is: `v8` answers below `forks.v9`, `v9` from it. A
  // transaction is proved by the backend for the ledger version that authored its bytes, so the wallet proves on either
  // side of the fork and across it. `hard-fork-support.ts` explains the shape in full.
  provers: {
    v8: { kind: 'server', url: new URL(`http://localhost:${V8_PROOF_SERVER_PORT}`) },
    v9: { kind: 'server', url: new URL(`http://localhost:${PROOF_SERVER_PORT}`) },
  },
  indexerClientConnection: {
    indexerHttpUrl: INDEXER_HTTP_URL,
    indexerWsUrl: INDEXER_WS_URL,
  },
  txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
};

export const initWalletWithSeed = async (
  seed: Buffer,
): Promise<{
  wallet: WalletFacade;
  seeds: WalletSeeds;
  unshieldedKeystore: UnshieldedKeystore;
}> => {
  // One master seed, three wallet seeds. A seed is the only key material that crosses a protocol boundary, so this is
  // what lets one wallet follow the chain through a fork.
  const seeds = WalletSeeds.fromMasterSeed(seed);

  const unshieldedKeystore = createKeystore({ kind: 'schnorr', secret: seeds.unshielded }, configuration.networkId);

  const wallet: WalletFacade = await WalletFacade.init({
    configuration,
    shielded: (config) => ShieldedWallet(config).startWithSeed(seeds.shielded),
    unshielded: (config) =>
      UnshieldedWallet(config).startWithPublicKey(UnshieldedPublicKey.fromKeyStore(unshieldedKeystore)),
    dust: (config) => DustWallet(config).startWithSeed(seeds.dust),
  });

  await wallet.start(seeds);

  return { wallet, seeds, unshieldedKeystore };
};

export const aFakeProvingProvider: ledger.ProvingProvider = {
  check(_serializedPreimage: Uint8Array, _keyLocation: string): Promise<(bigint | undefined)[]> {
    return Promise.resolve([]);
  },
  prove(_serializedPreimage: Uint8Array, _keyLocation: string, _overwriteBindingInput?: bigint): Promise<Uint8Array> {
    return Promise.resolve(new Uint8Array(0));
  },
  lookupKey(_keyLocation: string): Promise<ledger.ProvingKeyMaterial | undefined> {
    return Promise.resolve(undefined);
  },
};
