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

/**
 * A fork-aware facade over a simulated chain on either side of `forks.v9`, holding Night.
 *
 * @remarks
 *   The simulator facade (`makeSimulatorFacade`) runs ledger-v9 from the bottom of the timeline over single-variant
 *   wallets, so it never reaches ledger-v8. This one builds the shipped forking unshielded wallet with each variant
 *   syncing a simulated chain of its own ledger version, at the real boundary, and pays this wallet Night on the chain
 *   whose side the requested version is on. The wallet asks the chain which version it is at, so it starts on the
 *   variant that owns that version: the V1 variant below the boundary, the V2 variant from it. Nothing crosses the
 *   boundary: the other chain only has to exist.
 *
 *   The shielded and dust wallets are real, never started — they would otherwise open indexer subscriptions there is no
 *   indexer for — and driven at the chain's version. A transaction that only moves Night needs nothing from them but
 *   the version they report.
 */

import * as ledgerV8 from '@midnight-ntwrk/ledger-v8';
import * as ledgerV9 from '@midnightntwrk/ledger-v9';
import {
  InMemoryTransactionHistoryStorage,
  NetworkId,
  NoOpTransactionHistoryStorage,
  ProtocolVersion,
} from '@midnightntwrk/wallet-sdk-abstractions';
import { Simulator, V8 } from '@midnightntwrk/wallet-sdk-capabilities/simulation';
import { DustWallet } from '@midnightntwrk/wallet-sdk-dust-wallet';
import { ShieldedWallet } from '@midnightntwrk/wallet-sdk-shielded';
import { CustomForkingUnshieldedWallet, createKeystore, PublicKey } from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import { Migration as V1Migration, Sync as V1Sync, V1Builder } from '@midnightntwrk/wallet-sdk-unshielded-wallet/v1';
import { Migration as V2Migration, Sync as V2Sync, V2Builder } from '@midnightntwrk/wallet-sdk-unshielded-wallet/v2';
import { Effect, type Scope } from 'effect';
import * as rx from 'rxjs';
import {
  type ResolvedConfiguration,
  type WalletEntry,
  WalletEntrySchema,
  WalletFacade,
  mergeWalletEntries,
} from '../../src/index.js';
import { drivenBy, dustAt, shieldedAt } from './drivenStates.js';
import { getDustSeed, getShieldedSeed, getUnshieldedSeed, tokenValue } from './helpers.js';

const NETWORK_ID = NetworkId.NetworkId.Undeployed;

/** The boundary every facade built here is configured with. */
export const forkingFacadeSchedule: ProtocolVersion.ForkSchedule = { v9: ProtocolVersion.V9NativeForkVersion };

export type ForkingFacadeOptions = Readonly<{
  seed: string;
  /** The version the chain runs at, and so the one every wallet reports. Its side of the boundary picks the chain. */
  chainVersion: ProtocolVersion.ProtocolVersion;
  /**
   * Services to use instead of the defaults, such as a prover for the chain's ledger version. The configuration and the
   * three wallets are not among them: they are what keeps the facade in step with the chain built here.
   */
  overrides?: Omit<
    Partial<Parameters<typeof WalletFacade.init>[0]>,
    'configuration' | 'shielded' | 'unshielded' | 'dust'
  >;
}>;

/**
 * Builds a facade over a chain at `chainVersion` that has paid this wallet Night, and waits for the unshielded wallet
 * to see it.
 *
 * @param options The seed, the chain's version, and any init parameters to override.
 * @returns The facade, stopped when the scope closes.
 */
