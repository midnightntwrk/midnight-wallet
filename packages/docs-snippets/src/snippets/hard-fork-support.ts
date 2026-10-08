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
 * The SDK runs one ledger version below the chain's `forks.v9` and another from it, and each of the three wallets
 * registers a variant either side. Nothing here is a migration an application performs: a wallet started from a seed
 * follows the chain across the boundary on its own. What an application does have to do is read which side of the
 * boundary the wallets are on and — if it authors its own transactions — author for the right side. Where the boundary
 * is, the facade presets; only a chain that hands over elsewhere has to say so.
 *
 * This file is the copy-paste shape, in the order the code runs:
 *
 * 1. a proving backend per ledger version (`provers`)
 * 2. the seed-first start, which is the primary and the only one that crosses a fork
 * 3. reading the protocol phase off the state (`Settled` / `Crossing`)
 * 4. finding transactions the fork orphaned (`PendingStatus.Orphaned`)
 * 5. persisting and restoring (`serializeState` / `tryRestore`)
 *
 * The same configuration does the right thing on any chain: on one still below the boundary it runs on ledger-v8, on one
 * already past it (like the chain this runs against) it starts directly on ledger-v9, and
 * across a fork it hands over by itself. The crossing involves no application code and so cannot appear here — the
 * executable proof of it lives in each wallet package's `src/test/forkSimulation.test.ts` and
 * `src/test/forkStart.test.ts`.
 */
import {
  createKeystore,
  DustWallet,
  InMemoryTransactionHistoryStorage,
  mergeWalletEntries,
  PublicKey,
  ShieldedWallet,
  UnshieldedWallet,
  WalletEntrySchema,
  WalletFacade,
  WalletSeeds,
} from '@midnightntwrk/wallet-sdk';
import { Buffer } from 'buffer';
import { Either } from 'effect';

const INDEXER_PORT = Number.parseInt(process.env['INDEXER_PORT'] ?? '8088', 10);
const NODE_PORT = Number.parseInt(process.env['NODE_PORT'] ?? '9944', 10);
const PROOF_SERVER_PORT = Number.parseInt(process.env['PROOF_SERVER_PORT'] ?? '6300', 10);
// The proof server built against ledger-v8. A separate deployment from the one above — see the `provers`
// comment below — and never contacted on a chain that has been on ledger-v9 since genesis.
const V8_PROOF_SERVER_PORT = Number.parseInt(process.env['V8_PROOF_SERVER_PORT'] ?? '6301', 10);
const INDEXER_HTTP_URL = `http://localhost:${INDEXER_PORT}/api/v4/graphql`;
const INDEXER_WS_URL = `ws://localhost:${INDEXER_PORT}/api/v4/graphql/ws`;

// ---------------------------------------------------------------------------------------------------------------------
// 1. A proving backend per ledger version
// ---------------------------------------------------------------------------------------------------------------------

