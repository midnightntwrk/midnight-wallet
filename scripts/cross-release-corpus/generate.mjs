// Regenerates the cross-release fixture corpus from a PINNED ledger-v8 release of the SDK.
//
// Why a separate install rather than a workspace package: the fixtures have to be written by the SDK as it actually
// shipped on ledger-v8, so this directory pins that release and resolves it from npm. The repository's own build
// must never be on the import path here, or the corpus would only ever prove that the current code agrees with itself.
//
// Every fixture records the versions that produced it, so a stale file cannot masquerade as a passing parity check.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import * as Shielded from '@midnightntwrk/wallet-sdk-shielded/v1';
import * as Unshielded from '@midnightntwrk/wallet-sdk-unshielded-wallet/v1';
import { PublicKey, createKeystore } from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import * as Dust from '@midnightntwrk/wallet-sdk-dust-wallet/v1';
import { ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';

const REPO_ROOT = new URL('../../', import.meta.url).pathname;
const outFor = (pkg) => join(REPO_ROOT, 'packages', pkg, 'test', 'fixtures', 'cross-release');
const NETWORK = 'undeployed';

const versionOf = (pkg) => JSON.parse(readFileSync(join('node_modules', pkg, 'package.json'), 'utf8')).version;

const provenance = {
  sdk: versionOf('@midnightntwrk/wallet-sdk'),
  shielded: versionOf('@midnightntwrk/wallet-sdk-shielded'),
  unshielded: versionOf('@midnightntwrk/wallet-sdk-unshielded-wallet'),
  dust: versionOf('@midnightntwrk/wallet-sdk-dust-wallet'),
  ledger: versionOf('@midnight-ntwrk/ledger-v8'),
};

// Dust's serializer is not in its package `exports` map, so it is reached by file path. Safe because the version is
// pinned: a repackaging upstream cannot move it under this directory's feet.
const dustSerializer = async () => {
  const url = new URL(
    './node_modules/@midnightntwrk/wallet-sdk-dust-wallet/dist/v1/Serialization.js',
    `file://${process.cwd()}/`,
  ).href;
  return (await import(url)).makeDefaultV1SerializationCapability();
};

// ── the wallets ───────────────────────────────────────────────────────────────────────────────────

const unshieldedKey = PublicKey.fromKeyStore(createKeystore(Buffer.alloc(32, 3), NETWORK));

const utxo = (intentHash, outputNo, value, registeredForDustGeneration) =>
  new Unshielded.UnshieldedState.UtxoWithMeta({
    utxo: { value, owner: unshieldedKey.addressHex, type: '01'.padEnd(64, '0'), intentHash, outputNo },
    meta: { ctime: new Date('2026-03-04T05:06:07.008Z'), registeredForDustGeneration },
  });

const unshieldedWallet = (available, pending, progress) =>
  Unshielded.CoreWallet.restore(
    Unshielded.UnshieldedState.UnshieldedState.restore(available, pending),
    unshieldedKey,
    progress,
    ProtocolVersion.MinSupportedVersion,
    NETWORK,
  );

const shieldedKeys = ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 5));
const shieldedCoin = (nonce, value) => ({ type: ledger.shieldedToken().raw, nonce: nonce.repeat(32), value });

const shieldedWallet = (coins) =>
  Shielded.CoreWallet.init(
    coins.reduce((state, coin) => state.insertCoin(shieldedKeys, coin), new ledger.ZswapLocalState()),
    shieldedKeys,
    NETWORK,
  );

const dustWallet = () =>
  Dust.CoreWallet.initEmpty(
    ledger.LedgerParameters.initialParameters().dust,
    ledger.DustSecretKey.fromSeed(Buffer.alloc(32, 7)),
    NETWORK,
  );

// ── the corpus ────────────────────────────────────────────────────────────────────────────────────

const shieldedSerializer = Shielded.Serialization.makeDefaultV1SerializationCapability();
const unshieldedSerializer = Unshielded.Serialization.makeDefaultV1SerializationCapability();

const corpus = [
  {
    pkg: 'unshielded-wallet',
    name: 'unshielded-funded',
    describes:
      'available and pending UTXOs on their own sides, a value beyond what a double holds exactly, both dust-registration states, and a sync cursor whose two indices differ',
    snapshot: () =>
      unshieldedSerializer.serialize(
        unshieldedWallet(
          [utxo('intent-available', 0, 9_007_199_254_740_993n, true)],
          [utxo('intent-pending', 1, 7n, false)],
          { appliedId: 42n, highestTransactionId: 99n },
        ),
      ),
  },
  {
    pkg: 'shielded-wallet',
    name: 'shielded-funded',
    describes: 'two coins in a real ledger-v8 commitment tree, with the hashes derived over them',
    snapshot: () => shieldedSerializer.serialize(shieldedWallet([shieldedCoin('bb', 100n), shieldedCoin('cc', 250n)])),
  },
  {
    pkg: 'dust-wallet',
    name: 'dust-empty',
    describes: 'a wallet that has seen nothing',
    snapshot: async () => (await dustSerializer()).serialize(dustWallet()),
  },
];

const byPackage = new Map();
for (const entry of corpus) {
  const snapshot = await entry.snapshot();
  const dir = outFor(entry.pkg);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${entry.name}.json`), snapshot);
  byPackage.set(entry.pkg, [
    ...(byPackage.get(entry.pkg) ?? []),
    { name: entry.name, describes: entry.describes, bytes: snapshot.length },
  ]);
  console.log(`${entry.pkg.padEnd(20)} ${entry.name.padEnd(20)} ${String(snapshot.length).padStart(6)} bytes`);
}

// One provenance file per package, beside the fixtures it describes, so a fixture and the versions that wrote it
// cannot be reviewed apart.
for (const [pkg, fixtures] of byPackage) {
  writeFileSync(
    join(outFor(pkg), 'provenance.json'),
    `${JSON.stringify({ generatedFrom: provenance, fixtures }, null, 2)}\n`,
  );
}
console.log(`\n${corpus.length} fixtures from wallet-sdk ${provenance.sdk} / ledger-v8 ${provenance.ledger}`);
