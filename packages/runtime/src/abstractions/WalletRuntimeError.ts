import { Data } from 'effect';

export class WalletRuntimeError extends Data.TaggedError('WalletRuntimeError')<{ message: string; cause?: unknown }> {}
