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
import {
  InMemoryTransactionHistoryStorage,
  NetworkId,
  ProtocolVersion,
  type VariantState,
} from '@midnightntwrk/wallet-sdk-abstractions';
import { type Equal, type Expect } from '@midnightntwrk/wallet-sdk-utilities/types';
import { Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { UnshieldedWallet } from '../UnshieldedWallet.js';
import { UnshieldedWalletState } from '../UnshieldedWalletAPI.js';
import { CoreWallet as V1CoreWallet, coreStateOf as v1CoreStateOf, V1Tag } from '../v1/index.js';
import { TransactionHistory, CoreWallet as V2CoreWallet, coreStateOf as v2CoreStateOf, V2Tag } from '../v2/index.js';
import { v1Identity, v2Identity } from './forkTimeline.js';

const networkId = NetworkId.NetworkId.Undeployed;
const v9 = ProtocolVersion.ProtocolVersion(7n);

/** The variants a default unshielded wallet registers, each standing in as the capabilities that read its own state. */
const variants = UnshieldedWallet({
  networkId,
  indexerClientConnection: { indexerHttpUrl: 'http://localhost:8088/api/v4/graphql' },
  txHistoryStorage: new InMemoryTransactionHistoryStorage(TransactionHistory.UnshieldedTransactionHistoryEntrySchema),
  forks: { v9 },
}).allVariantsRecord();

const v1Core = V1CoreWallet.init(v1Identity(networkId), networkId);
const v2Core = V2CoreWallet.init(v2Identity(networkId), networkId);

/** The wallet state an unshielded wallet emits for each variant, built where the producing variant is known. */
const fromV1 = UnshieldedWalletState.fromVariant(variants[V1Tag].variant, {
  version: ProtocolVersion.ProtocolVersion(5n),
  variantTag: V1Tag,
  state: v1Core,
});
const fromV2 = UnshieldedWalletState.fromVariant(variants[V2Tag].variant, {
  version: v9,
  variantTag: V2Tag,
  state: v2Core,
});

describe('the core state an unshielded wallet state carries', () => {
  it("names no ledger version, being sealed rather than typed as either variant's", () => {
    type _1 = Expect<Equal<UnshieldedWalletState['state'], VariantState>>;
  });

  it('is handed to the V2 variant when the V2 variant produced it', () => {
    expect(Option.getOrUndefined(v2CoreStateOf(fromV2))).toBe(v2Core);
  });

  it('is handed to the V1 variant when the V1 variant produced it', () => {
    expect(Option.getOrUndefined(v1CoreStateOf(fromV1))).toBe(v1Core);
  });

  it('is not handed to a variant that did not produce it, whose ledger version could not read it', () => {
    expect(v1CoreStateOf(fromV2)).toStrictEqual(Option.none());
    expect(v2CoreStateOf(fromV1)).toStrictEqual(Option.none());
  });

  it('still reports the progress of whichever variant produced it', () => {
    expect(fromV1.progress).toBe(v1Core.progress);
    expect(fromV2.progress).toBe(v2Core.progress);
  });
});

describe('the verifying key an unshielded wallet state reports', () => {
  it("is the V2 variant's own key when the V2 variant produced the state", () => {
    expect(fromV2.verifyingKey).toStrictEqual(v2Identity(networkId).publicKey);
  });

  it("is the same identity in the SDK's signature shape when the V1 variant produced the state", () => {
    // Both identities come from one secret; ledger-v8 writes the key as bare hex, and the state names its scheme.
    expect(fromV1.verifyingKey).toStrictEqual({ tag: 'schnorr', value: v1Identity(networkId).publicKey });
    expect(fromV1.verifyingKey).toStrictEqual(fromV2.verifyingKey);
  });
});
