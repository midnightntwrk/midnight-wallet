import { Context, Stream } from 'effect';

export class SyncService extends Context.Tag('@midnight-ntwrk/wallet#SyncService')<
  SyncService,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  SyncService.Service<any, any>
>() {}

export declare namespace SyncService {
  interface Service<TState, TUpdate> {
    updates: (state: TState) => Stream.Stream<TUpdate>;
  }
}
