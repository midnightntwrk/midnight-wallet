import { FileSystem } from '@effect/platform';
import { Effect, Scope } from 'effect';
import path from 'path';
import { StartedNetwork } from 'testcontainers';
import { TestTransactions } from '@midnight-ntwrk/wallet-sdk-node-client/testing';
import { PlatformError } from '@effect/platform/Error';
import { NodeContext } from '@effect/platform-node';
import * as ledger from '@midnight-ntwrk/ledger';

const paths = new (class {
  currentDir = path.dirname(new URL(import.meta.url).pathname);
  outputPath = path.resolve(this.currentDir, 'tmp');
  fileName = 'test-txs.json';
})();

export const getTestTxsPath = (fileName: string = paths.fileName): string => `${paths.outputPath}/${fileName}`;

export const makeFakeTx = (
  value: bigint,
): ledger.Transaction<ledger.SignatureEnabled, ledger.PreProof, ledger.PreBinding> => {
  const shieldedTokenType = ledger.shieldedToken() as unknown as { type: 'shielded'; raw: string };
  const recipient = ledger.ZswapSecretKeys.fromSeed(new Uint8Array(32).fill(0));
  const coin = ledger.createShieldedCoinInfo(shieldedTokenType.raw, value);
  const unprovenOutput = ledger.ZswapOutput.new(coin, 0, recipient.coinPublicKey, recipient.encryptionPublicKey);
  const unprovenOffer = ledger.ZswapOffer.fromOutput(unprovenOutput, shieldedTokenType.raw, value);
  return ledger.Transaction.fromParts(unprovenOffer);
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
