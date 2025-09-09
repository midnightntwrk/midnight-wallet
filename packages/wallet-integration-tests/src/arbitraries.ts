import {
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
} from '@midnight-ntwrk/wallet-sdk-address-format';
import * as ledger from '@midnight-ntwrk/ledger';
import * as fc from 'fast-check';
import { Record } from 'effect';
import { TokenTransfer } from '@midnight-ntwrk/wallet-api';

export const recipientArbitrary = fc
  .uint8Array({ minLength: 32, maxLength: 32 })
  .map((bytes) => ledger.ZswapSecretKeys.fromSeed(bytes));

export const shieldedAddressArbitrary = (whoArb: fc.Arbitrary<ledger.ZswapSecretKeys>): fc.Arbitrary<ShieldedAddress> =>
  whoArb.map(
    (who) =>
      new ShieldedAddress(
        new ShieldedCoinPublicKey(Buffer.from(who.coinPublicKey, 'hex')),
        new ShieldedEncryptionPublicKey(Buffer.from(who.encryptionPublicKey, 'hex')),
      ),
  );

export const outputsArbitrary = <TRecipient>(
  balances: Record<ledger.RawTokenType, bigint>,
  networkId: ledger.NetworkId,
  recipientArb: fc.Arbitrary<TRecipient>,
): fc.Arbitrary<
  ReadonlyArray<{
    readonly amount: bigint;
    readonly type: ledger.RawTokenType;
    readonly receiverAddress: TRecipient;
  }>
> => {
  const coinTypeArbitrary: fc.Arbitrary<ledger.RawTokenType> = fc.constantFrom(...Object.keys(balances));
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

export const swapParamsArbitrary = (
  balances: Record<ledger.RawTokenType, bigint>,
  selfAddress: string,
): fc.Arbitrary<{
  inputs: Record<ledger.RawTokenType, bigint>;
  outputs: TokenTransfer[];
}> => {
  const availableTypes = Record.keys(balances);
  const valueAssignments: fc.Arbitrary<Record<ledger.RawTokenType, bigint>> = availableTypes.reduce(
    (accArbitrary: fc.Arbitrary<Record<ledger.RawTokenType, bigint>>, tokenType) => {
      return accArbitrary.chain((acc) => {
        return fc.bigInt({ min: 1n, max: balances[tokenType] - 1_000_000n }).map((value) => ({
          ...acc,
          [tokenType]: value,
        }));
      });
    },
    fc.constant({}),
  );
  const inputOutputTypeAssignments = fc
    .integer({ min: 0, max: availableTypes.length })
    .chain((inputTypesCount) => {
      return fc
        .integer({ min: 0, max: availableTypes.length - inputTypesCount })
        .map((outputTypesCount) => ({ inputTypesCount, outputTypesCount }));
    })
    .chain(({ inputTypesCount, outputTypesCount }) => {
      return fc
        .shuffledSubarray(availableTypes, { minLength: availableTypes.length, maxLength: availableTypes.length })
        .map((shuffledTypes) => {
          const inputTypes = shuffledTypes.splice(0, inputTypesCount);
          const outputTypes = shuffledTypes.splice(0, outputTypesCount);
          return { inputTypes, outputTypes };
        });
    });
  return fc
    .record({
      valueAssignments: valueAssignments,
      inputOutputTypeAssignments: inputOutputTypeAssignments,
    })
    .map((params) => {
      const inputs: Record<ledger.RawTokenType, bigint> = params.inputOutputTypeAssignments.inputTypes.reduce(
        (acc, type) => ({
          ...acc,
          [type]: params.valueAssignments[type],
        }),
        {},
      );
      const outputs = params.inputOutputTypeAssignments.outputTypes.map((outputType): TokenTransfer => {
        return {
          amount: params.valueAssignments[outputType],
          type: outputType,
          receiverAddress: selfAddress,
        };
      });

      return { inputs, outputs };
    });
};
