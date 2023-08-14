import * as t from 'io-ts';
import type { Observable } from 'rxjs';
import {
  mkServerInputMessageCodec,
  mkServerOutputMessageCodec,
  mkSubmitTxResponseCodec,
} from '@midnight/wallet-server-api';
export type { TxRequestState } from '@midnight/wallet-server-api';
export { TxRequestStates } from '@midnight/wallet-server-api';

export const InputMessageCodec = mkServerOutputMessageCodec(t.string, t.string);
export type InputMessage = t.TypeOf<typeof InputMessageCodec>;

export const OutputMessageCodec = mkServerInputMessageCodec(t.string, t.string);
export type OutputMessage = t.TypeOf<typeof OutputMessageCodec>;

const SubmitTxResponseCodec = mkSubmitTxResponseCodec(t.string);
export type SubmitTxResponse = t.TypeOf<typeof SubmitTxResponseCodec>;

export interface State {
  address: string;
  balance: bigint;
}
export interface WalletUIClientAPI {
  readonly state$: Observable<State>;

  submitTx: (transaction: string, newCoins: string[]) => Observable<SubmitTxResponse>;

  calculateTxCost: (transaction: string) => Observable<bigint>;
}