export const forkingFacadeAt = ({
  seed,
  chainVersion,
  overrides = {},
}: ForkingFacadeOptions): Effect.Effect<WalletFacade, never, Scope.Scope> =>
  Effect.gen(function* () {
    const keystore = createKeystore({ kind: 'schnorr', secret: getUnshieldedSeed(seed) }, NETWORK_ID);
    const publicKey = PublicKey.fromKeyStore(keystore);
    const belowFork = chainVersion < forkingFacadeSchedule.v9;

    // Ledger-v8 has one signature scheme, so its verifying key is the bare value of ledger-v9's schnorr one.
    const v8VerifyingKey: ledgerV8.SignatureVerifyingKey = publicKey.publicKey.value;
    const v8Chain = yield* V8.Simulator.init({
      networkId: NETWORK_ID,
      protocolVersion: belowFork ? chainVersion : ProtocolVersion.MinSupportedVersion,
      ...(belowFork
        ? {
            genesisMints: [
              {
                type: 'unshielded',
                tokenType: ledgerV8.nativeToken().raw,
                amount: tokenValue(100_000n),
                recipient: ledgerV8.addressFromKey(v8VerifyingKey),
                verifyingKey: v8VerifyingKey,
              },
            ],
          }
        : {}),
    });
    const v9Chain = yield* Simulator.init({
      networkId: NETWORK_ID,
      protocolVersion: belowFork ? forkingFacadeSchedule.v9 : chainVersion,
      ...(belowFork
        ? {}
        : {
            genesisMints: [
              {
                type: 'unshielded',
                tokenType: ledgerV9.nativeToken().raw,
                amount: tokenValue(100_000n),
                recipient: ledgerV9.addressFromKey(publicKey.publicKey),
                verifyingKey: publicKey.publicKey,
              },
            ],
          }),
    });

    const configuration: ResolvedConfiguration = {
      networkId: NETWORK_ID,
      forks: forkingFacadeSchedule,
      relayURL: new URL('http://localhost:9944'),
      indexerClientConnection: { indexerHttpUrl: 'http://localhost:8080' },
      provingServerUrl: new URL('http://localhost:6300'),
      costParameters: { feeBlocksMargin: 0 },
      txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
    };

    const UnshieldedWallet = CustomForkingUnshieldedWallet(
      {
        networkId: NETWORK_ID,
        forks: configuration.forks,
        chainVersionProbe: () => Promise.resolve(chainVersion),
      },
      {
        builder: new V1Builder()
          .withSync(V1Sync.makeSimulatorSyncService, V1Sync.makeSimulatorSyncCapability)
          .withSerializationDefaults()
          .withTransactingDefaults()
          .withSigningDefaults()
          .withCoinsAndBalancesDefaults()
          .withKeysDefaults()
          .withCoinSelectionDefaults()
          .withTransactionHistoryDefaults()
          .withMigration(() => V1Migration.makeEmptyWalletMigration({ networkId: NETWORK_ID })),
        configuration: {
          networkId: NETWORK_ID,
          simulator: v8Chain,
          txHistoryStorage: new NoOpTransactionHistoryStorage<WalletEntry>(),
        },
      },
      {
        builder: new V2Builder()
          .withSync(V2Sync.makeSimulatorSyncService, V2Sync.makeSimulatorSyncCapability)
          .withSerializationDefaults()
          .withTransactingDefaults()
          .withSigningDefaults()
          .withCoinsAndBalancesDefaults()
          .withKeysDefaults()
          .withCoinSelectionDefaults()
          .withTransactionHistoryDefaults()
          .withMigration(() => V2Migration.makeCrossLedgerMigration()),
        configuration: {
          networkId: NETWORK_ID,
          simulator: v9Chain,
          txHistoryStorage: new NoOpTransactionHistoryStorage<WalletEntry>(),
        },
      },
    );
    const unshielded = yield* Effect.promise(() => UnshieldedWallet.startWithPublicKey(publicKey));

    const shielded = yield* Effect.promise(() => ShieldedWallet(configuration).startWithSeed(getShieldedSeed(seed)));
    const dust = yield* Effect.promise(() =>
      DustWallet(configuration).startWithSeed(getDustSeed(seed), ledgerV9.LedgerParameters.initialParameters().dust),
    );
    const shieldedState = yield* Effect.promise(() => rx.firstValueFrom(shielded.state));
    const dustState = yield* Effect.promise(() => rx.firstValueFrom(dust.state));
    drivenBy(shielded, new rx.BehaviorSubject(shieldedAt(shieldedState, chainVersion)));
    drivenBy(dust, new rx.BehaviorSubject(dustAt(dustState, chainVersion)));

    const facade = yield* Effect.acquireRelease(
      Effect.promise(() =>
        WalletFacade.init({
          configuration,
          shielded: () => shielded,
          unshielded: () => unshielded,
          dust: () => dust,
          ...overrides,
        }),
      ),
      (started) => Effect.promise(() => started.stop()),
    );

    yield* Effect.promise(() => unshielded.start());
    yield* Effect.promise(() =>
      rx.firstValueFrom(facade.state().pipe(rx.filter((state) => state.unshielded.availableCoins.length > 0))),
    );

    return facade;
  });
