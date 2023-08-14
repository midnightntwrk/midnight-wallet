import * as t from 'io-ts';
import {
  mkSubmitTxRequestCodec,
  mkSubmitTxResponseCodec,
  mkSubmitTxRequestWithFeeCodec,
  mkServerInputMessageCodec,
  mkServerOutputMessageCodec,
  mkStateMessageCodec,
  mkCalculateTxCostRequestCodec,
} from '@midnight/wallet-server-api';
import { ZSwapCoinPublicKey, CoinInfo, Transaction, TransactionIdentifier } from '@midnight/ledger';
import { mkLedgerTypeCodec } from './helpers/codecs';

export const ZSwapCoinPublicKeyCodec = mkLedgerTypeCodec<ZSwapCoinPublicKey>(ZSwapCoinPublicKey);
export const CoinInfoCodec = mkLedgerTypeCodec<CoinInfo>(CoinInfo);
export const TransactionCodec = mkLedgerTypeCodec<Transaction>(Transaction);
export const TransactionIdentifierCodec = mkLedgerTypeCodec<TransactionIdentifier>(TransactionIdentifier);

export const SubmitTxRequestCodec = mkSubmitTxRequestCodec(TransactionCodec, CoinInfoCodec);
export type SubmitTxRequest = t.TypeOf<typeof SubmitTxRequestCodec>;

export const SubmitTxResponseCodec = mkSubmitTxResponseCodec(TransactionIdentifierCodec);
export type SubmitTxResponse = t.TypeOf<typeof SubmitTxResponseCodec>;

export const SubmitTxRequestWithFeeCodec = mkSubmitTxRequestWithFeeCodec(TransactionCodec, CoinInfoCodec);
export type SubmitTxRequestWithFee = t.TypeOf<typeof SubmitTxRequestWithFeeCodec>;

export const ServerInputMessageCodec = mkServerInputMessageCodec(TransactionCodec, CoinInfoCodec);
export type ServerInputMessage = t.TypeOf<typeof ServerInputMessageCodec>;

export const StateMessageCodec = mkStateMessageCodec(ZSwapCoinPublicKeyCodec);
export type StateMessage = t.TypeOf<typeof StateMessageCodec>;

export const CalculateTxCostRequestCodec = mkCalculateTxCostRequestCodec(TransactionCodec);

export type CalculateTxCostRequest = t.TypeOf<typeof CalculateTxCostRequestCodec>;

export const ServerOutputMessageCodec = mkServerOutputMessageCodec(ZSwapCoinPublicKeyCodec, TransactionIdentifierCodec);
export type ServerOutputMessage = t.TypeOf<typeof ServerOutputMessageCodec>;
