import { Data } from 'effect';
import { SubmissionEvent } from './SubmissionEvent.js';

export class SubmissionError extends Data.TaggedError('SubmissionError')<{
  message: string;
  txData: Uint8Array;
  cause?: unknown;
}> {}
export class ConnectionError extends Data.TaggedError('ConnectionError')<{
  message: string;
  cause?: unknown;
}> {}
export class TransactionProgressError extends Data.TaggedError('TransactionProgressError')<{
  message: string;
  txData: Uint8Array;
  desiredStage: SubmissionEvent['_tag'];
}> {}
export class ParseError extends Data.TaggedError('ParseError')<{
  message: string;
  cause?: unknown;
}> {}
export class TransactionUsurpedError extends Data.TaggedError('TransactionUsurpedError')<{
  message: string;
  txData: Uint8Array;
}> {}
export class TransactionDroppedError extends Data.TaggedError('TransactionDroppedError')<{
  message: string;
  txData: Uint8Array;
}> {}
export class TransactionInvalidError extends Data.TaggedError('TransactionInvalidError')<{
  message: string;
  txData: Uint8Array;
  cause?: unknown;
}> {}

export type NodeClientError =
  | SubmissionError
  | ConnectionError
  | TransactionProgressError
  | ParseError
  | TransactionUsurpedError
  | TransactionDroppedError
  | TransactionInvalidError;