// Resolved up front, which fills in what the facade presets: `forks`, as `DefaultForkSchedule` — ledger-v9 from the
// version a 2.x node reports. `WalletFacade.init` does the same for the factories it calls; it is done here as well
// because step 5 uses a wallet package on its own, which has no preset and requires `forks`. A chain that hands over
// elsewhere states its own `forks: { v9: ... }` in this object, which wins.
const configuration = WalletFacade.resolveConfiguration({
  networkId: 'undeployed',
  costParameters: {
    feeBlocksMargin: 5,
  },
  relayURL: new URL(`ws://localhost:${NODE_PORT}`),
  // Proving backends keyed by ledger version, the way `forks` is: `v8` proves below `forks.v9`, `v9` from it, and the
  // boundary is read off `forks` rather than restated here. A transaction is proved by the backend for the ledger
  // version that authored its bytes, so a fork landing between building a transaction and proving it cannot send it to
  // the wrong prover — and, just as importantly, the ledger version that built those bytes is the one that frames the
  // proving request.
  //
  // Two entries, because a proof server is built against one ledger version and no published image serves both: the
  // ledger-v8 half of a chain that has history below `forks.v9` needs its own deployment. On a chain that has been
  // on ledger-v9 since genesis — like the one this runs against — the `v8` entry is simply never reached.
  //
  // `provingServerUrl: url` is the shortest form and means one server under every key; the SDK drives it with each
  // ledger version on its own side of `forks.v9`, which makes it correct but rarely what an operator wants, since the
  // one URL then has to answer for both.
  provers: {
    v8: { kind: 'server', url: new URL(`http://localhost:${V8_PROOF_SERVER_PORT}`) },
    v9: { kind: 'server', url: new URL(`http://localhost:${PROOF_SERVER_PORT}`) },
  },
  indexerClientConnection: {
    indexerHttpUrl: INDEXER_HTTP_URL,
    indexerWsUrl: INDEXER_WS_URL,
  },
  txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
});

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
// for the protocol version the chain's timeline *starts* under and begins at the variant that owns it — where its
// unread history begins, which is what decides which ledger version can read it. A chain that has been on ledger-v9 since
// its genesis therefore starts these wallets on V2 directly; one that forked over existing history starts them
// on V1, and they cross with what they read there. Without an answer a wallet begins on V1 — where a wallet with
// no history belongs — and is handed over on the first batch that reports a ledger-v9 version. Nothing about the probe
// can make a start fail.
const wallet: WalletFacade = await WalletFacade.init({
  configuration,
  shielded: (config) => ShieldedWallet(config).startWithSeed(seeds.shielded),
  unshielded: (config) => UnshieldedWallet(config).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
  dust: (config) => DustWallet(config).startWithSeed(seeds.dust),
});
await wallet.start(seeds);
const state = await wallet.waitForSyncedState();

// A caller that will not part with a seed starts from key objects instead — `facade.start(keysByEpoch)` or, per
// wallet, `startWithKeys({ v8, v9 })`. Both sides are required: key objects belong to one ledger version's runtime,
// so only a seed can cross a boundary on its own.

// ---------------------------------------------------------------------------------------------------------------------
// 3. Which side of the boundary the wallets are on
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
// 4. Transactions the fork orphaned
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
// 5. Persisting and restoring
// ---------------------------------------------------------------------------------------------------------------------

// `restore` throws, and is the right shape for a snapshot the application has just written itself. `tryRestore` is the
// same call with the reason kept rather than thrown, which is the right shape for a snapshot it has not: one a user
// supplied, or one written by a build of the SDK that is no longer the one running. "I cannot read this" is an
// ordinary answer there — a snapshot may declare a protocol version no registered variant reads — not a bug.
const snapshot = await wallet.shielded.serializeState();
const restored = ShieldedWallet(configuration).tryRestore(snapshot);
console.log('Restored the snapshot this wallet just wrote?', Either.isRight(restored));
if (Either.isRight(restored)) {
  // A restored wallet holds no key material — a snapshot deliberately carries none — so it synchronizes nothing until
  // it is started again. Which start depends on where the snapshot was written: `startWithSeed` (and its sibling
  // `startWithKeys({ v8, v9 })`) answers for the variant either side of the boundary, so it works whichever side the
  // snapshot came from; `start(secretKeys)` takes ledger-v9's key alone and so serves only a
  // snapshot written at or past the boundary. Neither is the class-level start of the same name: those build a fresh
  // wallet, which would discard the state just restored.
  await restored.right.startWithSeed(seeds.shielded);
  await restored.right.stop();
}

// An application that authors its own transactions is the one thing that has to choose a ledger version, because
// authoring is choosing which rules the bytes follow: `wallet-sdk/ledger/v8` below the boundary, `/v9` from it — read
// `state.activeProtocolVersion` and author accordingly. Every transaction travels as a handle stamped with the version
// it was authored for, and every entry point refuses a handle from the other side (`ProtocolVersionMismatchError`).

await wallet.stop();
