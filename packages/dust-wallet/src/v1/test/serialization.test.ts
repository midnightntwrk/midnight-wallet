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
import { DustSecretKey, LedgerParameters } from '@midnight-ntwrk/ledger-v8';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { EitherOps } from '@midnight-ntwrk/wallet-sdk-utilities';
import { Either, pipe } from 'effect';
import { describe, expect, it } from 'vitest';
import { CoreWallet } from '../CoreWallet.js';
import { makeDefaultV1SerializationCapability } from '../Serialization.js';
import { OtherWalletError } from '../WalletError.js';

const networkId = NetworkId.NetworkId.Undeployed;
const dustParameters = LedgerParameters.initialParameters().dust;
const seedHex = '0000000000000000000000000000000000000000000000000000000000000001';

describe('V1 dust wallet serialization', () => {
  it('serialize ◦ deserialize == id for empty wallet', () => {
    const capability = makeDefaultV1SerializationCapability();
    const dustSecretKey = DustSecretKey.fromSeed(Buffer.from(seedHex, 'hex'));
    const wallet = CoreWallet.initEmpty(dustParameters, dustSecretKey, networkId);

    const firstIteration = capability.serialize(wallet);
    const restored = pipe(capability.deserialize(null, firstIteration), EitherOps.getOrThrowLeft);
    const secondIteration = capability.serialize(restored);

    expect(firstIteration).toEqual(secondIteration);
  });

  it('returns Left with OtherWalletError for input that does not match the snapshot schema', () => {
    const capability = makeDefaultV1SerializationCapability();
    const result = capability.deserialize(null, '{"not":"a snapshot"}');

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left instanceof OtherWalletError).toBe(true);
    }
  });
});
