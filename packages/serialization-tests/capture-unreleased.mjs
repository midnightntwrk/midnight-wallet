// Captures a `facade-unreleased` train from the CURRENT workspace code: the format the NEXT release
// will ship. Run it whenever the format-drift gate goes red on an intentional change.
//
//   yarn capture:unreleased        (from the repo root — builds dist first, then runs this)
//   node capture-unreleased.mjs    (from this package — assumes `yarn dist` already ran)
//
// How: take the newest PUBLISHED train's fixtures and drive each through the current public
// restore -> serialize round trip — exactly what the format-drift gate does to compute "current
// output" — then freeze that as fixtures/facade-unreleased/. The drift gate baseline
// (DRIFT_BASELINE in fixtures.ts) points at it, so the gate goes green again while still catching any
// FURTHER format change. It is intentionally NOT a compat train: compat only tests bytes a real
// published version wrote. At release, reconcile-train.mjs renames it to facade-<the actual bump>.
import { readdirSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { firstValueFrom } from 'rxjs';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { Either } from 'effect';
import { NetworkId, InMemoryTransactionHistoryStorage } from '@midnightntwrk/wallet-sdk-abstractions';
import { ShieldedWallet } from '@midnightntwrk/wallet-sdk-shielded';
import { UnshieldedWallet } from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import { DustWallet } from '@midnightntwrk/wallet-sdk-dust-wallet';
import { WalletEntrySchema, mergeWalletEntries } from '@midnightntwrk/wallet-sdk-facade';
import { PendingTransactions } from '@midnightntwrk/wallet-sdk-capabilities';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, 'fixtures');
const UNRELEASED = 'facade-unreleased';

// Endpoints are never dialled — restore() decodes eagerly and start() is never called.
const dummyConnections = {
  indexerClientConnection: {
    indexerHttpUrl: 'http://localhost:1/api/v4/graphql',
    indexerWsUrl: 'ws://localhost:1/api/v4/graphql/ws',
  },
};
const txHistoryStorage = () => new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries);
const walletArgs = { ...dummyConnections, networkId: NetworkId.NetworkId.Undeployed };
const shieldedWallet = () => ShieldedWallet({ ...walletArgs, txHistoryStorage: txHistoryStorage() });
const unshieldedWallet = () => UnshieldedWallet({ ...walletArgs, txHistoryStorage: txHistoryStorage() });
const dustWallet = () =>
  DustWallet({ ...walletArgs, costParameters: { feeBlocksMargin: 5 }, txHistoryStorage: txHistoryStorage() });

// Mirrors the facade's finalizedTransactionTrait — the same deserialize the production restore uses.
const txTrait = {
  isTx: (tx) => tx instanceof ledger.Transaction,
  serialize: (tx) => tx.serialize(),
  deserialize: (bytes) => ledger.Transaction.deserialize('signature', 'proof', 'binding', bytes),
  ids: (tx) => [...tx.identifiers()],
  firstId: (tx) => tx.identifiers()[0],
  areAllTxIdsIncluded: (tx, txIds) => tx.identifiers().every((id) => txIds.includes(id)),
  isOneIncludedInOther: (tx, otherTx) => tx.identifiers().some((id) => otherTx.identifiers().includes(id)),
  hasTTLExpired: () => false,
};

// Each persisted kind's current restore -> serialize round trip, keyed by fixture name.
const reserialize = {
  shielded: async (s) => (await firstValueFrom(shieldedWallet().restore(s).state)).serialize(),
  'shielded-receiver': async (s) => (await firstValueFrom(shieldedWallet().restore(s).state)).serialize(),
  'shielded-pending': async (s) => (await firstValueFrom(shieldedWallet().restore(s).state)).serialize(),
  'shielded-deep': async (s) => (await firstValueFrom(shieldedWallet().restore(s).state)).serialize(),
  unshielded: async (s) => (await firstValueFrom(unshieldedWallet().restore(s).state)).serialize(),
  'unshielded-minimal': async (s) => (await firstValueFrom(unshieldedWallet().restore(s).state)).serialize(),
  dust: async (s) => (await firstValueFrom(dustWallet().restore(s).state)).serialize(),
  'tx-history': async (s) => InMemoryTransactionHistoryStorage.restore(s, WalletEntrySchema).serialize(),
  'pending-transactions': async (s) =>
    PendingTransactions.serialize(Either.getOrThrow(PendingTransactions.deserialize(s, txTrait)), txTrait),
};

const versionParts = (train) => train.replace('facade-', '').split('.').map(Number);
const bySemver = (a, b) => {
  const [pa, pb] = [versionParts(a), versionParts(b)];
  const diff = pa.findIndex((n, i) => n !== (pb[i] ?? 0));
  return diff === -1 ? pa.length - pb.length : pa[diff] - (pb[diff] ?? 0);
};

const publishedTrains = readdirSync(FIXTURES, { withFileTypes: true })
  .filter((e) => e.isDirectory() && e.name.startsWith('facade-') && e.name !== UNRELEASED)
  .map((e) => e.name)
  .sort(bySemver);
const source = publishedTrains[publishedTrains.length - 1];
if (source === undefined) throw new Error('no published train to capture from');

const facadeVersion = JSON.parse(readFileSync(path.join(HERE, '..', 'facade', 'package.json'), 'utf8')).version;

const outDir = path.join(FIXTURES, UNRELEASED);
mkdirSync(outDir, { recursive: true });

console.log(`Capturing ${UNRELEASED} from ${source} (workspace facade ${facadeVersion})`);
const names = Object.keys(reserialize).filter((name) => existsSync(path.join(FIXTURES, source, `${name}.json`)));
for (const name of names) {
  const src = JSON.parse(readFileSync(path.join(FIXTURES, source, `${name}.json`), 'utf8'));
  const serialized = await reserialize[name](src.serialized);
  JSON.parse(serialized); // self-check: current output is well-formed JSON
  const fixture = { ...src, train: UNRELEASED, version: facadeVersion, capturedFrom: src.train, serialized };
  writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(fixture, null, 2) + '\n');
  console.log(`  wrote ${UNRELEASED}/${name}.json`);
}
console.log('Done.');
