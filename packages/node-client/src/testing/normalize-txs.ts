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
import { Encoding } from 'effect';

type TxContainer = {
  tx: string;
  [key: string]: unknown;
};

type Batch = {
  txs: string[];
};

type TestTxFile = {
  initial_tx?: string;
  batches?: Batch[];
  unbalanced_tx?: string;
};

export function normalizeTxs(tx: string): {
  initial_tx: string;
  batches: string[];
} {
  const normalizedTxs: {
    initial_tx: string;
    batches: string[];
  } = {
    initial_tx: '',
    batches: [],
  };

  const data = JSON.parse(tx) as TestTxFile;

  if (data.initial_tx) {
    try {
      const inner = JSON.parse(data.initial_tx) as TxContainer;
      if (inner.tx) normalizedTxs.initial_tx = Encoding.encodeHex(inner.tx);
    } catch {
      throw Error('Failed to parse initial_tx');
    }
  } else {
    throw Error('initial_tx is missing');
  }

  for (const batch of data.batches ?? []) {
    for (const bufferTx of batch.txs ?? []) {
      try {
        const inner = JSON.parse(bufferTx) as TxContainer;
        if (inner.tx) {
          const txHex = Encoding.encodeHex(inner.tx);
          normalizedTxs.batches.push(txHex);
        }
      } catch {
        throw Error('Failed to parse batch tx');
      }
    }
  }

  return normalizedTxs;
}
