import {
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
} from '@midnight-ntwrk/wallet-sdk-address-format';
import * as zswap from '@midnight-ntwrk/zswap';
import * as fc from 'fast-check';

export const recipientArbitrary = fc
  .uint8Array({ minLength: 32, maxLength: 32 })
  .map((bytes) => zswap.SecretKeys.fromSeed(bytes));

export const shieldedAddressArbitrary = (whoArb: fc.Arbitrary<zswap.SecretKeys>): fc.Arbitrary<ShieldedAddress> =>
  whoArb.map(
    (who) =>
      new ShieldedAddress(
        new ShieldedCoinPublicKey(Buffer.from(who.coinPublicKey, 'hex')),
        new ShieldedEncryptionPublicKey(Buffer.from(who.encryptionPublicKey, 'hex')),
      ),
  );

export const outputsArbitrary = <TRecipient>(
  balances: Record<zswap.TokenType, bigint>,
  networkId: zswap.NetworkId,
  recipientArb: fc.Arbitrary<TRecipient>,
): fc.Arbitrary<
  ReadonlyArray<{
    readonly amount: bigint;
    readonly type: zswap.TokenType;
    readonly receiverAddress: TRecipient;
  }>
> => {
  const coinTypeArbitrary: fc.Arbitrary<zswap.TokenType> = fc.constantFrom(...Object.keys(balances));
  const outputArbitrary = coinTypeArbitrary.chain((coinType) =>
    fc.record({
      type: fc.constant(coinType),
      amount: fc.bigInt({ max: balances[coinType], min: 1n }),
      receiverAddress: recipientArb,
    }),
  );
  return fc.array(outputArbitrary, { size: 'xsmall', minLength: 1 }).filter((transfers) => {
    const transferBalances = transfers.reduce((acc: Record<string, bigint>, transfer) => {
      return {
        ...acc,
        [transfer.type]: acc[transfer.type] === undefined ? transfer.amount : acc[transfer.type] + transfer.amount,
      };
    }, {});

    return Object.entries(transferBalances).every(([tokenType, transferAmount]) => {
      const availableAmount = balances[tokenType] ?? 0n;

      return availableAmount > transferAmount;
    });
  });
};
