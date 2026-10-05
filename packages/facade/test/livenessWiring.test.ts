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
import * as ledger from '@midnightntwrk/ledger-v9';
import { type FinalizedTx, InMemoryTransactionHistoryStorage, NetworkId } from '@midnightntwrk/wallet-sdk-abstractions';
import { type SubmissionService } from '@midnightntwrk/wallet-sdk-capabilities';
import { DustWallet } from '@midnightntwrk/wallet-sdk-dust-wallet';
import { ShieldedWallet } from '@midnightntwrk/wallet-sdk-shielded';
import {
  createKeystore,
  PublicKey,
  resolveNodeEndpoint,
  UnshieldedWallet,
} from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import { Option } from 'effect';
import { NEVER } from 'rxjs';
import * as crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { type DefaultConfiguration, mergeWalletEntries, WalletEntrySchema, WalletFacade } from '../src/index.js';

// Injected so `init` never builds the default submission service: that would open a real node client on `relayURL`
// with an infinite reconnection timeout, leaving a WebSocket reconnect loop running for the rest of the worker. A unit
// test may not touch the network, and this test is about configuration plumbing, not submission.
const fakeSubmission: SubmissionService<FinalizedTx> = {
  // `Promise<never>` satisfies every overload of the method type; a bare `Promise.reject` is typed to the last one only.
  submitTransaction: (): Promise<never> => Promise.reject(new Error('This submission implementation does not submit')),
  close: () => Promise.resolve(),
};

/**
 * A configuration of the shape an integrator actually writes: a `relayURL` for submission, and no
 * `nodeClientConnection`.
 */
const configuration: DefaultConfiguration = {
  networkId: NetworkId.NetworkId.Undeployed,
  relayURL: new URL('ws://localhost:9944'),
  indexerClientConnection: {
    indexerHttpUrl: 'http://localhost:8088/api/v4/graphql',
  },
  provingServerUrl: new URL('http://localhost:6300'),
  costParameters: {
    feeBlocksMargin: 0,
  },
  txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
};

/**
 * `vi.mockObject` does not carry accessors across, and a wallet's `state` is one. The facade watches every wallet's
 * state from the moment it is built, so a double without one is not a wallet.
 */
const withState = <TMocked>(mocked: TMocked, state: unknown): TMocked => {
  Object.defineProperty(mocked, 'state', { get: () => state, configurable: true });
  return mocked;
};

describe('indexer liveness wiring through the facade', () => {
  it('should hand the unshielded wallet a configuration the liveness check can read a node from', async () => {
    // The check was originally reachable only by setting `nodeClientConnection`, which nothing set — so no wallet built
    // through the facade ever ran it, while the release notes implied otherwise. Nothing caught that, because every other
    // facade test runs in simulation mode, whose sync service never consults a node at all. This asserts the wiring
    // itself: whatever the facade passes to the unshielded initializer must yield an endpoint to check against.
    const seed = crypto.randomBytes(32);
    const configurations: DefaultConfiguration[] = [];

    await WalletFacade.init({
      configuration,
      submissionService: () => fakeSubmission,
      shielded: async (config) => {
        const wallet = await ShieldedWallet(config).startWithSeed(seed);
        const shielded = withState(vi.mockObject(wallet), wallet.state);
        shielded.start.mockResolvedValue(undefined);
        return shielded;
      },
      unshielded: async (config) => {
        configurations.push(config);
        const wallet = await UnshieldedWallet(config).startWithPublicKey(
          PublicKey.fromKeyStore(createKeystore({ kind: 'schnorr', secret: seed }, config.networkId)),
        );
        // The facade watches this stream for the moment sync reaches the tip; this wallet never gets there.
        const unshielded = withState(vi.mockObject(wallet), NEVER);
        unshielded.start.mockResolvedValue(undefined);
        return unshielded;
      },
      dust: async (config) => {
        const wallet = await DustWallet(config).startWithSeed(seed, ledger.LedgerParameters.initialParameters().dust);
        const dust = withState(vi.mockObject(wallet), wallet.state);
        dust.start.mockResolvedValue(undefined);
        return dust;
      },
    });

    expect(configurations).toHaveLength(1);
    expect(configurations.map((config) => Option.isSome(resolveNodeEndpoint(config)))).toStrictEqual([true]);
  });

  it('should resolve the submission node, so no second endpoint has to be configured', () => {
    expect(resolveNodeEndpoint(configuration)).toStrictEqual(Option.some({ nodeURL: 'ws://localhost:9944/' }));
  });
});
