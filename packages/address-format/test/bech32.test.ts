import addresses from './addresses.json';
import { MidnightBech32m, ShieldedAddress, ShieldedCoinPublicKey, ShieldedEncryptionSecretKey } from '../src';
import { NetworkId } from '@midnight-ntwrk/zswap';

function mapNetworkId(networkId: string | null): NetworkId {
  switch (networkId) {
    case 'dev':
      return NetworkId.DevNet;
    case 'test':
      return NetworkId.TestNet;
    default:
      return NetworkId.MainNet;
  }
}

describe('Bech32 addresses', () => {
  it('ShieldedAddress - Bech32 representation should match its Hex representation', () => {
    addresses.forEach((item, _) => {
      const shA = ShieldedAddress.codec.decode(item.networkId, MidnightBech32m.parse(item.shieldedAddress.bech32m));

      expect(item.shieldedAddress.hex).toEqual(`${shA.coinPublicKeyString()}${shA.encryptionPublicKeyString()}`);
    });
  });

  it('ShieldedEncryptionSecretKey - Bech32 representation should match its Hex representation', () => {
    const zswapNetworkIds = ['dev', 'test', null];
    const filteredAddresses = addresses.filter((item) => zswapNetworkIds.includes(item.networkId));
    filteredAddresses.forEach((item, _) => {
      const networkId = mapNetworkId(item.networkId);
      const shESK = ShieldedEncryptionSecretKey.codec.decode(
        networkId,
        MidnightBech32m.parse(item.shieldedESK.bech32m),
      );

      const eskHEXRaw = shESK.zswap.yesIKnowTheSecurityImplicationsOfThis_serialize(networkId);
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
