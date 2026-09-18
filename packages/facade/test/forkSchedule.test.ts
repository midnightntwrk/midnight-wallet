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
 * The facade asks for the fork schedule in the shape the wallets do, for nothing the wallets no longer take — and,
 * alone among the SDK's configurations, lets it be left out: it then presets {@link DefaultForkSchedule} and hands the
 * filled-in configuration to every factory. Why the preset sits in the facade and nowhere lower is documented on the
 * constant.
 */
import { InMemoryTransactionHistoryStorage, NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { DustWallet } from '@midnightntwrk/wallet-sdk-dust-wallet';
import { ShieldedWallet } from '@midnightntwrk/wallet-sdk-shielded';
import { PublicKey, UnshieldedWallet } from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import { Clock } from '@midnightntwrk/wallet-sdk-utilities';
import { type Equal, type Expect } from '@midnightntwrk/wallet-sdk-utilities/types';
import * as rx from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type BlockDataFetcher,
  type DefaultConfiguration,
  DefaultForkSchedule,
  type InitParams,
  type ResolvedConfiguration,
  WalletEntrySchema,
  WalletFacade,
  mergeWalletEntries,
} from '../src/index.js';

import {
  createV8MockProvingService,
  deriveWalletKeys,
  drivenBy,
  dustAt,
  shieldedAt,
  SilentPendingTransactions,
  unshieldedAt,
} from './utils/index.js';

/** A configuration that says nothing about where the chain forks. */
const configuration = {
  networkId: NetworkId.NetworkId.Undeployed,
  relayURL: new URL('http://localhost:9944'),
  indexerClientConnection: { indexerHttpUrl: 'http://localhost:8080' },
  provingServerUrl: new URL('http://localhost:6300'),
  costParameters: { feeBlocksMargin: 0 },
  txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
} satisfies DefaultConfiguration;

describe('DefaultConfiguration', () => {
  it('states where each ledger version begins as `forks`, one key per ledger version after the first', () => {
    type _1 = Expect<Equal<DefaultConfiguration['forks'], ProtocolVersion.ForkSchedule | undefined>>;
  });

  it('lets `forks` be left out, which no wallet configuration does', () => {
    type _1 = Expect<Equal<Pick<DefaultConfiguration, 'forks'>, { forks?: ProtocolVersion.ForkSchedule }>>;
    type _2 = Expect<Equal<InitParams<DefaultConfiguration>['configuration'], DefaultConfiguration>>;
  });

  it('no longer takes a single fork version', () => {
    type _1 = Expect<Equal<'forkVersion' extends keyof DefaultConfiguration ? true : false, false>>;
  });
});

describe('DefaultForkSchedule', () => {
  it('has ledger-v9 begin at the version a 2.x node reports, and says nothing else', () => {
    expect(DefaultForkSchedule).toStrictEqual({ v9: ProtocolVersion.V9NativeForkVersion });
  });

  it('is the schedule of a chain born on ledger-v9, as the abstractions package names it', () => {
    expect(DefaultForkSchedule).toBe(ProtocolVersion.V9NativeForkSchedule);
  });
});

describe('ResolvedConfiguration', () => {
  it('is the configuration given, with `forks` always present', () => {
    type _1 = Expect<Equal<ResolvedConfiguration['forks'], ProtocolVersion.ForkSchedule>>;

    type Custom = DefaultConfiguration & { readonly appSetting: string };
    type _2 = Expect<Equal<ResolvedConfiguration<Custom>['appSetting'], string>>;
    type _3 = Expect<Equal<ResolvedConfiguration<Custom>['forks'], ProtocolVersion.ForkSchedule>>;
  });

  it('is what every factory in InitParams is handed', () => {
    type Factories = Required<Omit<InitParams<DefaultConfiguration>, 'configuration'>>;
    // `Parameters` distributes over the union of factories, and a union of identical types is one type: a factory handed
    // anything else would keep the union apart. Derived from `InitParams`, so a factory added later is covered too.
    type _1 = Expect<Equal<Parameters<Factories[keyof Factories]>[0], ResolvedConfiguration>>;
  });
});

describe('WalletFacade.resolveConfiguration', () => {
  it('fills in `DefaultForkSchedule` when the configuration names no `forks`', () => {
    const resolved = WalletFacade.resolveConfiguration(configuration);

    expect(resolved).toStrictEqual({ ...configuration, forks: DefaultForkSchedule });
    expect(resolved.forks).toBe(DefaultForkSchedule);
  });

  it('leaves the `forks` a configuration does name untouched', () => {
    const forks: ProtocolVersion.ForkSchedule = { v9: ProtocolVersion.ProtocolVersion(7n) };

    const resolved = WalletFacade.resolveConfiguration({ ...configuration, forks });

    expect(resolved.forks).toBe(forks);
  });

  it('keeps the settings a configuration adds, and types the result as `ResolvedConfiguration` of them', () => {
    const custom = { ...configuration, appSetting: 'kept' };

    const resolved = WalletFacade.resolveConfiguration(custom);

    type _1 = Expect<Equal<typeof resolved, ResolvedConfiguration<typeof custom>>>;
    expect(resolved.appSetting).toBe('kept');
  });

  it('is idempotent, so `init` may be handed a configuration that is already resolved', () => {
    const once = WalletFacade.resolveConfiguration(configuration);

    expect(WalletFacade.resolveConfiguration(once)).toStrictEqual(once);
  });
});

