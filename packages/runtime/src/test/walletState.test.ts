import { ProtocolVersion } from '@midnight-ntwrk/wallet-sdk-abstractions';
import * as rx from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { toProtocolStateArray } from '../testing/utils.js';
import { NumericRangeBuilder } from '../testing/variants.js';
import { WalletBuilder } from '../WalletBuilder.js';

describe('Wallet', () => {
  describe('state', () => {
    it('should report errors', async () => {
      const builder = WalletBuilder.init()
        // Have the variant throw an error after producing two elements.
        .withVariant(ProtocolVersion.MinSupportedVersion, new NumericRangeBuilder(2, true));
      const Wallet = builder.build({
        min: 0,
        max: 9,
      });
      const wallet = Wallet.startEmpty(Wallet);

      expect(wallet).toBeDefined();

      const errorHandler = vi.fn();
      const receivedStates = await toProtocolStateArray<number>(wallet.rawState.pipe(rx.take(4)), errorHandler);

      expect(receivedStates).toEqual([
        { version: ProtocolVersion.MinSupportedVersion, state: 0 }, // The initial state is emitted both by runtime and the variant
        { version: ProtocolVersion.MinSupportedVersion, state: 0 },
        { version: ProtocolVersion.MinSupportedVersion, state: 1 },
      ]);
      expect(errorHandler).toHaveBeenCalled();
    });
  });
});
