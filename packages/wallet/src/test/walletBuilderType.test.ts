import { WalletBuilderTs } from '../index';
import type { Expect, Equal } from './testUtils';

describe('WalletBuilder', () => {
  describe('without variants', () => {
    it('should not build a valid wallet', () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const wallet = new WalletBuilderTs().build();
      // Without any variants, the returned wallet type from the `build` method should be `never`.
      const walletAsExpectedType: Expect<Equal<typeof wallet, never>> = true;

      expect(walletAsExpectedType).toBeTruthy();
    });

    it('prevents configuration', () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const builder = new WalletBuilderTs();
      // Without any variants, the `configuration` parameter of the `withConfiguration` method should
      // be `never` - preventing it from being invoked.
      const withConfigurationExpectedType: Expect<Equal<Parameters<typeof builder.withConfiguration>, [_: never]>> =
        true;

      expect(withConfigurationExpectedType).toBeTruthy();
    });
  });
});
