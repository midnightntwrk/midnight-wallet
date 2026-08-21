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

/*
 * The wallet across a hard fork.
 *
 * The SDK runs one ledger version below the chain's `forkVersion` and another from it, and each of the three wallets
 * registers a variant either side. Nothing here is a migration an application performs: a wallet started from a seed
 * follows the chain across the boundary on its own. What an application does have to do is say where the boundary is,
 * read which side of it the wallets are on, and — if it authors its own transactions — author for the right side.
 *
 * This file demonstrates, in the order the code runs:
 *
 * 1. version-keyed proving configuration (`provingServers`)
 * 2. the seed-first start, which is the primary and the only one that crosses a fork
 * 3. the both-keys escape hatch (`startWithKeys`), for a caller that will not part with a seed
 * 4. reading the protocol phase off the state (`Settled` / `Crossing`)
 * 5. finding transactions the fork orphaned (`PendingStatus.Orphaned`)
 * 6. restoring a snapshot without throwing (`tryRestore`)
 * 7. the facade refusing a transaction authored on the other side of the boundary
 *
 * It runs against a chain that is already past the boundary, so sections 4 and 5 report the settled, nothing-orphaned
 * case. Section 7 is the pre-fork behaviour demonstrated live: the refusal it prints is the same one an application
 * would get for a post-fork transaction offered to a chain that has not yet forked, with the versions the other way
 * round.
 */
import { V9_NATIVE_FORK_VERSION } from '@midnightntwrk/wallet-sdk-shielded';
import {
  createKeystore,
  type DefaultConfiguration,
  DustWallet,
  type FacadeKeysByEpoch,
  InMemoryTransactionHistoryStorage,
  mergeWalletEntries,
  ProtocolVersion,
  ProtocolVersionMismatchError,
  PublicKey,
  ShieldedWallet,
  UnshieldedWallet,
  WalletEntrySchema,
  WalletFacade,
  WalletSeeds,
  WalletTransaction,
} from '@midnightntwrk/wallet-sdk';
import * as preForkLedger from '@midnightntwrk/wallet-sdk/ledger/v8';
import * as ledger from '@midnightntwrk/wallet-sdk/ledger/v9';
import { Buffer } from 'buffer';
import { Either } from 'effect';

const INDEXER_PORT = Number.parseInt(process.env['INDEXER_PORT'] ?? '8088', 10);
const NODE_PORT = Number.parseInt(process.env['NODE_PORT'] ?? '9944', 10);
const PROOF_SERVER_PORT = Number.parseInt(process.env['PROOF_SERVER_PORT'] ?? '6300', 10);
const INDEXER_HTTP_URL = `http://localhost:${INDEXER_PORT}/api/v4/graphql`;
const INDEXER_WS_URL = `ws://localhost:${INDEXER_PORT}/api/v4/graphql/ws`;

// ---------------------------------------------------------------------------------------------------------------------
// 1. Version-keyed proving configuration
// ---------------------------------------------------------------------------------------------------------------------

const configuration: DefaultConfiguration = {
  networkId: 'undeployed',
  // The protocol version this chain hands over to the post-fork ledger at. A 2.x node reports 2000000;
  // the final mainnet fork constant is not yet fixed, so this is supplied per environment.
  forkVersion: V9_NATIVE_FORK_VERSION,
  costParameters: {
    feeBlocksMargin: 5,
  },
  relayURL: new URL(`ws://localhost:${NODE_PORT}`),
  // Proof servers keyed by the protocol version each starts serving, in ascending order. A transaction is proved by
  // the server registered for the version its own bytes were authored at, so a fork landing between building a
  // transaction and proving it cannot send it to the wrong prover. `provingServerUrl: url` is the single-server form
  // and means exactly `[{ sinceVersion: ProtocolVersion.MinSupportedVersion, url }]` — one server for every version.
  //
  // A pre-fork entry would point at a proof server built against the pre-fork ledger: a separate external deployment,
  // not yet available, which is why the line below is commented out rather than pointed somewhere. Without it, this
  // configuration can prove nothing below `forkVersion` — which is correct for a chain already past it, and is what an
  // application still expecting pre-fork traffic has to add.
  provingServers: [
    { sinceVersion: V9_NATIVE_FORK_VERSION, url: new URL(`http://localhost:${PROOF_SERVER_PORT}`) },
    // { sinceVersion: ProtocolVersion.MinSupportedVersion, url: new URL('http://localhost:6301') },
  ],
  indexerClientConnection: {
    indexerHttpUrl: INDEXER_HTTP_URL,
    indexerWsUrl: INDEXER_WS_URL,
  },
  txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
};

