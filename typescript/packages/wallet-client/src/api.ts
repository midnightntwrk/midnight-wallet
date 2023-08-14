import * as t from 'io-ts';
import { mkServerInputMessageCodec, mkServerOutputMessageCodec } from '@midnight/wallet-server-api';
import { ZSwapCoinPublicKey, CoinInfo, Transaction, TransactionIdentifier } from '@midnight/ledger';
import { mkLedgerTypeCodec } from './helpers/codecs';

export const ZSwapCoinPublicKeyCodec = mkLedgerTypeCodec<ZSwapCoinPublicKey>(ZSwapCoinPublicKey);
export const CoinInfoCodec = mkLedgerTypeCodec<CoinInfo>(CoinInfo);
export const TransactionCodec = mkLedgerTypeCodec<Transaction>(Transaction);
export const TransactionIdentifierCodec = mkLedgerTypeCodec<TransactionIdentifier>(TransactionIdentifier);

export const OutputMessageCodec = mkServerInputMessageCodec(TransactionCodec, CoinInfoCodec);
export type OutputMessage = t.TypeOf<typeof OutputMessageCodec>;

export const InputMessageCodec = mkServerOutputMessageCodec(ZSwapCoinPublicKeyCodec, TransactionIdentifierCodec);

export type InputMessage = t.TypeOf<typeof InputMessageCodec>;

export interface State {
  address: ZSwapCoinPublicKey;
  balance: bigint;
}
