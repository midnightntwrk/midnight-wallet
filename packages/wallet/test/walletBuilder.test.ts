import { WalletBuilderTs } from '@midnight-ntwrk/wallet-ts';
import { ProtocolVersion } from '@midnight-ntwrk/wallet-ts/abstractions';
import { take } from 'rxjs';
import { NumericRangeBuilder, NumericRangeMultiplierBuilder } from './variants';
import { toProtocolStateArray } from './testUtils';

describe('Wallet Builder', () => {
  it('should support single variant implementations', async () => {
    const builder = new WalletBuilderTs()
      .withVariant(ProtocolVersion.MinSupportedVersion, new NumericRangeBuilder())
      .withConfiguration({
        min: 0,
        max: 1,
      });
    const wallet = builder.build();

    expect(wallet).toBeDefined();

    const state = wallet.state.pipe(take(2)); // We expect two values.
    const receivedStates = await toProtocolStateArray(state);

    expect(receivedStates).toEqual([
      [ProtocolVersion.MinSupportedVersion, 0],
      [ProtocolVersion.MinSupportedVersion, 1],
    ]);
  });

  it('should support multiple variant implementations through state migration', async () => {
    const builder = new WalletBuilderTs()
      // Have the first variant complete after producing two values, signifying a protocol change.
      .withVariant(ProtocolVersion.MinSupportedVersion, new NumericRangeBuilder(2))
      .withVariant(ProtocolVersion.ProtocolVersion(100n), new NumericRangeMultiplierBuilder())
      .withConfiguration({
        min: 0,
        max: 4,
        multiplier: 2,
      });
    const wallet = builder.build();

    expect(wallet).toBeDefined();

    const state = wallet.state.pipe(take(5)); // We expect five values.
    const receivedStates = await toProtocolStateArray(state);

    expect(receivedStates).toEqual([
      [ProtocolVersion.MinSupportedVersion, 0],
      [ProtocolVersion.MinSupportedVersion, 1],
      // The second variant starts applying the multiplier to the state (represents a protocol change).
      [ProtocolVersion.ProtocolVersion(100n), 4],
      [ProtocolVersion.ProtocolVersion(100n), 6],
      [ProtocolVersion.ProtocolVersion(100n), 8],
    ]);
  });
});
