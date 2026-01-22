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
import { FileSystem } from '@effect/platform';
import { Effect, type Scope } from 'effect';
import path from 'path';
import { type StartedNetwork } from 'testcontainers';
import { TestTransactions } from '@midnight-ntwrk/wallet-sdk-node-client/testing';
import { type PlatformError } from '@effect/platform/Error';
import { NodeContext } from '@effect/platform-node';
import * as ledger from '@midnight-ntwrk/ledger-v7';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';

const paths = new (class {
  currentDir = path.dirname(new URL(import.meta.url).pathname);
  outputPath = path.resolve(this.currentDir, 'tmp');
  fileName = 'test-txs.json';
})();

export const getTestTxsPath = (fileName: string = paths.fileName): string => `${paths.outputPath}/${fileName}`;

export const makeFakeTx = (
  value: bigint,
): ledger.Transaction<ledger.SignatureEnabled, ledger.PreProof, ledger.PreBinding> => {
  const shieldedTokenType = ledger.shieldedToken();
  const recipient = ledger.ZswapSecretKeys.fromSeed(new Uint8Array(32).fill(0));
  const coin = ledger.createShieldedCoinInfo(shieldedTokenType.raw, value);
  const unprovenOutput = ledger.ZswapOutput.new(coin, 0, recipient.coinPublicKey, recipient.encryptionPublicKey);
  const unprovenOffer = ledger.ZswapOffer.fromOutput(unprovenOutput, shieldedTokenType.raw, value);
  return ledger.Transaction.fromParts(NetworkId.NetworkId.Undeployed, unprovenOffer);
};

const cleanDir = () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.remove(getTestTxsPath(), { force: true, recursive: true });
  });

export const generateTxs = (
  nodeUrl: string,
  proofServerUrl: string,
  network: StartedNetwork,
  fileName: string = paths.fileName,
): Effect.Effect<void, Error | PlatformError, Scope.Scope> =>
  Effect.gen(function* () {
    yield* cleanDir();
    yield* TestTransactions.generateTestTransactions(nodeUrl, proofServerUrl, network, paths.outputPath, fileName);
  }).pipe(Effect.provide(NodeContext.layer));
