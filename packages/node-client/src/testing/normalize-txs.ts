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
