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
// Main entry point. Environment-agnostic harness: types, remote environment provisioning, wallet
// bootstrapping, sync waiters, tx-history assertions, address/seed helpers, and vitest glue.
//
// The Docker-backed environment lives at `@midnight-ntwrk/wallet-sdk-testkit/testcontainers` so it
// (and the `testcontainers` peer dependency) is only loaded when actually needed.
export * from './types.js';
export * from './logger.js';
export * from './environment.js';
export * from './network.js';
export * from './seeds.js';
export * from './primitives.js';
export * from './addresses.js';
export * from './state-waiters.js';
export * from './tx-history-asserts.js';
export * from './wallet.js';
export * from './vitest.js';
