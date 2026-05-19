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
import { ProtocolVersion } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { Effect } from 'effect';
import * as rx from 'rxjs';
import { describe, expect, it } from 'vitest';
import { StateChange, VersionChangeType } from '../abstractions/index.js';
import { toProtocolStateArray } from '../testing/utils.js';
import {
  type InterceptingRunningVariant,
  InterceptingVariantBuilder,
  Numeric,
  NumericMultiplier,
  NumericRangeBuilder,
  NumericRangeMultiplierBuilder,
} from '../testing/variants.js';
import { WalletBuilder } from '../WalletBuilder.js';

describe('Wallet runtime', () => {
  it('allows to dispatch a poly function on a running variant', async () => {
    const interceptingTag = 'intercept' as const;
    const builder = WalletBuilder.init()
      // Have the first variant complete after producing two values, signifying a protocol change.
      .withVariant(ProtocolVersion.MinSupportedVersion, new NumericRangeBuilder(2))
      .withVariant(
        ProtocolVersion.ProtocolVersion(50n),
        new InterceptingVariantBuilder<typeof interceptingTag, number>(interceptingTag),
      )
      .withVariant(ProtocolVersion.ProtocolVersion(100n), new NumericRangeMultiplierBuilder());
    const Wallet = builder.build({
      min: 0,
      max: 4,
      multiplier: 2,
    });
    const wallet = Wallet.startEmpty(Wallet);

    const allCollectedState = toProtocolStateArray<number>(wallet.rawState.pipe(rx.take(6)));

    // Let's wait for the intercepting variant to be initiated to remove any chance of races
    await rx.firstValueFrom(
      wallet.rawState.pipe(rx.find(({ version }) => version == ProtocolVersion.ProtocolVersion(50n))),
    );

    const dispatchResult = await wallet.runtime
      .dispatch({
        [Numeric]: () => Effect.succeed(false),
        [NumericMultiplier]: () => Effect.succeed(false),
        [interceptingTag]: (interceptingVariant) =>
          interceptingVariant
            .emitProtocolVersionChange(VersionChangeType.Version({ version: ProtocolVersion.ProtocolVersion(100n) }))
            .pipe(Effect.as(true)),
      })
      .pipe(Effect.runPromise);

    expect(dispatchResult).toBe(true);
    expect(await allCollectedState).toEqual([
      { version: ProtocolVersion.MinSupportedVersion, state: 0 },
      { version: ProtocolVersion.MinSupportedVersion, state: 0 },
      { version: ProtocolVersion.MinSupportedVersion, state: 1 },
      { version: ProtocolVersion.ProtocolVersion(50n), state: 1 }, // This is expected to be emitted by the intercepting variant
      { version: ProtocolVersion.ProtocolVersion(100n), state: 4 }, // This is the rest
      { version: ProtocolVersion.ProtocolVersion(100n), state: 6 },
    ]);
  });

  it('allows wallet to implement own starting procedure', async () => {
    const builder = WalletBuilder.init()
      .withVariant(ProtocolVersion.MinSupportedVersion, new NumericRangeBuilder(2))
      .withVariant(ProtocolVersion.ProtocolVersion(100n), new NumericRangeMultiplierBuilder());
    const BaseWallet = builder.build({
      min: 0,
      max: 46,
      multiplier: 2,
    });
    class Wallet extends BaseWallet {
      static startFrom(nr: number): Wallet {
        return Wallet.startFirst(Wallet, nr);
      }
    }

    const wallet = Wallet.startFrom(42);

    expect(wallet).toBeInstanceOf(BaseWallet);
    expect(wallet).toBeInstanceOf(Wallet);

    const state = wallet.rawState.pipe(rx.take(6)); // We expect five values + the initial one.
    const receivedStates = await toProtocolStateArray(state);

    expect(receivedStates).toEqual([
      { version: ProtocolVersion.MinSupportedVersion, state: 42 },
      { version: ProtocolVersion.MinSupportedVersion, state: 42 },
      { version: ProtocolVersion.MinSupportedVersion, state: 43 },
      // The second variant starts applying the multiplier to the state (represents a protocol change).
      { version: ProtocolVersion.ProtocolVersion(100n), state: 88 },
      { version: ProtocolVersion.ProtocolVersion(100n), state: 90 },
      { version: ProtocolVersion.ProtocolVersion(100n), state: 92 },
    ]);
  });

  it('allows to start from arbitrary variant by providing its state', async () => {
    const Intercepting = 'intercepting' as const;
    const builder = WalletBuilder.init()
      .withVariant(ProtocolVersion.MinSupportedVersion, new NumericRangeBuilder(2))
      .withVariant(
        ProtocolVersion.ProtocolVersion(50n),
        new InterceptingVariantBuilder<typeof Intercepting, number>(Intercepting),
      )
      .withVariant(ProtocolVersion.ProtocolVersion(100n), new NumericRangeMultiplierBuilder());
    const Wallet = builder.build({
      min: 0,
      max: 44,
      multiplier: 2,
    });
    const wallet = Wallet.start(Wallet, Intercepting, 42);

    const allCollectedState = toProtocolStateArray<number>(wallet.rawState.pipe(rx.take(3)));

    await wallet.runtime
      .dispatch({
        [Numeric]: () => Effect.void,
        [NumericMultiplier]: () => Effect.void,
        [Intercepting]: (interceptingVariant: InterceptingRunningVariant<typeof Intercepting, number>) =>
          interceptingVariant.emitProtocolVersionChange(VersionChangeType.Next()),
      })
      .pipe(Effect.runPromise);

    expect(await allCollectedState).toEqual([
      { version: ProtocolVersion.ProtocolVersion(50n), state: 42 }, // this is the state we provided, and runtime automatically emits it
      { version: ProtocolVersion.ProtocolVersion(100n), state: 86 },
      { version: ProtocolVersion.ProtocolVersion(100n), state: 88 },
    ]);
  });

  it('allows to start from the first variant by providing its state', async () => {
    const builder = WalletBuilder.init()
      .withVariant(ProtocolVersion.MinSupportedVersion, new NumericRangeBuilder(2))
      .withVariant(ProtocolVersion.ProtocolVersion(100n), new NumericRangeMultiplierBuilder());
    const Wallet = builder.build({
      min: 0,
      max: 46,
      multiplier: 2,
    });

    const wallet = Wallet.startFirst(Wallet, 42);

    const state = wallet.rawState.pipe(rx.take(6)); // We expect five values.
    const receivedStates = await toProtocolStateArray(state);

    expect(receivedStates).toEqual([
      { version: ProtocolVersion.MinSupportedVersion, state: 42 }, // The initial state is emitted both by runtime and the variant
      { version: ProtocolVersion.MinSupportedVersion, state: 42 },
      { version: ProtocolVersion.MinSupportedVersion, state: 43 },
      // The second variant starts applying the multiplier to the state (represents a protocol change).
      { version: ProtocolVersion.ProtocolVersion(100n), state: 88 },
      { version: ProtocolVersion.ProtocolVersion(100n), state: 90 },
      { version: ProtocolVersion.ProtocolVersion(100n), state: 92 },
    ]);
  });

  it('reports progress updates from variant through runtime.progress', async () => {
    const progressTag = 'progress' as const;
    const Wallet = WalletBuilder.init()
      .withVariant(
        ProtocolVersion.MinSupportedVersion,
        new InterceptingVariantBuilder<typeof progressTag, number>(progressTag),
      )
      .build();
    const wallet = Wallet.startEmpty(Wallet);

    // Wait for the intercepting variant to be initiated
    await rx.firstValueFrom(wallet.rawState);

    // Initial progress should be zero
    const initialProgress = await Effect.runPromise(wallet.runtime.progress);
    expect(initialProgress).toMatchObject({ sourceGap: 0n, applyGap: 0n });

    // Emit a ProgressUpdate with non-zero gaps, followed by a State change as a synchronization point
    await wallet.runtime
      .dispatch({
        [progressTag]: (variant) =>
          variant
            .emit(StateChange.ProgressUpdate({ sourceGap: 10n, applyGap: 5n }))
            .pipe(Effect.flatMap(() => variant.emit(StateChange.State({ state: 42 })))),
      })
      .pipe(Effect.runPromise);

    // Wait for the State change to arrive, ensuring the preceding ProgressUpdate has been processed
    await rx.firstValueFrom(wallet.rawState.pipe(rx.filter(({ state }) => state === 42)));

    const midProgress = await Effect.runPromise(wallet.runtime.progress);
    expect(midProgress).toMatchObject({ sourceGap: 10n, applyGap: 5n });

    // Emit a ProgressUpdate showing sync is complete, followed by another State change
    await wallet.runtime
      .dispatch({
        [progressTag]: (variant) =>
          variant
            .emit(StateChange.ProgressUpdate({ sourceGap: 0n, applyGap: 0n }))
            .pipe(Effect.flatMap(() => variant.emit(StateChange.State({ state: 43 })))),
      })
      .pipe(Effect.runPromise);

    await rx.firstValueFrom(wallet.rawState.pipe(rx.filter(({ state }) => state === 43)));

    const finalProgress = await Effect.runPromise(wallet.runtime.progress);
    expect(finalProgress).toMatchObject({ sourceGap: 0n, applyGap: 0n });

    await wallet.stop();
  });

  it('updates protocol version annotation without migrating when version change is within valid range', async () => {
    const interceptingTag = 'intercept' as const;
    const Wallet = WalletBuilder.init()
      .withVariant(
        ProtocolVersion.MinSupportedVersion,
        new InterceptingVariantBuilder<typeof interceptingTag, number>(interceptingTag),
      )
      .withVariant(ProtocolVersion.ProtocolVersion(100n), new NumericRangeMultiplierBuilder())
      .build({ min: 0, max: 10, multiplier: 2 });
    const wallet = Wallet.startEmpty(Wallet);

    // Wait for the intercepting variant to be initiated
    await rx.firstValueFrom(wallet.rawState);

    // Emit a VersionChange to version 50n, which is within the current variant's valid range [0n, 100n)
    // This should NOT trigger migration — only update the protocol version annotation
    await wallet.runtime
      .dispatch({
        [interceptingTag]: (variant) =>
          variant
            .emitProtocolVersionChange(VersionChangeType.Version({ version: ProtocolVersion.ProtocolVersion(50n) }))
            .pipe(Effect.flatMap(() => variant.emit(StateChange.State({ state: 42 })))),
        [NumericMultiplier]: () => Effect.void,
      })
      .pipe(Effect.runPromise);

    // The state emission after the version change should carry the updated version 50n
    const stateAfterVersionChange = await rx.firstValueFrom(
      wallet.rawState.pipe(rx.filter(({ state }) => state === 42)),
    );
    expect(stateAfterVersionChange).toEqual({ version: ProtocolVersion.ProtocolVersion(50n), state: 42 });

    // Verify the variant was NOT migrated — we can still dispatch to the intercepting variant
    const stillIntercepting = await wallet.runtime
      .dispatch({
        [interceptingTag]: () => Effect.succeed(true),
        [NumericMultiplier]: () => Effect.succeed(false),
      })
      .pipe(Effect.runPromise);
    expect(stillIntercepting).toBe(true);

    await wallet.stop();
  });

  it('ignores VersionChangeType.Next when there is no next variant', async () => {
    const interceptingTag = 'sole' as const;
    const Wallet = WalletBuilder.init()
      .withVariant(
        ProtocolVersion.MinSupportedVersion,
        new InterceptingVariantBuilder<typeof interceptingTag, number>(interceptingTag),
      )
      .build();
    const wallet = Wallet.startEmpty(Wallet);

    // Wait for the intercepting variant to be initiated
    await rx.firstValueFrom(wallet.rawState);

    // Emit VersionChangeType.Next() — with no next variant, nextProtocolVersion is null,
    // so this should be a no-op: no migration, protocol version unchanged
    await wallet.runtime
      .dispatch({
        [interceptingTag]: (variant) =>
          variant
            .emitProtocolVersionChange(VersionChangeType.Next())
            .pipe(Effect.flatMap(() => variant.emit(StateChange.State({ state: 99 })))),
      })
      .pipe(Effect.runPromise);

    // State should still be annotated with the original version
    const stateAfter = await rx.firstValueFrom(wallet.rawState.pipe(rx.filter(({ state }) => state === 99)));
    expect(stateAfter).toEqual({ version: ProtocolVersion.MinSupportedVersion, state: 99 });

    // Variant was not migrated — dispatching still reaches the intercepting variant
    const stillSoleVariant = await wallet.runtime
      .dispatch({
        [interceptingTag]: () => Effect.succeed(true),
      })
      .pipe(Effect.runPromise);
    expect(stillSoleVariant).toBe(true);

    await wallet.stop();
  });
});
