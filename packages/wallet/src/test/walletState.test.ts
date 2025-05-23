import { jest } from '@jest/globals';
import { WalletBuilderTs } from '../index';
import { ProtocolVersion } from '../abstractions/index';
import { NumericRangeBuilder } from './variants';
import { toProtocolStateArray } from './testUtils';

describe('Wallet', () => {
  describe('state', () => {
    it('should report errors', async () => {
      const builder = new WalletBuilderTs()
        // Have the variant throw an error after producing two elements.
        .withVariant(ProtocolVersion.MinSupportedVersion, new NumericRangeBuilder(2, true))
        .withConfiguration({
          min: 0,
          max: 9,
        });
      const wallet = builder.build();

      expect(wallet).toBeDefined();

      const errorHandler = jest.fn();
      const receivedStates = await toProtocolStateArray(wallet.state, errorHandler);

      expect(receivedStates).toEqual([
        [ProtocolVersion.MinSupportedVersion, 0],
        [ProtocolVersion.MinSupportedVersion, 1],
      ]);
      expect(errorHandler).toHaveBeenCalled();
    });
  });
});
