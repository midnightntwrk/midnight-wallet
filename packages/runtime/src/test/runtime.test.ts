// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) 2025 Midnight Foundation
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
import { VersionChangeType } from '../abstractions/index.js';
import { toProtocolStateArray } from '../testing/utils.js';
import {
  InterceptingRunningVariant,
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

    const state = wallet.rawState.pipe(rx.take(3));

    await wallet.runtime
      .dispatch({
        [Numeric]: () => Effect.void,
        [NumericMultiplier]: () => Effect.void,
        [Intercepting]: (interceptingVariant: InterceptingRunningVariant<typeof Intercepting, number>) =>
          interceptingVariant.emitProtocolVersionChange(VersionChangeType.Next()),
      })
      .pipe(Effect.runPromise);

    const receivedStates = await toProtocolStateArray(state);

    expect(receivedStates).toEqual([
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
});
