import { Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { UnshieldedKeystore } from '../src';
import { Effect } from 'effect';
import { addressFromKey, signatureVerifyingKey, verifySignature } from '@midnight-ntwrk/ledger';

const seed = new Uint8Array(64).fill(1);

describe('UnshieldedKeystore', () => {
  it.each([
    { account: 0, index: 0, role: Roles.NightExternal },
    { account: 1, index: 3, role: Roles.NightExternal },
  ])('should construct the class', ({ account, index, role }) => {
    const { account: rAccount, index: rIndex, role: rRole } = new UnshieldedKeystore(seed, account, index, role);
    expect(rAccount).toEqual(account);
    expect(rIndex).toEqual(index);
    expect(rRole).toEqual(role);
  });

  it('should fail when passing the unsupported role', () => {
    for (const role of Object.values(Roles)) {
      if (role === Roles.NightExternal || role === Roles.NightInternal) continue;
      expect(() => new UnshieldedKeystore(seed, 0, 0, role)).toThrow();
    }
  });

  it('should return all the keys', async () =>
    Effect.gen(function* () {
      const keystore = new UnshieldedKeystore(seed, 0, 0, Roles.NightExternal);
      const secretKey = yield* keystore.getSecretKey();
      const publicKey = yield* keystore.getPublicKey();
      const address = yield* keystore.getAddress();
      expect(secretKey.toString('hex')).toEqual('0100c554e3ba07b92b621b48a69f6d06c9664aec9a2d63929ec7e5034cfac0f90344');
      expect(publicKey).toEqual(signatureVerifyingKey(secretKey.toString('hex')));
      expect(address).toEqual(addressFromKey(publicKey));
    }).pipe(Effect.runPromise));

  it('should sign the provided data', () =>
    Effect.gen(function* () {
      const keystore = new UnshieldedKeystore(seed, 0, 0, Roles.NightExternal);
      const data = new TextEncoder().encode('Hello world');
      const signature = yield* keystore.signData(data);
      const publicKey = yield* keystore.getPublicKey();
      expect(verifySignature(publicKey, data, signature)).toEqual(true);
    }).pipe(Effect.runPromise));
});
