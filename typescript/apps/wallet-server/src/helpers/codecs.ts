import * as t from 'io-ts';
import { either } from 'fp-ts';
import { ZSwapCoinPublicKey, Transaction, CoinInfo, TransactionIdentifier } from '@midnight/ledger';
import { block } from '@midnight/wallet-server-api';

export const mkLedgerTypeCodec = <
  LedgerType extends Transaction | ZSwapCoinPublicKey | CoinInfo | TransactionIdentifier,
>(
  ledgerType: Function & {
    name: string;
    deserialize: (str: Buffer) => LedgerType;
  },
) =>
  t.string.pipe(
    block(() => {
      const validate: t.Validate<string, LedgerType> = (str, context) => {
        try {
          const deserializedValue = ledgerType.deserialize(Buffer.from(str, 'hex'));

          return either.right(deserializedValue);
        } catch (error) {
          return either.left([
            {
              value: str,
              context,
              message: `Could not parse ${str} to a ${ledgerType.name} object.`,
            },
          ]);
        }
      };

      return new t.Type<LedgerType, string, string>(
        ledgerType.name,
        (type): type is LedgerType => type instanceof ledgerType,
        validate,
        (type) => type.serialize().toString('hex'),
      );
    }),
  );
