import { sampleIntentHash } from '@midnight-ntwrk/ledger-v6';
import { Chunk, Effect, Stream, Option } from 'effect';
import { UnshieldedState, UnshieldedTransaction, Utxo } from '../src/model';

export const generateMockTransaction = (
  owner: string,
  type: string,
  applyStage: 'SucceedEntirely' | 'FailEntirely',
  createdOutputsAmount: number,
  spentOutputsAmount: number,
): UnshieldedTransaction => {
  const createdOutputs = Array.from({ length: createdOutputsAmount }, () => generateMockUtxo(owner, type));

  const spentOutputs = Array.from({ length: spentOutputsAmount }, () => generateMockUtxo(owner, type));

  return {
    id: Math.floor(Math.random() * 1000),
    hash: crypto.randomUUID(),
    identifiers: createdOutputs.map((output) => output.intentHash),
    createdUtxos: createdOutputs,
    spentUtxos: spentOutputs,
    protocolVersion: 1,
    transactionResult: {
      status: applyStage,
      segments: [{ id: '1', success: true }],
    },
  };
};

export const generateMockUtxo = (owner: string, type: string): Utxo => ({
  value: BigInt(Math.ceil(Math.random() * 100)),
  owner,
  type,
  intentHash: sampleIntentHash(),
  outputNo: Math.floor(Math.random() * 100),
});

export const getLastStateValue = (
  state: Stream.Stream<UnshieldedState>,
): Effect.Effect<Option.Option<UnshieldedState>> =>
  state.pipe(Stream.take(1), Stream.runCollect).pipe(Effect.map(Chunk.head));

export const seedHex = (length: number = 64, seed: number = 42): string =>
  Array.from({ length }, (_, i) => ((seed + i) % 16).toString(16)).join('');

export const blockTime = (blockTime: Date): bigint => BigInt(Math.ceil(+blockTime / 1000));