// ---------------------------------------------------------------------------------------------------------------------
// 2. The seed-first start
// ---------------------------------------------------------------------------------------------------------------------

// One master seed, three wallet seeds. A seed is the only key material that crosses a protocol boundary — every ledger
// version derives its own keys from the same seed and arrives at the same identity — so this is what lets one wallet
// follow the chain through a fork.
const seeds = WalletSeeds.fromMasterSeed(
  Buffer.from('0000000000000000000000000000000000000000000000000000000000000001', 'hex'),
);
const unshieldedKeystore = createKeystore({ kind: 'schnorr', secret: seeds.unshielded }, configuration.networkId);

// The starts are asynchronous because choosing where to begin means asking the chain: each wallet probes the indexer
// for the protocol version the chain is on and starts directly at the variant that owns it. Without an answer it
// begins pre-fork — where a wallet with no history belongs — and is handed over on the first batch that reports a
// post-fork version. Nothing about the probe can make a start fail.
const wallet: WalletFacade = await WalletFacade.init({
  configuration,
  shielded: (config) => ShieldedWallet(config).startWithSeed(seeds.shielded),
  unshielded: (config) => UnshieldedWallet(config).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
  dust: (config) => DustWallet(config).startWithSeed(seeds.dust),
});
await wallet.start(seeds);
const state = await wallet.waitForSyncedState();

// ---------------------------------------------------------------------------------------------------------------------
// 3. The both-keys escape hatch
// ---------------------------------------------------------------------------------------------------------------------

// For a caller that holds key objects rather than a seed. BOTH sides are required, and that is the whole point: key
// objects belong to one ledger version's runtime and neither can be derived from the other, so a wallet given one side
// alone could not read the other side of the chain. A product with one side optional would make that foot-gun
// representable, so there isn't one. The cost is exactly what is written below — an import of both ledger packages and
// the same derivation performed twice, which is why `wallet-sdk/ledger/v8` and `/v9` exist. A seed costs neither.
const keysByEpoch: FacadeKeysByEpoch = {
  v8: {
    shielded: preForkLedger.ZswapSecretKeys.fromSeed(seeds.shielded),
    dust: preForkLedger.DustSecretKey.fromSeed(seeds.dust),
  },
  v9: {
    shielded: ledger.ZswapSecretKeys.fromSeed(seeds.shielded),
    dust: ledger.DustSecretKey.fromSeed(seeds.dust),
  },
};

// `facade.start(keysByEpoch)` accepts that whole product in place of the seeds. Per wallet the shape is the same, one
// key object per side: `DustWallet(config).startWithKeys({ v8: keysByEpoch.v8.dust, v9: keysByEpoch.v9.dust })`.
const shieldedFromKeys = await ShieldedWallet(configuration).startWithKeys({
  v8: keysByEpoch.v8.shielded,
  v9: keysByEpoch.v9.shielded,
});
console.log(
  'Both-keys start reaches the same shielded identity as the seed?',
  (await shieldedFromKeys.getAddress()).equals(await wallet.shielded.getAddress()),
);
await shieldedFromKeys.stop();

// ---------------------------------------------------------------------------------------------------------------------
// 4. Which side of the boundary the wallets are on
// ---------------------------------------------------------------------------------------------------------------------

// Additive to `state.protocolVersion`, which reports three numbers and says nothing about whether their differing
// matters. The three wallets follow one chain but not in lock-step — each recognises a version change when its own
// synchronization reaches it — so around a fork they disagree for a while, and this is the reading that says so.
switch (state.protocol._tag) {
  case 'Settled':
    console.log(`Protocol phase: settled at version ${state.protocol.version}`);
    break;
  case 'Crossing':
    // The window around a fork. Nothing the facade builds now can span the boundary, so it stays bound to `from` —
    // the version the wallets in `behind` are still on — until they catch up. An application can say what it is
    // waiting for, and should not treat this as an error: it resolves by itself as synchronization proceeds.
    console.log(
      `Protocol phase: crossing from ${state.protocol.from} to ${state.protocol.to}, waiting on ${state.protocol.behind.join(', ')}`,
    );
    break;
}