describe('WalletFacade.init', () => {
  const facades: WalletFacade[] = [];

  afterEach(async () => {
    await Promise.allSettled(facades.splice(0).map((facade) => facade.stop()));
  });

  const keys = deriveWalletKeys(
    '0000000000000000000000000000000000000000000000000000000000000003',
    configuration.networkId,
  );

  /** Services the facade never reaches here, present so that their factories are handed a configuration too. */
  const unusedSubmission: WalletFacade['submissionService'] = {
    submitTransaction: (): Promise<never> => Promise.reject(new Error('not under test')),
    close: () => Promise.resolve(),
  };
  const unusedBlockData: BlockDataFetcher = () => Promise.reject(new Error('not under test'));
  const unusedValidation: WalletFacade['validationService'] = { validateTx: () => Promise.resolve() };

  /** One per factory in {@link InitParams}: the three wallets and the six services. */
  const factoryCount = 9;

  /**
   * Builds a facade from the configuration each factory is handed, and returns what each was handed.
   *
   * @remarks
   *   The wallets are real and shipped, built the way an application builds them — from the factory's own argument — and
   *   never started, since this suite has no indexer to subscribe to.
   */
  const initRecording = async (given: DefaultConfiguration): Promise<readonly ResolvedConfiguration[]> => {
    const handed: ResolvedConfiguration[] = [];
    const recording =
      <T>(make: (config: ResolvedConfiguration) => T) =>
      (config: ResolvedConfiguration): T => {
        handed.push(config);
        return make(config);
      };

    const facade = await WalletFacade.init({
      configuration: given,
      shielded: recording((config) => ShieldedWallet(config).startWithSeed(keys.seeds.shielded)),
      unshielded: recording((config) =>
        UnshieldedWallet(config).startWithPublicKey(PublicKey.fromKeyStore(keys.unshieldedKeystore)),
      ),
      dust: recording((config) => DustWallet(config).startWithSeed(keys.seeds.dust)),
      clock: recording(() => Clock.systemClock),
      submissionService: recording(() => unusedSubmission),
      pendingTransactionsService: recording(() => new SilentPendingTransactions()),
      provingService: recording(() => createV8MockProvingService()),
      fetchBlockData: recording(() => unusedBlockData),
      validationService: recording(() => unusedValidation),
    });
    facades.push(facade);
    return handed;
  };

  it('hands every factory the configuration with `DefaultForkSchedule` filled in, when it names no `forks`', async () => {
    const handed = await initRecording(configuration);

    expect(handed).toHaveLength(factoryCount);
    handed.forEach((config) => expect(config).toStrictEqual({ ...configuration, forks: DefaultForkSchedule }));
  });

  it('hands every factory the `forks` a configuration does name, untouched', async () => {
    const forks: ProtocolVersion.ForkSchedule = { v9: ProtocolVersion.ProtocolVersion(7n) };

    const handed = await initRecording({ ...configuration, forks });

    expect(handed).toHaveLength(factoryCount);
    handed.forEach((config) => expect(config.forks).toBe(forks));
  });

  it('reads the protocol phase against the preset boundary', async () => {
    // Real, shipped wallets, never started, whose state streams this test drives (see `drivenStates.ts`). Built here
    // rather than by the facade so the streams are in place before the facade subscribes to them; the schedule they
    // are built with is immaterial, since what is under test is the boundary the facade reads their versions against.
    const walletConfiguration = { ...configuration, forks: DefaultForkSchedule };
    const shielded = await ShieldedWallet(walletConfiguration).startWithSeed(keys.seeds.shielded);
    const unshielded = await UnshieldedWallet(walletConfiguration).startWithPublicKey(
      PublicKey.fromKeyStore(keys.unshieldedKeystore),
    );
    const dust = await DustWallet(walletConfiguration).startWithSeed(keys.seeds.dust);
    const boundary = ProtocolVersion.V9NativeForkVersion;
    const below = ProtocolVersion.ProtocolVersion(boundary - 1n);
    drivenBy(shielded, rx.of(shieldedAt(await rx.firstValueFrom(shielded.state), boundary)));
    drivenBy(unshielded, rx.of(unshieldedAt(await rx.firstValueFrom(unshielded.state), below)));
    drivenBy(dust, rx.of(dustAt(await rx.firstValueFrom(dust.state), below)));

    const facade = await WalletFacade.init({
      configuration,
      shielded: () => shielded,
      unshielded: () => unshielded,
      dust: () => dust,
      provingService: () => createV8MockProvingService(),
      pendingTransactionsService: () => new SilentPendingTransactions(),
    });
    facades.push(facade);

    const observed = await rx.firstValueFrom(facade.state());

    // One wallet exactly at the version a 2.x node reports and two just below it is a crossing only if the boundary is
    // there: read against the minimum or maximum supported version, the same three would be settled.
    expect(observed.protocol).toStrictEqual({
      _tag: 'Crossing',
      from: below,
      to: boundary,
      behind: ['unshielded', 'dust'],
    });
  });
});
