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
import { DustInitialNonce, DustNullifier, DustNonce, DustPublicKey, Utxo } from '@midnight-ntwrk/ledger-v7';

export type DustToken = {
  initialValue: bigint;
  owner: DustPublicKey;
  nonce: DustNonce;
  seq: number;
  ctime: Date;
  backingNight: DustInitialNonce;
  mtIndex: bigint;
};

export type DustTokenWithNullifier = DustToken & {
  nullifier: DustNullifier;
};

export type DustTokenFullInfo = {
  token: DustToken;
  dtime: Date | undefined;
  maxCap: bigint; // maximum capacity (gen.value * night_dust_ratio)
  maxCapReachedAt: Date; // ctime + timeToCapSeconds
  generatedNow: bigint;
  rate: bigint; // the slope of generation and decay for a specific dust UTXO (gen.value * generation_decay_rate)
};

export type DustGenerationInfo = {
  value: bigint;
  owner: DustPublicKey;
  nonce: DustInitialNonce;
  dtime: Date | undefined;
};

export type UtxoWithMeta = Utxo & { ctime: Date };
