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
// Barrel re-exporting helpers/* so existing test files can keep their
// `import * as utils from './utils.js'` namespace import unchanged.
// Prefer importing directly from `./helpers/<module>` in new code.
export * from './helpers/walletInit.js';
// Dust sync model selection lives in the testkit, which documents the one-shot contract that makes
// `manualSync` mandatory. Only the ready-made options object is needed here; import the factories from
// `@midnightntwrk/wallet-sdk-testkit/core` directly if a test ever needs to build its own pairing.
export { projectionsDustSyncOptions } from '@midnightntwrk/wallet-sdk-testkit/core';
export * from './helpers/seeds.js';
export * from './helpers/addresses.js';
export * from './helpers/stateWaiters.js';
export * from './helpers/txHistoryAsserts.js';
export * from './helpers/network.js';
export * from './helpers/primitives.js';
