import addresses from './addresses.json';
import { MidnightBech32m, ShieldedAddress, ShieldedCoinPublicKey, ShieldedEncryptionSecretKey } from '../src';

describe('Bech32 addresses', () => {
  it('ShieldedAddress - Bech32 representation should match its Hex representation', () => {
    addresses.forEach((item, _) => {
      const shA = ShieldedAddress.codec.decode(item.networkId, MidnightBech32m.parse(item.shieldedAddress.bech32m));

      expect(item.shieldedAddress.hex).toEqual(`${shA.coinPublicKeyString()}${shA.encryptionPublicKeyString()}`);
    });
  });

  /**
   * addresses.json needs to be updated with the correct format for this test to pass
   */
  it.skip('ShieldedEncryptionSecretKey - Bech32 representation should match its Hex representation', () => {
    const zswapNetworkIds = ['dev', 'test', null];
    const filteredAddresses = addresses.filter((item) => zswapNetworkIds.includes(item.networkId));
    filteredAddresses.forEach((item, _) => {
      const shESK = ShieldedEncryptionSecretKey.codec.decode(
        'undeployed',
        MidnightBech32m.parse(item.shieldedESK.bech32m),
      );

      const eskHEXRaw = shESK.zswap.yesIKnowTheSecurityImplicationsOfThis_serialize();
      const eskHEX = Buffer.from(eskHEXRaw.subarray(1)).toString('hex');

      expect(item.shieldedESK.hex).toEqual(eskHEX);
    });
  });

  it('ShieldedCoinPublicKey - Bech32 representation should match its Hex representation', () => {
    addresses.forEach((item, _) => {
      const shCPK = ShieldedCoinPublicKey.codec.decode(item.networkId, MidnightBech32m.parse(item.shieldedCPK.bech32m));

      expect(item.shieldedCPK.hex).toEqual(Buffer.from(shCPK.data).toString('hex'));
    });
  });
});
