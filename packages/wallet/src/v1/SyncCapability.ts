import { Context } from 'effect';

export class SyncCapability extends Context.Tag('@midnight-ntwrk/wallet#SyncCapability')<
  SyncCapability,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  SyncCapability.Service<any, any>
>() {}

export declare namespace SyncCapability {
  interface Service<TState, TUpdate> {
    applyUpdate: (state: TState, update: TUpdate) => TState;
  }
}
