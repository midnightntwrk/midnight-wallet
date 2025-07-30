import { Data } from 'effect';
import { SerializedMnTransaction } from './NodeClient';

export type HexString = string;

export type SubmissionEvent = Cases.Submitted | Cases.InBlock | Cases.Finalized;
export const { Submitted, InBlock, Finalized, $match: match, $is: is } = Data.taggedEnum<SubmissionEvent>();
export declare namespace Cases {
  export type Submitted = {
    _tag: 'Submitted';
    tx: SerializedMnTransaction;
    txHash: HexString;
  };
  export type InBlock = {
    _tag: 'InBlock';
    blockHash: HexString;
    blockHeight: bigint;
    tx: SerializedMnTransaction;
    txHash: HexString;
  };
  export type Finalized = {
    _tag: 'Finalized';
    blockHash: HexString;
    blockHeight: bigint;
    tx: SerializedMnTransaction;
    txHash: HexString;
  };
}
