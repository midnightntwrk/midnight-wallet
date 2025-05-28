import { WalletBuilderTs } from '../index';
import type { Expect, Equal } from './testUtils';

describe('WalletBuilder', () => {
  describe('without variants', () => {
    it('should not build a valid wallet', () => {
      expect(() => new WalletBuilderTs().build()).toThrow();
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
