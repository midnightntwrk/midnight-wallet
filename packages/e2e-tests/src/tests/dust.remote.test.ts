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
//
// Thin shim: the dust scenario bodies live in @midnightntwrk/wallet-sdk-testkit. This file only
// wires the testcontainers environment + seeds and registers the suite.
import { type MidnightNetwork, useWalletTestEnvironment } from '@midnightntwrk/wallet-sdk-testkit';
import { createTestContainersEnvironment } from '@midnightntwrk/wallet-sdk-testkit/testcontainers';
import { registerDustHealthchecks } from '@midnightntwrk/wallet-sdk-testkit/scenarios';

const getEnv = useWalletTestEnvironment(() =>
  createTestContainersEnvironment({ network: process.env['NETWORK'] as MidnightNetwork }),
);

registerDustHealthchecks({
  getEnv,
  seed: process.env['SEED']!,
  syncCacheDir: process.env['SYNC_CACHE'],
});