// ---------------------------------------------------------------------------------------------------------------------
// 5. Transactions the fork orphaned
// ---------------------------------------------------------------------------------------------------------------------

// An orphaned transaction has no verdict from the chain and never will: its bytes were fixed by the ledger version
// that authored them, and once the chain has crossed the boundary nothing can include them. The wallet does not wait
// for a timeout — it gives up as soon as it observes a version past the one the transaction was authored for, unbooks
// the coins so the funds are spendable again, and records `orphaned-by-protocol-upgrade` in transaction history so an
// application can tell a user why. Re-submitting the same bytes could never help; re-authoring is the answer.
const orphaned = state.pending.flatMap((entry) => (entry.status._tag === 'Orphaned' ? [entry.status] : []));
console.log(`Pending transactions: ${state.pending.length}, of which orphaned by the fork: ${orphaned.length}`);
orphaned.forEach((status) => console.log(`  authored for ${status.authoredFor}, chain had reached ${status.chainNow}`));

// ---------------------------------------------------------------------------------------------------------------------
// 6. Restoring a snapshot without throwing
// ---------------------------------------------------------------------------------------------------------------------

// `restore` throws, and is the right shape for a snapshot the application has just written itself. `tryRestore` is the
// same call with the reason kept rather than thrown, which is the right shape for a snapshot it has not: one a user
// supplied, or one written by a build of the SDK that is no longer the one running. "I cannot read this" is an
// ordinary answer there — a snapshot may declare a protocol version no registered variant reads — not a bug.
const snapshot = await wallet.shielded.serializeState();
const restored = ShieldedWallet(configuration).tryRestore(snapshot);
console.log('Restored the snapshot this wallet just wrote?', Either.isRight(restored));
if (Either.isRight(restored)) {
  await restored.right.stop();
}

const fromAVersionNobodyReads = JSON.stringify({
  publicKeys: { coinPublicKey: 'aa', encryptionPublicKey: 'bb' },
  state: 'deadbeef',
  protocolVersion: String(ProtocolVersion.MaxSupportedVersion),
  networkId: 'undeployed',
  coinHashes: {},
});
const refused = ShieldedWallet(configuration).tryRestore(fromAVersionNobodyReads);
if (Either.isLeft(refused)) {
  console.log('Refused a snapshot from a protocol version no variant reads:', refused.left.message);
}

// ---------------------------------------------------------------------------------------------------------------------
// 7. Only the current epoch's transactions are accepted
// ---------------------------------------------------------------------------------------------------------------------

// An application that authors its own transactions is the one thing that has to choose a ledger version, because
// authoring is choosing which rules the bytes follow. Both subpaths are shipped and both are real: a chain is pre-fork
// until it forks. So `wallet-sdk/ledger/v8` below the boundary, `/v9` from it — read `state.activeProtocolVersion` and
// author accordingly. An authoring path that only ever imports one of them type-checks perfectly and fails at run time
// on chains of the other epoch.
//
// Here the pre-fork ledger authors a minimal transaction — an intent with a TTL and nothing else — and seals it with
// `adopt`, whose version argument is a claim about which ledger version produced these bytes. The SDK holds the caller
// to that claim rather than trusting it: this chain is past the boundary, so the handle is refused by name at the
// first gate it reaches, before a proof server is contacted or anything is sent. Every entry point that takes a
// transaction checks the same thing the same way — `submitTransaction`, the balancing calls, this one.
const preForkIntent = preForkLedger.Intent.new(new Date(Date.now() + 30 * 60 * 1000));
const preForkTransaction = preForkLedger.Transaction.fromParts('undeployed', undefined, undefined, preForkIntent);
const preForkHandle = WalletTransaction.adopt('Unproven', preForkTransaction, ProtocolVersion.MinSupportedVersion);

try {
  await wallet.finalizeTransaction(preForkHandle);
  console.log('A pre-fork transaction was accepted after the fork, which should be impossible.');
} catch (error) {
  if (!(error instanceof ProtocolVersionMismatchError)) {
    throw error;
  }
  const [from, to] = error.accepted;
  console.log(
    `Refused a transaction at stage ${error.stage}, authored for version ${error.authoredFor}; ` +
      `this wallet accepts [${from}, ${to})`,
  );
}

await wallet.stop();
