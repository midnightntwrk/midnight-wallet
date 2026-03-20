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

/**
 * Re-export unified Simulator from capabilities package.
 *
 * The Simulator has been unified into the capabilities package to avoid
 * duplication across dust-wallet, shielded-wallet, and unshielded-wallet.
 *
 * This re-export maintains backwards compatibility for existing imports.
 */
export {
  Simulator,
  // State accessor functions (composable with simulator.query())
  getLastBlock,
  getCurrentBlockNumber,
  getBlockByNumber,
  getLastBlockResults,
  getLastBlockEvents,
  // Types
  type SimulatorState,
  type SimulatorConfig,
  type Block,
  type BlockTransaction,
  type BlockInfo,
  type GenesisMint,
  type StrictnessConfig,
} from '@midnight-ntwrk/wallet-sdk-capabilities/simulation';
