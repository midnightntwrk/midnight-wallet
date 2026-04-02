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

// Re-export everything from SimulatorState
export {
  // State accessor functions (composable with simulator.query())
  getLastBlock,
  getCurrentBlockNumber,
  getCurrentTime,
  getBlockByNumber,
  getLastBlockResults,
  getLastBlockEvents,
  hasPendingTransactions,
  // State transformation functions
  resolveFullness,
  allMempoolTransactions,
  blankState,
  addToMempool,
  removeFromMempool,
  advanceTime,
  updateLedger,
  appendBlock,
  applyTransaction,
  // Block production functions
  processTransaction,
  processTransactions,
  createBlock,
  createEmptyBlock,
  type TransactionProcessingResult,
  // Helper functions
  createStrictness,
  blockHash,
  nextBlockContext,
  // Strictness constants
  defaultPostGenesisStrictness,
  genesisStrictness,
  // Types
  type SimulatorState,
  type Block,
  type BlockTransaction,
  type BlockInfo,
  type PendingTransaction,
  type BlockProductionRequest,
  type BlockProducer,
  type FullnessSpec,
  type GenesisMint,
  type StrictnessConfig,
} from './SimulatorState.js';

// Re-export from Simulator
export { Simulator, immediateBlockProducer, strictBlockProducer, type SimulatorConfig } from './Simulator.js';
