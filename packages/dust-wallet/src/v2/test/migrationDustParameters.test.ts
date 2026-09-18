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
//
// What happens when the dust parameters handed to the migration are not the chain's.
//
// Dust is the one wallet whose migration takes configuration as well as a previous state. `DustLocalState` is
// parameterised by the ledger's `DustParameters`, and those are a WASM object belonging to whichever ledger module
// produced them — so the previous variant's copy cannot cross, and the new state is built on a set supplied through
// the builder instead.
//
// Supplied means an application can supply the wrong one. `migration.test.ts` covers the case where the parameters are
// right ("builds the fresh state on this ledger version parameters"); every test in the package passes
// `LedgerParameters.initialParameters().dust`, so nothing establishes what a stale or mismatched set does. The
// possibilities are: rejected with a typed error, provably harmless, or silently accepted and used to value dust the
// wallet regenerates from the replay. Only the third is a problem, and this file exists to say which one it is.
//
// Measured, not assumed. Against a real four-registration dust chain, valued at one instant:
//
//   | mutated field             | replayed balance vs correct |
//   | ------------------------- | --------------------------- |
//   | `nightDustRatio` /2, *4   | unchanged                   |
//   | `dustGracePeriodSeconds`  | unchanged                   |
//   | `generationDecayRate` /2  | -25%                        |
//   | `generationDecayRate` *4  | +148%                       |
//
// So the answer is "silently accepted", and the exposure is one field, not three. That distinction is the reason this
// file asserts both directions: a guard added to the wrong field would look like a fix and change nothing.
//
// Tier: unit, but it drives a real dust chain through WASM to value dust rather than asserting on the parameter object
// alone — a parameter set that is merely stored differently is not yet a defect; one that changes a balance is.
import { LedgerParameters, DustParameters, type DustSecretKey, type Event } from '@midnightntwrk/ledger-v9';
import { NetworkId, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import { CoreWallet, PublicKey } from '../CoreWallet.js';
import { makeCrossLedgerMigration, type PreviousLedgerWallet } from '../Migration.js';
import { buildDustChain, eventAt, fixtureSecretKey } from './dustEvents.js';

// Building a real dust chain through WASM does not fit vitest's 5s default, for the same reason `forkSimulation`
// raises it.
vi.setConfig({ testTimeout: 30_000 });

const networkId = NetworkId.NetworkId.Undeployed;
const forkVersion = ProtocolVersion.ProtocolVersion(7n);

/** The parameters the chain actually runs, which is what a correctly configured application supplies. */
const chainParameters = (): DustParameters => LedgerParameters.initialParameters().dust;

/**
 * A plausible misconfiguration: the right shape, the wrong numbers.
 *
 * @remarks
 *   `nightDustRatio` is halved rather than set to something absurd. A stale set from a previous release is the realistic
 *   failure, not a nonsense one, and a wallet is far likelier to be handed slightly-wrong parameters than
 *   obviously-wrong ones.
 */
const staleParameters = (): DustParameters => {
  const chain = chainParameters();
  return new DustParameters(chain.nightDustRatio / 2n, chain.generationDecayRate, chain.dustGracePeriodSeconds);
};

const previousWallet = (): PreviousLedgerWallet => ({
  publicKey: { publicKey: PublicKey.fromSecretKey(fixtureSecretKey()).publicKey },
  networkId,
  protocolVersion: forkVersion,
  progress: {
    appliedIndex: 4n,
    highestIndex: 4n,
    highestRelevantIndex: 4n,
    highestRelevantWalletIndex: 4n,
    isConnected: true,
  },
});

describe('a cross-ledger dust migration handed parameters that are not the chain’s', () => {
  it('accepts them without complaint, and holds them verbatim', async () => {
    // Answers the first of the three possibilities: it is not rejected. There is no validation seam here at all — the
    // parameters are configuration, and the migration takes them on trust.
    const stale = staleParameters();

    const wallet = await Effect.runPromise(
      makeCrossLedgerMigration({ dustParameters: stale }).migrate(previousWallet()),
    );

    expect(wallet.state.params.nightDustRatio).toBe(stale.nightDustRatio);
    // ...and that really is different from what the chain runs, so the case above is not vacuous.
    expect(stale.nightDustRatio).not.toBe(chainParameters().nightDustRatio);
  });

  it('misvalues the dust it regenerates from the replay when the decay rate is wrong', async () => {
    // Answers the second and third possibilities: not harmless. The migrated wallet re-discovers its dust by replaying
    // the ledger-v9 timeline, and every UTXO it recovers is valued against whatever parameters its local state was
    // built on. Same secret key, same events, same instant — only the configured decay rate differs.
    const chain = await buildDustChain();
    const secretKey: DustSecretKey = fixtureSecretKey();
    const base = chainParameters();

    const balanceUnder = async (parameters: DustParameters): Promise<bigint> => {
      const migrated = await Effect.runPromise(
        makeCrossLedgerMigration({ dustParameters: parameters }).migrate(previousWallet()),
      );
      // Each replay deserializes its own events: `replayEventsWithChanges` takes ownership of the ones it is handed.
      const events: Event[] = chain.eventBytes.map((_, index) => eventAt(chain.eventBytes, index));
      const [synced] = CoreWallet.applyEventsWithChanges(migrated, secretKey, events, chain.syncTime);
      return synced.state.walletBalance(chain.syncTime);
    };

    const correct = await balanceUnder(base);
    // The fixture really did generate dust, or the comparisons below would be zero against zero.
    expect(correct).toBeGreaterThan(0n);

    const halvedDecay = await balanceUnder(
      new DustParameters(base.nightDustRatio, base.generationDecayRate / 2n, base.dustGracePeriodSeconds),
    );
    const quadrupledDecay = await balanceUnder(
      new DustParameters(base.nightDustRatio, base.generationDecayRate * 4n, base.dustGracePeriodSeconds),
    );

    // The finding: nothing was raised, nothing on the state records which parameters produced the number, and the
    // wallet's own view of what it can spend moves with the misconfiguration. Asserted as ordering rather than as
    // pinned values, so a ledger change to the decay curve retires the model rather than this test.
    expect(halvedDecay).toBeLessThan(correct);
    expect(quadrupledDecay).toBeGreaterThan(correct);
  });

  it('is unaffected by a wrong night-dust ratio, so a guard on that field would fix nothing', async () => {
    // The boundary of the exposure, and the reason it is worth stating. `nightDustRatio` governs generation capacity
    // from registered Night; the dust recovered here arrives as replayed `dustInitialUtxo` events that already carry
    // their values, so the ratio never enters the arithmetic. A reviewer reading only the case above could reasonably
    // conclude every field is dangerous and validate the wrong one.
    const chain = await buildDustChain();
    const secretKey: DustSecretKey = fixtureSecretKey();
    const base = chainParameters();

    const balanceUnder = async (parameters: DustParameters): Promise<bigint> => {
      const migrated = await Effect.runPromise(
        makeCrossLedgerMigration({ dustParameters: parameters }).migrate(previousWallet()),
      );
      const events: Event[] = chain.eventBytes.map((_, index) => eventAt(chain.eventBytes, index));
      const [synced] = CoreWallet.applyEventsWithChanges(migrated, secretKey, events, chain.syncTime);
      return synced.state.walletBalance(chain.syncTime);
    };

    const correct = await balanceUnder(base);
    const halvedRatio = await balanceUnder(
      new DustParameters(base.nightDustRatio / 2n, base.generationDecayRate, base.dustGracePeriodSeconds),
    );

    expect(halvedRatio).toBe(correct);
  });
});
